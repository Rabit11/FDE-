const API = '/api';
const BLOCKER_TYPES = { none: '无卡点', resource: '资源冲突', time: '时间冲突', technical: '技术问题', other: '其他' };
const BLOCKER_ICONS = { resource: '🔧', time: '⏰', technical: '💻', other: '⚠️' };
const STAR_GOLD = '#f5d061';
const STAR_GOLD_DARK = '#8a6d12';
const FLOW_COLS = [
  { id: 'in_progress', label: '执行中', color: '#f5d061' },
  { id: 'blocked', label: '阻塞', color: '#ef4444' },
  { id: 'done', label: '已归档', color: '#22c55e' },
  { id: 'terminated', label: '已终止', color: '#94a3b8' },
];
const ACTIVE_STATUSES = ['submitted', 'todo', 'in_progress', 'review'];
const STATUS_LABELS = {
  submitted: '执行中', todo: '执行中', in_progress: '执行中', review: '执行中',
  blocked: '阻塞', done: '已归档', terminated: '已终止',
};
const TYPE_LABELS = { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Bug' };
const PRIORITY_LEVELS = [
  { value: 1, label: 'P1 紧急', short: 'P1' },
  { value: 2, label: 'P2 高', short: 'P2' },
  { value: 3, label: 'P3 普通', short: 'P3' },
];
const WIP_LIMITS = { in_progress: 10, blocked: 5, done: 99, terminated: 99 };

function flowCategory(item) {
  const status = typeof item === 'string' ? item : item?.status;
  const acceptance = typeof item === 'object' ? item?.acceptance_status : null;
  if (status === 'terminated' || (status === 'done' && acceptance === 'terminated')) return 'terminated';
  if (status === 'blocked') return 'blocked';
  if (status === 'done') return 'done';
  return 'in_progress';
}

let state = { items: [], myWorkItems: [], users: [], metrics: {}, activity: [], insights: [], chatHistory: [], voiceDocs: [], meetingRecords: [], userProjects: [], userReviewProjects: [], currentMeetingId: null, currentView: '', user: null, roleConfig: null, llmEnabled: false, aiStatus: null, recording: false, mediaRecorder: null, kanbanFilter: { flow: 'all', reviewer: '', executor: '' }, kanbanViewMode: 'list', demandAiTab: 'submit', submitTab: 'quick', profileShowAll: false, globalKanbanUpdatedAt: null, workbenchFilter: 'all' };

let globalKanbanTimer = null;
const DASHBOARD_POLL_MS = 5000;

function getToken() { return localStorage.getItem('agileai_token'); }

function userDeptLabel(u) {
  const dept = u?.dept || '';
  if (dept === '管理部门') return '审核人';
  if (dept === '执行团队' || dept === '执行部门') return '执行人';
  return dept;
}

function normalizeUsers(users = []) {
  return users.map(u => ({ ...u, dept: userDeptLabel(u) }));
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) { localStorage.clear(); location.href = '/login.html'; return; }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function isReviewerUser() {
  return (state.user?.capabilities || []).includes('reviewer') || state.user?.role === 'admin';
}

function isLeaderUser() {
  return isReviewerUser();
}

function leaderNavConfig(user = state.user) {
  const caps = user?.capabilities || [];
  if (!caps.includes('reviewer') && user?.role !== 'admin') return null;
  const nav = [
    { id: 'dashboard', label: '📊 全局看板' },
    { id: 'taskcenter', label: '📋 任务中心' },
    { id: 'demandai', label: user?.role === 'admin' ? '🧠 需求与 AI 中心' : '🧠 需求与 AI' },
    { id: 'profile', label: '👤 我的' },
  ];
  if (user?.role === 'admin') nav.push({ id: 'team', label: '👥 团队' });
  return { nav, defaultView: 'dashboard' };
}

function canModifyKanban() {
  return isReviewerUser();
}

function isMyWorkItem(item, userName = state.user?.name) {
  if (!item || !userName) return false;
  return item.assignee === userName || (item.assistants || []).includes(userName);
}

function myWorkRole(item, userName = state.user?.name) {
  if (!item || !userName) return null;
  if (item.assignee === userName) return 'primary';
  if ((item.assistants || []).includes(userName)) return 'assist';
  return null;
}

function taskPeopleText(item) {
  const assist = (item.assistants || []).length ? ` · 其他执行: ${item.assistants.join('、')}` : '';
  return `审核: ${item.reviewer || '-'} · 主执行: ${item.assignee || '-'}${assist}`;
}

function taskPeopleHtml(item) {
  const assist = (item.assistants || []).length ? ` · 其他执行: ${item.assistants.map(esc).join('、')}` : '';
  return `审核人: <strong>${esc(item.reviewer || '-')}</strong> · 主执行: <strong>${esc(item.assignee || '-')}</strong>${assist}`;
}

function workflowItems() {
  return state.items.filter(i => i.req_no || i.reviewer);
}

function projectStatusMeta(item = {}) {
  if (flowCategory(item) === 'terminated') return { label: '已终止', cls: 'terminated' };
  if (item.status === 'done') return { label: '已归档', cls: 'done' };
  if (item.status === 'blocked') return { label: '阻塞', cls: 'blocked' };
  return { label: '执行中', cls: 'running' };
}

function normalizePriority(value) {
  const p = Number(value);
  return [1, 2, 3].includes(p) ? p : 3;
}

function priorityMeta(value) {
  const p = normalizePriority(value);
  const level = PRIORITY_LEVELS.find(l => l.value === p) || PRIORITY_LEVELS[2];
  return { value: p, label: level.label, short: level.short, cls: `priority-${p}` };
}

function sortByPriority(items = []) {
  return [...items].sort((a, b) =>
    normalizePriority(a.priority) - normalizePriority(b.priority) ||
    (b.updated_at || '').localeCompare(a.updated_at || '')
  );
}

function canEditTaskPriority(item) {
  if (!item || !state.user) return false;
  if (isReviewerUser()) return true;
  return item.assignee === state.user.name || (item.assistants || []).includes(state.user.name);
}

function priorityBadgeHtml(item, { compact = false } = {}) {
  const meta = priorityMeta(item?.priority);
  if (compact) {
    return `<span class="priority-badge priority-badge--sm ${meta.cls}" title="${meta.label}"><span class="priority-dot ${meta.cls}"></span>${meta.short}</span>`;
  }
  return `<span class="priority-badge ${meta.cls}" title="${meta.label}"><span class="priority-dot ${meta.cls}"></span>${meta.label}</span>`;
}

function priorityControlHtml(item, { editable = false } = {}) {
  const meta = priorityMeta(item?.priority);
  if (!editable || !canEditTaskPriority(item)) return priorityBadgeHtml(item, { compact: true });
  return `<select class="priority-select ${meta.cls}" onclick="event.stopPropagation()" onchange="updateTaskPriority('${item.id}', this.value)" title="调整任务优先级">
    ${PRIORITY_LEVELS.map(l => `<option value="${l.value}" ${meta.value === l.value ? 'selected' : ''}>${l.label}</option>`).join('')}
  </select>`;
}

function syncItemInState(item) {
  if (!item?.id) return;
  const patchList = (list = []) => list.map(i => i.id === item.id ? { ...i, ...item } : i);
  state.items = patchList(state.items);
  state.myWorkItems = patchList(state.myWorkItems);
  state.userProjects = patchList(state.userProjects);
}

function prependActivityInState(activity) {
  if (!activity?.id) return;
  const rest = (state.activity || []).filter(a => a.id !== activity.id);
  state.activity = [activity, ...rest].slice(0, 50);
}

function refreshActivityFeedDom() {
  const topInsight = state.insights.find(i => i.severity === 'warning') || state.insights[0];
  const feedPanel = document.getElementById('gk-feed-panel');
  if (feedPanel) feedPanel.outerHTML = renderActivityFeedPanel(topInsight);
  else {
    const feed = document.getElementById('gk-feed');
    if (feed) feed.innerHTML = renderActivityFeedHtml();
  }
}

async function refreshCurrentView() {
  const view = state.currentView;
  const renderers = {
    taskcenter: renderTaskCenter, dashboard: renderDashboard, demandai: renderDemandAI,
    mywork: renderMyWork, submit: renderSubmit, profile: renderProfile, team: renderTeam,
    kanban: renderTaskCenter, review: renderTaskCenter, acceptance: renderTaskCenter, ai: renderDemandAI,
  };
  const render = renderers[view];
  if (!render) return;
  document.getElementById('content').innerHTML = render();
  if (view === 'dashboard' && isReviewerUser()) startGlobalKanbanPolling();
  if (view === 'taskcenter' && state.kanbanViewMode === 'board') initDragDrop();
}

async function loadData() {
  const fetches = [
    api('/items'), api('/metrics'), api('/activity?limit=40'), api('/ai/insights'), api('/users'),
  ];
  const isExecutor = (state.user?.capabilities || []).includes('executor');
  if (isExecutor) fetches.push(api('/items/my-work').catch(() => []));
  const results = await Promise.all(fetches);
  const [items, metrics, activity, insights, users] = results;
  const myWorkItems = isExecutor ? (results[5] || []) : [];
  state = { ...state, items, myWorkItems, metrics, activity, insights, users: normalizeUsers(users) };
  updateWorkflowBadge();
}

function updateWorkflowBadge() {
  const el = document.getElementById('workflowBadge');
  if (!el) return;
  const items = workflowItems();
  const running = items.filter(i => flowCategory(i) === 'in_progress').length;
  const blocked = items.filter(i => i.status === 'blocked').length;
  const done = items.filter(i => flowCategory(i) === 'done').length;
  const terminated = items.filter(i => flowCategory(i) === 'terminated').length;
  el.innerHTML = `执行中 <strong>${running}</strong> · 阻塞 <strong>${blocked}</strong> · 已归档 <strong>${done}</strong> · 已终止 <strong>${terminated}</strong>`;
  el.className = blocked && isReviewerUser() ? 'workflow-badge workflow-badge--alert' : 'workflow-badge';
}

function buildNav() {
  const nav = document.getElementById('navMenu');
  const leader = leaderNavConfig();
  const items = leader?.nav || state.user?.nav || state.roleConfig?.nav || [];
  nav.innerHTML = items.map(n => `<button class="nav-item" data-view="${n.id}">${n.label}</button>`).join('');
  nav.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.view)));
}

function buildTopbar() {
  const el = document.getElementById('topbarActions');
  if (isReviewerUser()) {
    el.innerHTML = `<button class="btn btn-ghost" id="btnStandup">📋 站会摘要</button><button class="btn btn-ghost" id="btnRisks">⚠️ 风险扫描</button><button class="btn btn-ghost" id="btnDemand">📤 新建需求</button><button class="btn btn-primary" id="btnNewItem">+ 快捷新建</button>`;
    document.getElementById('btnNewItem')?.addEventListener('click', showNewItemModal);
    document.getElementById('btnDemand')?.addEventListener('click', () => { state.demandAiTab = 'submit'; navigate('demandai'); });
  } else {
    el.innerHTML = `<button class="btn btn-primary" id="btnNewItem">+ 上报进展</button>`;
    document.getElementById('btnNewItem')?.addEventListener('click', () => navigate('mywork'));
  }
  document.getElementById('btnStandup')?.addEventListener('click', runStandup);
  document.getElementById('btnRisks')?.addEventListener('click', runRisks);
}

function setupUserCard() {
  const u = state.user;
  document.getElementById('userName').textContent = u.name;
  document.getElementById('userAvatar').textContent = u.name.slice(0, 1);
  document.getElementById('userRole').innerHTML = (state.user.capabilityLabels || []).map(c => `<span class="cap-tag">${esc(c)}</span>`).join('') || `<span class="role-badge role-${state.user.role}">${esc(state.user.roleLabel)}</span>`;
  document.getElementById('userCard').onclick = () => navigate('profile');
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showModal(title, html) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}

// ── Renderers ──
function flowListActionsHtml(item) {
  const parts = [
    `<button type="button" class="btn btn-ghost btn-sm flow-list-action" onclick="event.stopPropagation();showTaskDetailView('${item.id}')">详情</button>`,
  ];
  if (!canModifyKanban()) return `<div class="flow-list-actions">${parts.join('')}</div>`;
  const cat = flowCategory(item);
  if (cat === 'in_progress') {
    parts.push(`<button type="button" class="btn btn-ghost btn-sm flow-list-action flow-list-action--danger" onclick="event.stopPropagation();reviewerTerminate('${item.id}')">终止</button>`);
  }
  if (cat === 'blocked') {
    parts.push(`<button type="button" class="btn btn-primary btn-sm flow-list-action" onclick="event.stopPropagation();showReassignModal('${item.id}')">分配</button>`);
  }
  if (cat === 'done' || cat === 'terminated') {
    parts.push(`<button type="button" class="btn btn-ghost btn-sm flow-list-action flow-list-action--warn" onclick="event.stopPropagation();reviewerRevoke('${item.id}')">退回</button>`);
  }
  return `<div class="flow-list-actions">${parts.join('')}</div>`;
}

function leaderActionsHtml(item) {
  if (!isLeaderUser()) return '';
  const cat = flowCategory(item);
  if (cat === 'in_progress') {
    return `<button type="button" class="btn btn-ghost btn-sm task-card-btn task-card-btn--danger" onclick="event.stopPropagation();reviewerTerminate('${item.id}')">⏹ 终止</button>`;
  }
  if (cat === 'blocked') {
    return `<button type="button" class="btn btn-primary btn-sm task-card-btn" onclick="event.stopPropagation();showReassignModal('${item.id}')">🔄 二次分配</button>`;
  }
  if (cat === 'done' || cat === 'terminated') {
    return `<button type="button" class="btn btn-ghost btn-sm task-card-btn task-card-btn--warn" onclick="event.stopPropagation();reviewerRevoke('${item.id}')">↩ 退回执行中</button>`;
  }
  return '';
}

function renderTaskCard(item) {
  const updates = (item.progress_updates || []).slice(0, 2);
  const blockerLabel = item.blocker_type ? BLOCKER_TYPES[item.blocker_type] : '';
  const isReviewer = isReviewerUser();
  const draggable = isReviewer ? 'true' : 'false';
  const role = myWorkRole(item);
  const roleBadge = role === 'primary' ? '<span class="card-role-badge">主执行</span>' :
    role === 'assist' ? '<span class="card-role-badge card-role-badge--assist">协助</span>' : '';
  const metaBits = [
    item.story_points ? `<span class="pts">${item.story_points} SP</span>` : '',
    item.blocked_reason ? `<span class="task-card-blocker">${BLOCKER_ICONS[item.blocker_type] || '🚧'} ${esc(item.blocked_reason)}</span>` : '',
    blockerLabel && item.status === 'blocked' ? `<span class="blocker-tag">${blockerLabel}</span>` : '',
  ].filter(Boolean).join('');
  const actions = leaderActionsHtml(item);

  return `<div class="task-card ${item.status === 'blocked' ? 'blocked' : ''} ${isReviewer ? '' : 'readonly'}" draggable="${draggable}" data-id="${item.id}">
    <div class="task-card-top">
      ${item.req_no ? `<span class="req-no-tag">${esc(item.req_no)}</span>` : '<span class="task-card-spacer"></span>'}
      <div class="task-card-badges">${priorityBadgeHtml(item, { compact: true })}${roleBadge}<span class="project-status-pill ${projectStatusMeta(item).cls}">${projectStatusMeta(item).label}</span></div>
    </div>
    <div class="task-card-title">${esc(item.title)}</div>
    <div class="task-card-people">${taskPeopleHtml(item)}</div>
    ${metaBits ? `<div class="task-card-meta">${metaBits}</div>` : ''}
    ${updates.length ? `<div class="card-progress-list">
      ${updates.map(u => `<div class="card-progress-item"><span class="prog-date">${u.date}</span> <strong>${esc(u.user)}</strong> ${esc(u.description?.slice(0, 40) || '')}</div>`).join('')}
    </div>` : ''}
    ${actions ? `<div class="task-card-actions">${actions}</div>` : ''}
  </div>`;
}

function boardView() {
  return isReviewerUser() ? 'taskcenter' : 'mywork';
}

function goTaskCenter(flow = 'all', mode = 'list') {
  state.kanbanFilter = { flow, reviewer: '', executor: '' };
  state.kanbanViewMode = mode;
  navigate('taskcenter');
}

function goWorkflowBadge() {
  goTaskCenter('all');
}

function setDemandAiTab(tab) {
  state.demandAiTab = tab;
  navigate('demandai');
}

function setSubmitTab(tab) {
  state.submitTab = tab;
  navigate('submit');
}

function toggleProfileShowAll() {
  state.profileShowAll = !state.profileShowAll;
  navigate('profile');
}

function kanbanBaseItems() {
  const items = state.items.filter(i => i.req_no || i.reviewer || i.assignee);
  return sortByPriority(items);
}

function applyKanbanFilters(items, excludeKey = null) {
  const f = state.kanbanFilter || { flow: 'all', reviewer: '', executor: '' };
  return items.filter(i => {
    if (excludeKey !== 'flow' && f.flow !== 'all' && flowCategory(i) !== f.flow) return false;
    if (excludeKey !== 'reviewer' && f.reviewer && i.reviewer !== f.reviewer) return false;
    if (excludeKey !== 'executor' && f.executor && i.assignee !== f.executor && !(i.assistants || []).includes(f.executor)) return false;
    return true;
  });
}

function setKanbanFilter(key, value) {
  if (!state.kanbanFilter) state.kanbanFilter = { flow: 'all', reviewer: '', executor: '' };
  state.kanbanFilter[key] = value;
  const bar = document.getElementById('kanban-filter-bar');
  const base = kanbanBaseItems();
  if (bar) bar.outerHTML = renderKanbanFilterBar(base);
  refreshKanbanContent();
}

function renderKanbanViewTabs() {
  const mode = state.kanbanViewMode || 'list';
  return `<div class="kanban-view-toolbar">
    <div class="kanban-view-tabs">
      <button type="button" class="kanban-view-tab ${mode === 'list' ? 'active' : ''}" data-mode="list" onclick="setKanbanViewMode('list')">📋 列表视图</button>
      <button type="button" class="kanban-view-tab ${mode === 'board' ? 'active' : ''}" data-mode="board" onclick="setKanbanViewMode('board')">📊 四列看板</button>
    </div>
    <button type="button" class="btn btn-ghost btn-sm kanban-export-btn" onclick="exportKanbanList()" title="导出当前筛选结果为 CSV">📥 导出清单</button>
  </div>`;
}

function refreshKanbanContent() {
  const base = kanbanBaseItems();
  const filtered = applyKanbanFilters(base);
  const area = document.getElementById('kanban-content-area');
  const hint = document.getElementById('kanban-list-hint');
  if (!area) return;
  if (state.kanbanViewMode === 'board') {
    area.innerHTML = `<div class="kanban-page-board">${renderKanbanBoard(filtered)}</div>`;
    if (hint) hint.textContent = `共 ${filtered.length} 项任务 · 四列看板 · ${isReviewerUser() ? '领导可拖拽移列' : '点击卡片查看详情'}`;
    initDragDrop();
  } else {
    area.innerHTML = renderKanbanListHtml(filtered);
    if (hint) hint.textContent = `共 ${filtered.length} 项任务 · 点击列表行查看详情`;
  }
}

function setKanbanViewMode(mode) {
  state.kanbanViewMode = mode;
  document.querySelectorAll('.kanban-view-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
  refreshKanbanContent();
}

function renderKanbanListRow(item) {
  const meta = projectStatusMeta(item);
  const assist = (item.assistants || []).length ? item.assistants.map(esc).join('、') : '-';
  return `<tr class="flow-list-row" onclick="showTaskDetailView('${item.id}')">
    <td class="flow-list-cell flow-list-col-no">${item.req_no ? `<span class="req-no-tag req-no-tag--sm">${esc(item.req_no)}</span>` : '<span class="flow-list-empty">-</span>'}</td>
    <td class="flow-list-title" title="${esc(item.title)}">${esc(item.title)}</td>
    <td class="flow-list-cell flow-list-col-status"><span class="project-status-pill project-status-pill--sm ${meta.cls}">${meta.label}</span></td>
    <td class="flow-list-cell flow-list-col-priority" onclick="event.stopPropagation()">${priorityControlHtml(item, { editable: canEditTaskPriority(item) })}</td>
    <td class="flow-list-cell flow-list-col-person">${esc(item.created_by || '-')}</td>
    <td class="flow-list-cell flow-list-col-person">${esc(item.reviewer || '-')}</td>
    <td class="flow-list-cell flow-list-col-person">${esc(item.assignee || '-')}</td>
    <td class="flow-list-cell flow-list-col-person" title="${esc(assist)}">${assist}</td>
    <td class="flow-list-cell flow-list-time">${fmtTime(item.created_at) || '-'}</td>
    <td class="flow-list-cell flow-list-time">${fmtTime(item.updated_at) || '-'}</td>
    <td class="flow-list-action-cell" onclick="event.stopPropagation()">${flowListActionsHtml(item)}</td>
  </tr>`;
}

function renderKanbanListHtml(items) {
  if (!items.length) return '<div class="empty-state" style="padding:2rem">暂无符合条件的任务</div>';
  return `<div class="project-table-wrap flow-list-wrap">
    <table class="project-table flow-list-table">
      <colgroup>
        <col class="flow-list-w-no"><col class="flow-list-w-title"><col class="flow-list-w-status"><col class="flow-list-w-priority">
        <col class="flow-list-w-person"><col class="flow-list-w-person"><col class="flow-list-w-person"><col class="flow-list-w-person">
        <col class="flow-list-w-time"><col class="flow-list-w-time"><col class="flow-list-w-action">
      </colgroup>
      <thead><tr>
        <th>编号</th><th>任务名称</th><th>状态</th><th>优先级</th>
        <th>提出人</th><th>审核人</th><th>主执行</th><th>协助人</th>
        <th>开始</th><th>更新</th><th>操作</th>
      </tr></thead>
      <tbody>${items.map(renderKanbanListRow).join('')}</tbody>
    </table>
  </div>`;
}

function kanbanListExportRow(item) {
  const meta = projectStatusMeta(item);
  const assist = (item.assistants || []).length ? item.assistants.join('、') : '';
  return [
    item.req_no || '',
    item.title || '',
    meta.label,
    priorityMeta(item.priority).label,
    item.created_by || '',
    item.reviewer || '',
    item.assignee || '',
    assist,
    fmtExportTime(item.created_at),
    fmtExportTime(item.updated_at),
  ];
}

function exportKanbanList() {
  const filtered = applyKanbanFilters(kanbanBaseItems());
  if (!filtered.length) {
    toast('暂无数据可导出', 'error');
    return;
  }
  const headers = ['任务编号', '任务名称', '状态', '优先级', '需求提出人', '审核人', '主执行人', '其他执行人', '开始时间', '最近更新时间'];
  const csv = '\uFEFF' + [headers, ...filtered.map(kanbanListExportRow)]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlobFile(blob, buildExportFileName({
    category: '任务中心',
    tags: kanbanFilterTags(),
    exporter: state.user?.name,
    count: filtered.length,
    ext: 'csv',
  }));
  toast(`已导出 ${filtered.length} 条任务`);
}

function renderKanbanFilterBar(baseItems) {
  const f = state.kanbanFilter || { flow: 'all', reviewer: '', executor: '' };
  const scoped = applyKanbanFilters(baseItems, 'flow');
  const counts = { all: scoped.length };
  FLOW_COLS.forEach(col => { counts[col.id] = scoped.filter(i => flowCategory(i) === col.id).length; });

  const reviewers = [...new Set(baseItems.map(i => i.reviewer).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
  const executors = [...new Set([
    ...baseItems.map(i => i.assignee).filter(Boolean),
    ...baseItems.flatMap(i => i.assistants || []),
  ])].sort((a, b) => a.localeCompare(b, 'zh'));

  const flowBtns = [
    { id: 'all', label: '全部', color: '#64748b' },
    ...FLOW_COLS.map(c => ({ id: c.id, label: c.label, color: c.color })),
  ].map(b => `<button type="button" class="flow-filter-btn ${f.flow === b.id ? 'active' : ''}" data-flow="${b.id}" style="--flow-color:${b.color}" onclick="setKanbanFilter('flow','${b.id}')">${b.label}<span class="flow-filter-count">${counts[b.id]}</span></button>`).join('');

  const reviewerSelect = isReviewerUser() ? `
    <div class="kanban-filter-field">
      <label>审核人员</label>
      <select onchange="setKanbanFilter('reviewer', this.value)">
        <option value="">全部审核人</option>
        ${reviewers.map(n => `<option value="${esc(n)}" ${f.reviewer === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
    </div>` : '';

  const executorSelect = `
    <div class="kanban-filter-field">
      <label>执行人员</label>
      <select onchange="setKanbanFilter('executor', this.value)">
        <option value="">全部执行人</option>
        ${executors.map(n => `<option value="${esc(n)}" ${f.executor === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
    </div>`;

  return `<div class="kanban-filter-bar card" id="kanban-filter-bar">
    <div class="flow-filter-group">${flowBtns}</div>
    <div class="kanban-people-filters">${reviewerSelect}${executorSelect}</div>
  </div>`;
}

function renderKanbanBoard(items) {
  return `<div class="kanban" id="kanban">
    ${FLOW_COLS.map(col => {
      const cards = sortByPriority(items.filter(i => flowCategory(i) === col.id));
      const overWip = cards.length > WIP_LIMITS[col.id];
      return `<div class="kanban-col" data-status="${col.id}">
        <div class="kanban-col-header" style="border-top:3px solid ${col.color}">
          <span>${col.label}</span>
          <span>
            ${overWip ? `<span class="wip-warn">WIP!</span> ` : ''}
            <span class="count">${cards.length}/${WIP_LIMITS[col.id]}</span>
          </span>
        </div>
        <div class="kanban-cards" data-status="${col.id}">
          ${cards.map(renderTaskCard).join('') || '<div class="kanban-empty">暂无任务</div>'}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderDashboard() {
  if (isReviewerUser()) return renderGlobalKanban();
  return renderExecutorDashboard();
}

function parseItemDeadline(item) {
  const m = (item.description || '').match(/期望[：:]\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function ganttEndDate(item) {
  if (item.completed_at) return new Date(item.completed_at);
  const dl = parseItemDeadline(item);
  if (dl) return new Date(`${dl}T23:59:59`);
  const sp = item.story_points || 3;
  return new Date(new Date(item.created_at).getTime() + sp * 2 * 86400000);
}

function isItemOverdue(item) {
  return flowCategory(item) === 'in_progress' && ganttEndDate(item).getTime() < Date.now();
}

function activityIcon(action) {
  return {
    progress: '📤', created: '➕', status_change: '🔄', completed: '✅',
    dispatched: '🚀', reviewer_terminate: '⏹', reviewer_reassign: '🔁',
    reviewer_revoke: '↩', reviewer_reject: '↩', confirmed: '✔️', priority_changed: '🎯',
    deleted: '🗑', auto_approved: '✅', auto_assigned: '🤖',
  }[action] || '•';
}

function buildCockpitStats() {
  const today = new Date().toISOString().slice(0, 10);
  const items = workflowItems();
  const activeItems = items.filter(i => flowCategory(i) === 'in_progress' || i.status === 'blocked');
  const counts = {
    in_progress: items.filter(i => flowCategory(i) === 'in_progress').length,
    blocked: items.filter(i => i.status === 'blocked').length,
    done: items.filter(i => flowCategory(i) === 'done').length,
    terminated: items.filter(i => flowCategory(i) === 'terminated').length,
  };
  const total = counts.in_progress + counts.blocked + counts.done + counts.terminated || 1;
  const p1Active = activeItems.filter(i => normalizePriority(i.priority) === 1);
  const noProgressToday = items.filter(i =>
    flowCategory(i) === 'in_progress' && i.assignee && !hasProgressToday(i, today)
  );
  const overdueItems = items.filter(i => isItemOverdue(i));
  const wipPct = Math.min(100, Math.round((counts.in_progress / WIP_LIMITS.in_progress) * 100));
  const wipOver = counts.in_progress > WIP_LIMITS.in_progress;

  let health = 100;
  health -= counts.blocked * 15;
  if (wipOver) health -= 20;
  else if (wipPct >= 80) health -= 8;
  health -= Math.min(noProgressToday.length * 5, 25);
  health -= Math.min(overdueItems.length * 8, 24);
  health = Math.max(0, Math.min(100, Math.round(health)));

  const healthRag = health >= 80 ? 'green' : health >= 60 ? 'yellow' : 'red';
  return {
    counts, total, p1Active, noProgressToday, overdueItems, wipPct, wipOver, health, healthRag, today,
  };
}

function buildActionQueue(stats) {
  const items = workflowItems();
  const seen = new Set();
  const queue = [];
  const push = (item, kind, label) => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    queue.push({ item, kind, label });
  };
  sortByPriority(items.filter(i => i.status === 'blocked')).forEach(i => push(i, 'blocked', '阻塞'));
  items.filter(i =>
    flowCategory(i) === 'in_progress' && normalizePriority(i.priority) === 1 && !hasProgressToday(i, stats.today)
  ).forEach(i => push(i, 'p1_no_progress', 'P1 · 今日未报'));
  sortByPriority(items.filter(i => isItemOverdue(i))).forEach(i => push(i, 'overdue', '超期'));
  sortByPriority(items.filter(i =>
    flowCategory(i) === 'in_progress' && normalizePriority(i.priority) === 1
  )).forEach(i => push(i, 'p1', 'P1 待推进'));
  return queue.slice(0, 8);
}

function buildFlowTrend(days = 7) {
  const base = workflowItems();
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const ts = new Date(d);
    ts.setHours(23, 59, 59, 999);
    const tsMs = ts.getTime();
    let in_progress = 0;
    let blocked = 0;
    let done = 0;
    base.forEach(item => {
      const created = new Date(item.created_at || 0).getTime();
      if (created > tsMs) return;
      const completed = item.completed_at ? new Date(item.completed_at).getTime() : null;
      if (completed && completed <= tsMs) {
        if (item.status === 'done') done++;
        return;
      }
      if (item.status === 'terminated') return;
      if (item.status === 'blocked') blocked++;
      else if (ACTIVE_STATUSES.includes(item.status) || item.status === 'in_progress') in_progress++;
    });
    buckets.push({ date: d.toISOString().slice(0, 10), label: fmtDateShort(d), in_progress, blocked, done });
  }
  return buckets;
}

function renderFlowTrendChart(buckets) {
  const max = Math.max(1, ...buckets.flatMap(b => [b.in_progress, b.blocked, b.done]));
  return `<div class="gk-trend-chart">${buckets.map(b => {
    const h1 = Math.round((b.in_progress / max) * 100);
    const h2 = Math.round((b.blocked / max) * 100);
    const h3 = Math.round((b.done / max) * 100);
    return `<div class="gk-trend-col" title="${b.label}">
      <div class="gk-trend-stack">
        <span class="gk-trend-seg gk-trend-seg--done" style="height:${h3}%"></span>
        <span class="gk-trend-seg gk-trend-seg--block" style="height:${h2}%"></span>
        <span class="gk-trend-seg gk-trend-seg--run" style="height:${h1}%"></span>
      </div>
      <span class="gk-trend-lbl">${b.label}</span>
    </div>`;
  }).join('')}</div>`;
}

function goTaskCenterPerson(name) {
  state.kanbanFilter = { flow: 'all', reviewer: '', executor: name };
  state.kanbanViewMode = 'list';
  navigate('taskcenter');
}

function updateGlobalKanbanChrome(stats) {
  const healthEl = document.getElementById('gk-health-wrap');
  if (healthEl) {
    healthEl.className = `gk-health-badge gk-health--${stats.healthRag}`;
    healthEl.innerHTML = `<span class="gk-health-dot"></span> 流动健康 <strong>${stats.health}</strong> 分`;
    healthEl.title = `阻塞 -${stats.counts.blocked * 15} · WIP${stats.wipOver ? '超限 -20' : stats.wipPct >= 80 ? '偏高 -8' : ''} · 今日未报 -${Math.min(stats.noProgressToday.length * 5, 25)} · 超期 -${Math.min(stats.overdueItems.length * 8, 24)}`;
  }
}

function taskProgressPulse(item, days = 7) {
  const today = new Date().toISOString().slice(0, 10);
  const bars = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    const has = (item.progress_updates || []).some(u => u.date === dayStr);
    bars.push({ has, isToday: dayStr === today });
  }
  return bars;
}

function lastProgressLabel(item) {
  const latest = (item.progress_updates || [])[0];
  if (!latest?.date) return '暂无进展';
  const today = new Date().toISOString().slice(0, 10);
  if (latest.date === today) return '今日';
  const daysAgo = Math.floor((Date.now() - new Date(`${latest.date}T12:00:00`).getTime()) / 86400000);
  if (daysAgo === 1) return '昨日';
  return `${daysAgo}天前`;
}

function taskStaleDays(item) {
  const latest = (item.progress_updates || [])[0];
  if (!latest?.date) return 99;
  return Math.floor((Date.now() - new Date(`${latest.date}T12:00:00`).getTime()) / 86400000);
}

function buildFlowPieGradient(stats) {
  const { counts, total } = stats;
  if (!total) return '#e2e8f0';
  const slices = FLOW_COLS.map(col => ({ color: col.color, count: counts[col.id] })).filter(s => s.count > 0);
  if (!slices.length) return '#e2e8f0';
  let deg = 0;
  return `conic-gradient(${slices.map(s => {
    const sweep = (s.count / total) * 360;
    const start = deg;
    deg += sweep;
    return `${s.color} ${start}deg ${deg}deg`;
  }).join(', ')})`;
}

function buildExecutingInsight(stats) {
  const today = stats.today;
  const running = workflowItems().filter(i => flowCategory(i) === 'in_progress');
  const reportedToday = running.filter(i => hasProgressToday(i, today));
  const notReportedToday = running.filter(i => i.assignee && !hasProgressToday(i, today));
  const updateRate = running.length ? Math.round((reportedToday.length / running.length) * 100) : 0;
  const rateRag = updateRate >= 70 ? 'green' : updateRate >= 50 ? 'yellow' : 'red';

  const activePeople = new Set();
  workflowItems().forEach(item => {
    (item.progress_updates || []).forEach(u => {
      const t = u.created_at ? new Date(u.created_at) : (u.date ? new Date(`${u.date}T12:00:00`) : null);
      if (t && !Number.isNaN(t.getTime()) && Date.now() - t.getTime() < 7 * 86400000 && u.user) {
        activePeople.add(u.user);
      }
    });
  });

  const personMap = {};
  running.forEach(item => {
    involvedExecutors(item).forEach(name => {
      if (!personMap[name]) personMap[name] = { name, primary: 0, assist: 0, progress7: 0, reportStatus: 'no', reportLabel: '未报' };
      if (item.assignee === name) personMap[name].primary++;
      else personMap[name].assist++;
    });
  });
  Object.values(personMap).forEach(p => {
    const rs = getPersonReportStatus(p.name, running, today);
    p.reportStatus = rs.status;
    p.reportLabel = rs.label;
    p.reportedPrimary = rs.reportedPrimary;
    p.reportedAssist = rs.reportedAssist;
  });
  running.forEach(item => {
    (item.progress_updates || []).forEach(u => {
      const t = u.created_at ? new Date(u.created_at) : (u.date ? new Date(`${u.date}T12:00:00`) : null);
      if (t && !Number.isNaN(t.getTime()) && Date.now() - t.getTime() < 7 * 86400000 && u.user && personMap[u.user]) {
        personMap[u.user].progress7++;
      }
    });
  });
  const persons = Object.values(personMap).sort((a, b) => b.progress7 - a.progress7 || b.primary - a.primary).slice(0, 6);
  const maxProg = Math.max(1, ...persons.map(p => p.progress7));

  const tasks = sortByPriority([...running])
    .sort((a, b) => (hasProgressToday(a, today) ? 1 : 0) - (hasProgressToday(b, today) ? 1 : 0) || normalizePriority(a.priority) - normalizePriority(b.priority))
    .slice(0, 8)
    .map(item => ({
      item,
      pulse: taskProgressPulse(item),
      lastLabel: lastProgressLabel(item),
      todayOk: hasProgressToday(item, today),
      staleDays: taskStaleDays(item),
    }));

  return {
    runningCount: running.length,
    reportedCount: reportedToday.length,
    notReportedCount: notReportedToday.length,
    activePeopleCount: activePeople.size,
    updateRate,
    rateRag,
    persons: persons.map(p => ({
      ...p,
      heatPct: Math.round((p.progress7 / maxProg) * 100),
      heatCls: p.progress7 >= maxProg * 0.7 ? 'hot' : p.progress7 >= maxProg * 0.35 ? 'warm' : 'cool',
    })),
    tasks,
  };
}

function renderFlowPiePanel(stats) {
  const { counts, total } = stats;
  const gradient = buildFlowPieGradient(stats);
  const runPct = total ? Math.round((counts.in_progress / total) * 100) : 0;
  const legend = FLOW_COLS.map(col => {
    const count = counts[col.id];
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `<div class="gk-pie-legend-row" onclick="goTaskCenter('${col.id}', '${col.id === 'in_progress' ? 'board' : 'list'}')" title="查看${col.label}">
      <span class="gk-pie-legend-left"><i class="gk-pie-dot" style="background:${col.color}"></i>${col.label}</span>
      <span><strong>${count}</strong> <span class="gk-pie-pct">${pct}%</span></span>
    </div>`;
  }).join('');

  return `<div id="gk-viz-pie" class="dashboard-panel gk-panel gk-viz-pie">
    <div class="gk-panel-head">
      <span class="section-title">四态分布</span>
      <span class="gk-panel-sub">共 ${total} 项${stats.wipOver ? ` · <span class="gk-wip-warn">WIP ${counts.in_progress}/${WIP_LIMITS.in_progress} 超限</span>` : ''} · 点击图例筛选</span>
    </div>
    <div class="gk-pie-wrap">
      <div class="gk-pie-chart" style="background:${gradient}">
        <div class="gk-pie-center">
          <strong class="gk-pie-run-val">${counts.in_progress}</strong>
          <span>执行中 ${runPct}%</span>
        </div>
      </div>
      <div class="gk-pie-legend">${legend}</div>
    </div>
  </div>`;
}

function renderExecutingInsightPanel(insight) {
  const ringDeg = Math.round((insight.updateRate / 100) * 360);
  const ringColor = insight.rateRag === 'green' ? '#22c55e' : insight.rateRag === 'yellow' ? STAR_GOLD : '#ef4444';

  const personRows = insight.persons.length ? insight.persons.map(p => {
    const tip = [
      p.primary ? `主执行今日本人已报 ${p.reportedPrimary}/${p.primary} 项` : null,
      p.assist ? `协助今日本人已报 ${p.reportedAssist}/${p.assist} 项` : null,
    ].filter(Boolean).join(' · ');
    return `
    <div class="gk-ph-row" onclick='goTaskCenterPerson(${JSON.stringify(p.name)})'>
      <span class="gk-ph-name">${esc(p.name)}</span>
      <div class="gk-ph-bar-wrap"><div class="gk-ph-bar gk-ph-bar--${p.heatCls}" style="width:${p.heatPct}%"></div></div>
      <span class="gk-ph-meta">7日 ${p.progress7} 次 · 主${p.primary}</span>
      <span class="gk-ph-today ${p.reportStatus}" title="${esc(tip)}">${esc(p.reportLabel)}</span>
    </div>`;
  }).join('') : '<div class="empty-state">暂无执行中人员</div>';

  const taskRows = insight.tasks.length ? insight.tasks.map(({ item, pulse, lastLabel, todayOk, staleDays }) => {
    const badge = todayOk ? '<span class="gk-tv-badge gk-tv-badge--ok">今日已报</span>'
      : staleDays >= 3 ? `<span class="gk-tv-badge gk-tv-badge--stale">${staleDays}日未动</span>`
      : '<span class="gk-tv-badge gk-tv-badge--no">今日未报</span>';
    const pulseHtml = pulse.map(b =>
      `<span class="${b.has ? (b.isToday ? 'today' : 'on') : ''}"></span>`
    ).join('');
    const pri = priorityMeta(item.priority);
    return `<div class="gk-tv-item" onclick="showTaskDetailView('${item.id}')">
      <div class="gk-tv-info">
        <div class="gk-tv-title">${item.req_no ? `<span class="req-no-tag req-no-tag--sm">${esc(item.req_no)}</span> ` : ''}${esc(item.title)}</div>
        <div class="gk-tv-sub">${esc(item.assignee || '-')} · ${pri.short} · 最近：${lastLabel}</div>
      </div>
      <div class="gk-tv-pulse" title="过去7天每日进展">${pulseHtml}</div>
      ${badge}
    </div>`;
  }).join('') : '<div class="empty-state">暂无执行中任务</div>';

  return `<div id="gk-exec-insight" class="dashboard-panel gk-panel gk-viz-exec">
    <div class="gk-panel-head">
      <span class="section-title">⚡ 执行中任务洞察</span>
      <span class="gk-panel-sub">${insight.runningCount} 项进行中</span>
    </div>
    <div class="gk-exec-summary">
      <div class="gk-exec-chip gk-exec-chip--run"><strong>${insight.runningCount}</strong><span>执行中</span></div>
      <div class="gk-exec-chip gk-exec-chip--ok"><strong>${insight.reportedCount}</strong><span>今日已报</span></div>
      <div class="gk-exec-chip gk-exec-chip--warn"><strong>${insight.notReportedCount}</strong><span>今日未报</span></div>
      <div class="gk-exec-chip gk-exec-chip--hot"><strong>${insight.activePeopleCount}</strong><span>7日活跃人数</span></div>
    </div>
    <div class="gk-rate-row">
      <div class="gk-rate-ring gk-rate-ring--${insight.rateRag}" style="background:conic-gradient(${ringColor} 0deg ${ringDeg}deg, #e2e8f0 ${ringDeg}deg 360deg)">
        <div class="gk-rate-ring-inner"><strong>${insight.updateRate}%</strong><span>今日更新率</span></div>
      </div>
      <div class="gk-rate-desc">
        <p>今日已报 <strong>${insight.reportedCount}</strong> · 未报 <strong>${insight.notReportedCount}</strong></p>
        <p class="gk-rate-hint">脉搏图：蓝=有进展 · 绿=今日已报 · 灰=无进展</p>
      </div>
    </div>
    <div class="gk-viz-split">
      <div class="gk-viz-col">
        <div class="gk-viz-col-title">人员活跃（7日 + 今日）</div>
        <div class="gk-ph-list">${personRows}</div>
      </div>
      <div class="gk-viz-col">
        <div class="gk-viz-col-title">任务脉搏（近7日）</div>
        <div class="gk-tv-list" id="gk-tv-list">${taskRows}</div>
      </div>
    </div>
  </div>`;
}

function fmtDateShort(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getMonth() + 1}/${x.getDate()}`;
}

function buildMemberActivity(days = 7) {
  const since = Date.now() - days * 86400000;
  const map = {};
  const bump = (name, kind) => {
    if (!name) return;
    if (!map[name]) map[name] = { name, actions: 0, progress: 0, score: 0 };
    map[name][kind] += 1;
    map[name].score += kind === 'progress' ? 3 : 1;
  };
  state.activity.forEach(a => {
    if (new Date(a.created_at).getTime() >= since) bump(a.actor, 'actions');
  });
  workflowItems().forEach(item => {
    (item.progress_updates || []).forEach(u => {
      const t = u.created_at ? new Date(u.created_at) : (u.date ? new Date(`${u.date}T12:00:00`) : null);
      if (t && !Number.isNaN(t.getTime()) && t.getTime() >= since) bump(u.user, 'progress');
    });
  });
  const maxScore = Math.max(1, ...Object.values(map).map(m => m.score));
  return Object.values(map).sort((a, b) => b.score - a.score).map(m => ({ ...m, pct: Math.round((m.score / maxScore) * 100) }));
}

function buildWorkloadStats() {
  const items = workflowItems().filter(i => flowCategory(i) === 'in_progress' || i.status === 'blocked');
  const map = {};
  const touch = (name, kind) => {
    if (!name) return;
    if (!map[name]) map[name] = { name, primary: 0, assist: 0, blocked: 0, points: 0 };
    map[name][kind] += 1;
  };
  items.forEach(i => {
    touch(i.assignee, 'primary');
    if (i.status === 'blocked') touch(i.assignee, 'blocked');
    if (i.assignee) map[i.assignee].points += i.story_points || 0;
    (i.assistants || []).forEach(a => touch(a, 'assist'));
  });
  return Object.values(map).sort((a, b) => (b.primary + b.assist) - (a.primary + a.assist));
}

function buildGanttRows(limit = 14) {
  const items = workflowItems()
    .filter(i => i.req_no && flowCategory(i) !== 'terminated')
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    .slice(0, limit);
  if (!items.length) return { items: [], rangeStart: new Date(), rangeEnd: new Date(), totalMs: 1 };

  const now = Date.now();
  let minT = now - 7 * 86400000;
  let maxT = now + 14 * 86400000;
  items.forEach(i => {
    const s = new Date(i.created_at).getTime();
    const e = ganttEndDate(i).getTime();
    minT = Math.min(minT, s);
    maxT = Math.max(maxT, e);
  });
  const pad = 2 * 86400000;
  const rangeStart = new Date(minT - pad);
  const rangeEnd = new Date(maxT + pad);
  const totalMs = Math.max(rangeEnd - rangeStart, 86400000);

  const rows = items.map(i => {
    const start = new Date(i.created_at).getTime();
    const end = ganttEndDate(i).getTime();
    const cat = flowCategory(i);
    const color = FLOW_COLS.find(c => c.id === cat)?.color || '#64748b';
    return {
      id: i.id,
      title: i.title,
      reqNo: i.req_no,
      assignee: i.assignee || '-',
      cat,
      color,
      left: ((start - rangeStart) / totalMs) * 100,
      width: Math.max(2, ((end - start) / totalMs) * 100),
      overdue: cat === 'in_progress' && end < now,
    };
  });

  return { items: rows, rangeStart, rangeEnd, totalMs, nowPct: ((now - rangeStart) / totalMs) * 100 };
}

function renderGanttTicks(rangeStart, rangeEnd) {
  const ticks = [];
  const days = Math.ceil((rangeEnd - rangeStart) / 86400000);
  const step = days <= 14 ? 1 : days <= 28 ? 2 : 7;
  for (let i = 0; i <= days; i += step) {
    const d = new Date(rangeStart.getTime() + i * 86400000);
    const left = (i / days) * 100;
    ticks.push(`<span class="gk-gantt-tick" style="left:${left}%">${fmtDateShort(d)}</span>`);
  }
  return ticks.join('');
}

function renderGanttPanelContent(gantt) {
  return `<div class="gk-gantt-sub">${fmtDateShort(gantt.rangeStart)} — ${fmtDateShort(gantt.rangeEnd)} · 竖线=今日</div>${renderGanttPanelInner(gantt)}`;
}

function renderGanttPanelInner(gantt) {
  const ganttBody = gantt.items.length ? gantt.items.map(r => `<div class="gk-gantt-row">
    <div class="gk-gantt-label" onclick="showItemDetail('${r.id}')" title="${esc(r.title)}">
      <span class="req-no-tag">${esc(r.reqNo)}</span>
      <span class="gk-gantt-task">${esc(r.title)}</span>
      <span class="gk-gantt-assignee">${esc(r.assignee)}</span>
    </div>
    <div class="gk-gantt-track">
      <div class="gk-gantt-bar ${r.overdue ? 'gk-gantt-bar--overdue' : ''}" style="left:${r.left}%;width:${r.width}%;background:${r.color}" title="${projectStatusMeta({ status: r.cat === 'done' ? 'done' : r.cat === 'blocked' ? 'blocked' : 'in_progress' }).label}"></div>
      <div class="gk-gantt-today" style="left:${gantt.nowPct}%"></div>
    </div>
  </div>`).join('') : '<div class="empty-state" style="padding:1.5rem">暂无甘特图数据</div>';
  return `<div class="gk-gantt">
    <div class="gk-gantt-axis">
      <div class="gk-gantt-label-col">任务 / 执行人</div>
      <div class="gk-gantt-ticks">${renderGanttTicks(gantt.rangeStart, gantt.rangeEnd)}</div>
    </div>
    ${ganttBody}
  </div>`;
}

function renderDashboardKpiStrip(stats, metrics) {
  const m = metrics || state.metrics;
  return `
    <div class="kpi-chip"><span class="kpi-label">近14天吞吐量</span><strong>${m.throughput}</strong><span class="kpi-unit">项</span></div>
    <div class="kpi-chip"><span class="kpi-label">平均 Lead Time</span><strong>${m.avgLeadTime}</strong><span class="kpi-unit">天</span></div>
    <div class="kpi-chip ${stats.p1Active.length ? 'kpi-alert' : ''}"><span class="kpi-label">P1 待推进</span><strong>${stats.p1Active.length}</strong><span class="kpi-unit">项</span></div>
    <div class="kpi-chip ${stats.overdueItems.length ? 'kpi-alert' : ''}"><span class="kpi-label">超期任务</span><strong>${stats.overdueItems.length}</strong><span class="kpi-unit">项</span></div>`;
}

function renderActionQueueRows(actionQueue) {
  return actionQueue.length ? actionQueue.map(({ item, kind, label }) => `
    <div class="gk-action-item ${kind === 'blocked' || kind === 'p1_no_progress' ? 'gk-action-item--urgent' : ''}" onclick="showTaskDetailView('${item.id}')">
      ${item.req_no ? `<span class="req-no-tag req-no-tag--sm">${esc(item.req_no)}</span>` : ''}
      ${normalizePriority(item.priority) === 1 ? '<span class="gk-action-p1">P1</span>' : ''}
      <span class="gk-action-title">${esc(item.title)}</span>
      <span class="gk-action-meta">${esc(label)} · ${esc(item.assignee || '-')}</span>
    </div>`).join('') : '<div class="empty-state">暂无待处理事项 🎉</div>';
}

function feedOneLine(a) {
  if (a.action === 'progress') {
    const text = (a.progress_text || '').trim() || '（无说明）';
    const task = a.item_title || '任务';
    return `${a.actor || '系统'} · ${task} · ${text}`;
  }
  return `${a.actor || '系统'} · ${a.detail || ''}${a.item_title ? ` · ${a.item_title}` : ''}`;
}

function renderActivityFeedHtml(limit = 6) {
  return state.activity.slice(0, limit).map(a => {
    const line = feedOneLine(a);
    return `<div class="gk-feed-item" title="${esc(line)}">
      <span class="gk-feed-icon">${activityIcon(a.action)}</span>
      <span class="gk-feed-line">${esc(line)}</span>
      <span class="gk-feed-time">${fmtTime(a.created_at)}</span>
    </div>`;
  }).join('') || '<div class="gk-feed-empty">暂无动态</div>';
}

function renderActivityFeedPanel(topInsight) {
  const banner = topInsight ? `<div class="gk-insight-banner gk-insight-banner--compact ${topInsight.severity}">
    <strong>🧠 ${esc(topInsight.title)}</strong>
    <span>${esc(topInsight.content.slice(0, 72))}${topInsight.content.length > 72 ? '…' : ''}</span>
  </div>` : '';
  return `<div id="gk-feed-panel" class="dashboard-panel gk-panel gk-feed-panel">
    ${banner}
    <div class="gk-feed-head-bar">
      <span class="gk-feed-title">🔴 实时动态</span>
      <span class="gk-live-dot"></span>
    </div>
    <div class="gk-feed gk-feed--compact" id="gk-feed">${renderActivityFeedHtml()}</div>
  </div>`;
}

function updateDashboardLivePanels() {
  const stats = buildCockpitStats();
  const execInsight = buildExecutingInsight(stats);
  const trend = buildFlowTrend(7);
  const actionQueue = buildActionQueue(stats);

  const kpi = document.getElementById('gk-kpi-strip');
  if (kpi) kpi.innerHTML = renderDashboardKpiStrip(stats);

  const pie = document.getElementById('gk-viz-pie');
  if (pie) pie.outerHTML = renderFlowPiePanel(stats);

  const exec = document.getElementById('gk-exec-insight');
  if (exec) exec.outerHTML = renderExecutingInsightPanel(execInsight);

  const topInsight = state.insights.find(i => i.severity === 'warning') || state.insights[0];
  refreshActivityFeedDom();

  const actionSub = document.querySelector('#gk-action-panel .gk-panel-sub');
  if (actionSub) actionSub.textContent = `${actionQueue.length} 项`;
  const actionList = document.getElementById('gk-action-list');
  if (actionList) actionList.innerHTML = renderActionQueueRows(actionQueue);

  const trendWrap = document.getElementById('gk-trend-chart-wrap');
  if (trendWrap) {
    trendWrap.innerHTML = `${renderFlowTrendChart(trend)}
        <div class="gk-trend-legend">
          <span><i class="gk-legend-run"></i>执行中</span>
          <span><i class="gk-legend-block"></i>阻塞</span>
          <span><i class="gk-legend-done"></i>归档</span>
        </div>`;
  }

  const ganttDetail = document.getElementById('gk-detail-content');
  if (ganttDetail) ganttDetail.innerHTML = renderGanttPanelContent(buildGanttRows());

  updateGlobalKanbanChrome(stats);
  updateWorkflowBadge();
  return stats;
}

function renderGlobalKanbanBody() {
  const m = state.metrics;
  const stats = buildCockpitStats();
  const { counts, total } = stats;
  const trend = buildFlowTrend(7);
  const actionQueue = buildActionQueue(stats);
  const gantt = buildGanttRows();
  const execInsight = buildExecutingInsight(stats);
  const topInsight = state.insights.find(i => i.severity === 'warning') || state.insights[0];

  const actionRows = renderActionQueueRows(actionQueue);

  return `
    <div id="gk-kpi-strip" class="dashboard-kpi-strip gk-kpi-compact">
      ${renderDashboardKpiStrip(stats, m)}
    </div>

    <div class="gk-viz-board">
      ${renderFlowPiePanel(stats)}
      ${renderExecutingInsightPanel(execInsight)}
    </div>

    <div class="gk-l2-grid">
      <div id="gk-action-panel" class="dashboard-panel gk-panel gk-action-panel">
        <div class="gk-panel-head">
          <span class="section-title">⚠️ 需立即处理</span>
          <span class="gk-panel-sub">${actionQueue.length} 项</span>
        </div>
        <div id="gk-action-list" class="gk-action-list">${actionRows}</div>
        <div class="gk-action-foot">
          <button type="button" class="btn btn-ghost btn-sm" onclick="goTaskCenter('blocked','list')">全部阻塞 →</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="goTaskCenter('in_progress','list')">执行中列表 →</button>
        </div>
      </div>
      <div id="gk-trend-panel" class="dashboard-panel gk-panel">
        <div class="gk-panel-head">
          <span class="section-title">📈 近 7 日流动趋势</span>
          <span class="gk-panel-sub">执行 / 阻塞 / 归档</span>
        </div>
        <div id="gk-trend-chart-wrap">
          ${renderFlowTrendChart(trend)}
          <div class="gk-trend-legend">
            <span><i class="gk-legend-run"></i>执行中</span>
            <span><i class="gk-legend-block"></i>阻塞</span>
            <span><i class="gk-legend-done"></i>归档</span>
          </div>
        </div>
      </div>
    </div>

    ${renderActivityFeedPanel(topInsight)}

    <div class="gk-l3-grid gk-l3-single">
      <div class="dashboard-panel gk-panel gk-detail-panel">
        <div class="gk-panel-head">
          <span class="section-title">📅 甘特图</span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="goTaskCenter('all','board')">任务中心 →</button>
        </div>
        <div id="gk-detail-content">${renderGanttPanelContent(gantt)}</div>
      </div>
    </div>`;
}

function renderGlobalKanban() {
  const stats = buildCockpitStats();
  state.globalKanbanUpdatedAt = new Date();
  const ts = state.globalKanbanUpdatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `<div class="dashboard global-kanban global-kanban--v4">
    <div class="gk-live-bar">
      <div id="gk-health-wrap" class="gk-health-badge gk-health--${stats.healthRag}" title="流动健康度综合评分">
        <span class="gk-health-dot"></span> 流动健康 <strong>${stats.health}</strong> 分
      </div>
      <span class="gk-live-badge"><span class="gk-live-dot"></span> 动态刷新</span>
      <span class="gk-live-meta" id="gk-last-updated">更新于 ${ts} · 与任务中心同步</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="refreshGlobalKanban(true)">↻ 立即刷新</button>
    </div>
    <div id="global-kanban-root">${renderGlobalKanbanBody()}</div>
  </div>`;
}

function stopGlobalKanbanPolling() {
  if (globalKanbanTimer) { clearInterval(globalKanbanTimer); globalKanbanTimer = null; }
}

async function refreshGlobalKanban(manual = false) {
  if (state.currentView !== 'dashboard' || !isReviewerUser()) return;
  try {
    await loadData();
    state.globalKanbanUpdatedAt = new Date();
    const root = document.getElementById('global-kanban-root');
    if (root?.querySelector('#gk-exec-insight')) {
      updateDashboardLivePanels();
    } else if (root) {
      root.innerHTML = renderGlobalKanbanBody();
      updateGlobalKanbanChrome(buildCockpitStats());
      updateWorkflowBadge();
    }
    const meta = document.getElementById('gk-last-updated');
    if (meta && state.globalKanbanUpdatedAt) {
      meta.textContent = `更新于 ${state.globalKanbanUpdatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}${manual ? ' · 手动' : ' · 自动'} · 与任务中心同步`;
    }
  } catch { /* ignore polling errors */ }
}

function startGlobalKanbanPolling() {
  stopGlobalKanbanPolling();
  if (state.currentView !== 'dashboard' || !isReviewerUser()) return;
  globalKanbanTimer = setInterval(() => refreshGlobalKanban(false), DASHBOARD_POLL_MS);
}

async function reloadViewAfterMutation(preferredView) {
  const view = preferredView || state.currentView || boardView();
  if (view === 'dashboard' && isReviewerUser()) {
    await refreshGlobalKanban(true);
    return;
  }
  await navigate(view);
}

function renderLeaderDashboard() {
  return renderGlobalKanban();
}

function renderExecutorDashboard() {
  const m = state.metrics;
  const myPrimary = state.items.filter(i => i.assignee === state.user?.name && ACTIVE_STATUSES.includes(i.status)).length;
  const myAssist = state.items.filter(i => (i.assistants||[]).includes(state.user?.name) && i.assignee !== state.user?.name && (ACTIVE_STATUSES.includes(i.status) || i.status === 'blocked')).length;
  const myDone = state.items.filter(i => i.assignee === state.user?.name && i.status === 'done').length;
  const mySubmitted = state.items.filter(i => i.created_by === state.user?.name).length;

  return `
    <div class="dashboard">
      <div class="card-grid">
        <div class="card stat-card blue"><div class="label">主执行任务</div><div class="value">${myPrimary}</div></div>
        <div class="card stat-card yellow"><div class="label">协助任务</div><div class="value">${myAssist}</div></div>
        <div class="card stat-card green"><div class="label">已完成</div><div class="value">${myDone}</div></div>
        <div class="card stat-card purple"><div class="label">我提交的</div><div class="value">${mySubmitted}</div></div>
      </div>
      <div class="dashboard-kpi-strip">
        <div class="kpi-chip"><span class="kpi-label">近14天吞吐量</span><strong>${m.throughput}</strong><span class="kpi-unit">项</span></div>
        <div class="kpi-chip"><span class="kpi-label">平均 Lead Time</span><strong>${m.avgLeadTime}</strong><span class="kpi-unit">天</span></div>
      </div>
      <div class="dashboard-quick-actions" style="margin-top:0.5rem">
        <button class="btn btn-primary btn-sm" onclick="navigate('mywork')">💼 今日工作台</button>
        <button class="btn btn-ghost btn-sm" onclick="navigate('submit')">📤 提交需求</button>
      </div>
    </div>`;
}

function renderKanbanCore() {
  if (!state.kanbanFilter) state.kanbanFilter = { flow: 'all', reviewer: '', executor: '' };
  if (!state.kanbanViewMode) state.kanbanViewMode = 'list';
  const base = kanbanBaseItems();
  const filtered = applyKanbanFilters(base);
  const isBoard = state.kanbanViewMode === 'board';
  const content = isBoard
    ? `<div class="kanban-page-board">${renderKanbanBoard(filtered)}</div>`
    : renderKanbanListHtml(filtered);
  const hintText = isBoard
    ? `共 ${filtered.length} 项任务 · 四列看板 · ${isReviewerUser() ? '领导可拖拽移列' : '点击卡片查看详情'}`
    : `共 ${filtered.length} 项任务 · 点击列表行查看详情`;
  return `${renderKanbanViewTabs()}
    ${renderKanbanFilterBar(base)}
    <div id="kanban-content-area">${content}</div>
    <p class="flow-list-hint" id="kanban-list-hint">${hintText}</p>`;
}

function renderTaskCenter() {
  const blocked = kanbanBaseItems().filter(i => i.status === 'blocked').length;
  const blockedAlert = blocked
    ? `<div class="alert-banner">🚧 当前有 <strong>${blocked}</strong> 项阻塞任务${canModifyKanban() ? '待处理' : ''} <button type="button" class="btn btn-ghost btn-sm" onclick="goTaskCenter('blocked')">立即查看</button></div>`
    : '';
  const readonlyHint = canModifyKanban()
    ? ''
    : '<div class="alert-banner alert-banner--info">👁️ 任务中心全员可见；执行人员仅可查看任务与进展，状态变更请在「今日工作台」提交进展后由领导处理</div>';
  return `${readonlyHint}${blockedAlert}${renderKanbanCore()}`;
}

function renderKanban() {
  return renderTaskCenter();
}

function renderAcceptance() {
  const items = isLeaderUser()
    ? state.items.filter(i => i.status === 'done')
    : state.items.filter(i => i.status === 'done' && i.reviewer === state.user?.name);
  if (!items.length) return `<div class="empty-state">✅ 当前无已归档任务<br><span style="font-size:0.85rem">执行人员标记完成后自动归档，领导可在任务中心退回执行中</span></div>`;
  return `
    <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1rem">已归档任务查看。领导可将任务退回执行中。</p>
    ${items.map(i => {
    const updates = (i.progress_updates || []).slice(0, 5);
    return `<div class="accept-card">
      ${i.req_no ? `<span class="req-no-tag">${esc(i.req_no)}</span> ` : ''}
      <span class="type-badge type-${i.type}">${TYPE_LABELS[i.type]}</span>
      <span class="project-status-pill ${projectStatusMeta(i).cls}">${projectStatusMeta(i).label}</span>
      <h3>${esc(i.title)}</h3>
      <p style="color:var(--muted);font-size:0.85rem">${esc(i.description || '')}</p>
      <p style="font-size:0.82rem">${taskPeopleHtml(i)}</p>
      ${updates.length ? `<div class="section-title" style="font-size:0.82rem;margin-top:0.5rem">任务进展记录</div>
        <div style="font-size:0.82rem;max-height:120px;overflow-y:auto;margin-bottom:0.75rem">
          ${updates.map(u => `<div style="padding:0.3rem 0;border-bottom:1px solid var(--border)"><strong>${u.date}</strong> ${esc(u.user)}: ${esc(u.description)}</div>`).join('')}
        </div>` : ''}
      <div class="criteria"><strong>验收标准:</strong>\n${esc(i.acceptance_criteria || '无')}</div>
      <div class="accept-actions">
        <button class="btn btn-ghost btn-sm" onclick="reviewerRevoke('${i.id}')" style="border-color:${STAR_GOLD};color:#6b5410">↩ 退回执行中</button>
      </div>
    </div>`;
  }).join('')}`;
}

function renderDemandAI() {
  const tab = state.demandAiTab || 'submit';
  return `
    <div class="page-tabs">
      <button type="button" class="page-tab ${tab === 'submit' ? 'active' : ''}" onclick="setDemandAiTab('submit')">📤 新建需求</button>
      <button type="button" class="page-tab ${tab === 'ai' ? 'active' : ''}" onclick="setDemandAiTab('ai')">🤖 AI 工具</button>
    </div>
    <div class="page-tab-panel">${tab === 'submit' ? renderSubmitBody() : renderAI()}</div>`;
}

function renderAI() {
  const showSplit = (state.user?.capabilities || []).includes('reviewer');
  const ai = state.aiStatus || {};
  return `
    <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1rem">AI 工具：需求拆分、站会摘要、风险扫描、智能对话。新建需求请使用「需求与 AI」页。</p>
    <div class="ai-panel">
      ${showSplit ? `<div class="ai-card">
        <h3>🧠 AI 需求拆分 ${state.llmEnabled ? '<span class="llm-tag">LLM</span>' : ''}</h3>
        <p style="color:var(--muted);font-size:0.85rem;margin-bottom:0.75rem">输入文字 → Epic + Story + Task</p>
        <div class="form-group"><textarea id="aiRequirement" placeholder="描述需求内容..."></textarea></div>
        <button class="btn btn-primary" onclick="runSplit()">🚀 AI 拆分并创建</button>
        <div class="ai-result" id="aiSplitResult" style="display:none"></div>
      </div>` : ''}
      <div class="ai-card" style="${showSplit ? '' : 'grid-column:1/-1'}">
        <h3>💬 AI 管理协作者 ${state.llmEnabled ? '<span class="llm-tag">Agent</span>' : '<span class="llm-tag local">本地</span>'}</h3>
        <div class="chat-box" id="chatBox">
          <div class="chat-messages" id="chatMessages">
            <div class="chat-msg assistant">你好 ${esc(state.user?.name)}！我可以帮你分析任务、评估风险、查看阻塞项。</div>
          </div>
          <div class="chat-input-row">
            <input id="chatInput" placeholder="问我 anything：任务进度、风险分析、拆分建议..." onkeydown="if(event.key==='Enter')sendChat()">
            <button class="btn btn-primary btn-sm" onclick="sendChat()">发送</button>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="quickChat('分析当前项目风险并给出行动项')">风险分析</button>
          <button class="btn btn-ghost btn-sm" onclick="runStandup()">站会摘要</button>
          <button class="btn btn-ghost btn-sm" onclick="runRisks()">风险扫描</button>
          ${showSplit ? '<button class="btn btn-ghost btn-sm" onclick="runReviewReport()">回顾报告</button>' : ''}
          <button class="btn btn-ghost btn-sm" onclick="sendDeepChat()">🧠 深度推理</button>
        </div>
      </div>
      ${showSplit ? `<div class="ai-card" style="grid-column:1/-1">
        <h3>📡 AI 洞察历史</h3>
        <div class="insight-list" id="insightList">
          ${state.insights.map(i => `<div class="insight-item ${i.severity}"><div class="insight-title">${esc(i.title)}</div><div class="insight-time">${fmtTime(i.created_at)} · ${i.type}</div><div class="insight-content">${esc(i.content)}</div></div>`).join('') || '<div class="empty-state">暂无</div>'}
        </div>
      </div>` : ''}
    </div>
    <p style="font-size:0.78rem;color:var(--muted);margin-top:0.75rem">引擎: ${ai.llm ? `🧠 ${ai.llm.provider}` : '未配置'}</p>`;
}

function setWorkbenchFilter(filter) {
  state.workbenchFilter = state.workbenchFilter === filter ? 'all' : filter;
  if (state.currentView === 'mywork') {
    document.getElementById('content').innerHTML = renderMyWork();
  }
}

function workbenchFilterLabel(filter) {
  const labels = {
    all: '全部任务',
    primary: '待办任务',
    assist: '协助任务',
    no_progress: '今日未报进展',
    blocked: '阻塞任务',
  };
  return labels[filter] || '全部任务';
}

function hasProgressToday(item, today) {
  const day = today || new Date().toISOString().slice(0, 10);
  return (item.progress_updates || []).some(u => u.date === day);
}

function hasPersonalProgressToday(name, item, today) {
  const day = today || new Date().toISOString().slice(0, 10);
  return (item.progress_updates || []).some(u => u.date === day && u.user === name);
}

function involvedExecutors(item) {
  return [...new Set([item.assignee, ...(item.assistants || [])].filter(Boolean))];
}

/** 人员今日报送状态：任务看覆盖率，人员看本人是否提交 */
function getPersonReportStatus(name, running, today) {
  const day = today || new Date().toISOString().slice(0, 10);
  const primary = running.filter(i => i.assignee === name);
  const assist = running.filter(i => (i.assistants || []).includes(name));

  if (primary.length) {
    const reportedPrimary = primary.filter(i => hasPersonalProgressToday(name, i, day)).length;
    const reportedAssist = assist.filter(i => hasPersonalProgressToday(name, i, day)).length;
    let status = 'no';
    let label = '未报';
    if (reportedPrimary > 0) {
      if (primary.length >= 2 && reportedPrimary < primary.length) {
        status = 'partial';
        label = `部分 ${reportedPrimary}/${primary.length}`;
      } else {
        status = 'ok';
        label = '已报';
      }
    }
    return { status, label, reportedPrimary, reportedAssist, primaryTotal: primary.length, assistTotal: assist.length };
  }

  if (assist.length) {
    const reportedAssist = assist.filter(i => hasPersonalProgressToday(name, i, day)).length;
    return {
      status: reportedAssist > 0 ? 'ok' : 'no',
      label: reportedAssist > 0 ? '已报' : '未报',
      reportedPrimary: 0,
      reportedAssist,
      primaryTotal: 0,
      assistTotal: assist.length,
    };
  }

  return { status: 'no', label: '未报', reportedPrimary: 0, reportedAssist: 0, primaryTotal: 0, assistTotal: 0 };
}

function renderWorkbenchSummaryChip(filter, label, count, tone = '') {
  const active = state.workbenchFilter === filter ? ' active' : '';
  const toneCls = tone ? ` work-summary-chip--${tone}` : '';
  return `<button type="button" class="work-summary-chip${active}${toneCls}" onclick="setWorkbenchFilter('${filter}')" title="筛选${label}">
    ${label} <strong>${count}</strong>
  </button>`;
}

function renderMyWork() {
  const myItems = (state.myWorkItems?.length ? state.myWorkItems : state.items.filter(i =>
    (i.assignee === state.user.name || (i.assistants || []).includes(state.user.name)) && (ACTIVE_STATUSES.includes(i.status) || i.status === 'blocked')
  ));
  const primaryAll = sortByPriority(myItems.filter(i => i.assignee === state.user.name));
  const assistAll = sortByPriority(myItems.filter(i => (i.assistants || []).includes(state.user.name) && i.assignee !== state.user.name));
  const done = state.items.filter(i => i.assignee === state.user.name && i.status === 'done');
  const today = new Date().toISOString().slice(0, 10);
  const noProgressItems = primaryAll.filter(i => !hasProgressToday(i, today));
  const blockedPrimary = primaryAll.filter(i => i.status === 'blocked');
  const blockedAssist = assistAll.filter(i => i.status === 'blocked');
  const blockedAll = sortByPriority([...blockedPrimary, ...blockedAssist]);

  const filter = state.workbenchFilter || 'all';
  let primary = primaryAll;
  let assist = assistAll;
  let showPrimary = true;
  let showAssist = true;

  if (filter === 'primary') {
    assist = [];
    showAssist = false;
  } else if (filter === 'assist') {
    primary = [];
    showPrimary = false;
  } else if (filter === 'no_progress') {
    primary = noProgressItems;
    assist = [];
    showAssist = false;
  } else if (filter === 'blocked') {
    primary = blockedPrimary;
    assist = blockedAssist;
    showPrimary = blockedPrimary.length > 0;
    showAssist = blockedAssist.length > 0;
  }

  const visibleCount = primary.length + assist.length;

  const renderWorkCard = (i, role) => {
    const latest = (i.progress_updates || [])[0];
    const roleLabel = role === 'primary' ? '主执行' : '协助';
    const roleCls = role === 'primary' ? 'type-story' : 'type-task';
    return `<div class="card progress-card work-card-compact">
      <div class="work-card-head">
        <div>
          ${i.req_no ? `<span class="req-no-tag">${esc(i.req_no)}</span>` : ''}
          <span class="type-badge ${roleCls}">${roleLabel}</span>
          ${priorityControlHtml(i, { editable: role === 'primary' && i.assignee === state.user?.name })}
          <strong>${esc(i.title)}</strong>
          <span class="project-status-pill ${projectStatusMeta(i).cls}" style="margin-left:0.35rem">${projectStatusMeta(i).label}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="showTaskDetailView('${i.id}')">查看进展</button>
      </div>
      ${latest ? `<p class="work-card-latest">最近 (${latest.date})：${esc(latest.description?.slice(0, 60) || '')}</p>` : '<p class="work-card-latest work-card-latest--empty">今日尚未提交进展</p>'}
      <div class="form-group work-card-form"><textarea id="prog-desc-${i.id}" rows="2" placeholder="填写今日进展..."></textarea></div>
      <div class="work-card-actions">
        <select id="prog-blocker-${i.id}" class="work-card-select">${Object.entries(BLOCKER_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <input id="prog-blocker-desc-${i.id}" placeholder="卡点说明（可选）" class="work-card-input">
        <button type="button" class="btn btn-primary btn-sm" onclick="submitProgress('${i.id}')">📤 提交</button>
        ${ACTIVE_STATUSES.includes(i.status) || i.status === 'blocked' ? `<button type="button" class="btn btn-success btn-sm" onclick="completeTask('${i.id}')">✅ 完成</button>` : ''}
      </div>
    </div>`;
  };

  return `
    <div class="work-summary-bar card">
      ${renderWorkbenchSummaryChip('primary', '待办', primaryAll.length)}
      ${renderWorkbenchSummaryChip('assist', '协助', assistAll.length)}
      ${renderWorkbenchSummaryChip('no_progress', '今日未报进展', noProgressItems.length, noProgressItems.length ? 'warn' : '')}
      ${renderWorkbenchSummaryChip('blocked', '阻塞', blockedAll.length, blockedAll.length ? 'danger' : '')}
      <button type="button" class="btn btn-ghost btn-sm work-summary-action" onclick="navigate('submit')">📤 提交需求</button>
    </div>
    ${filter !== 'all' ? `<div class="work-filter-hint">当前筛选：<strong>${workbenchFilterLabel(filter)}</strong>（${visibleCount} 项）· <button type="button" class="btn btn-ghost btn-sm" onclick="setWorkbenchFilter('all')">清除筛选</button></div>` : ''}
    ${showPrimary ? `<div class="section-title">${filter === 'blocked' ? '我负责的阻塞任务' : filter === 'no_progress' ? '今日未报进展的任务' : '我负责的任务'} (${primary.length})${filter === 'all' ? ' · 按 P1→P3 排序' : ''}</div>
    ${primary.length ? primary.map(i => renderWorkCard(i, 'primary')).join('') : `<div class="empty-state">${filter === 'no_progress' ? '今日进展已全部提交 🎉' : filter === 'blocked' ? '暂无阻塞的主执行任务' : '暂无主执行任务，可在「提交需求」创建'}</div>`}` : ''}
    ${showAssist && assist.length ? `<div class="section-title" style="margin-top:1.25rem">${filter === 'blocked' ? '我协助的阻塞任务' : '我协助的任务'} (${assist.length})</div>${assist.map(i => renderWorkCard(i, 'assist')).join('')}` : ''}
    ${filter !== 'all' && !visibleCount ? '<div class="empty-state">当前筛选下暂无任务</div>' : ''}
    <div class="work-done-hint">已完成 ${done.length} 项 · <button type="button" class="btn btn-ghost btn-sm" onclick="navigate('profile')">在我的记录中查看</button></div>`;
}

function renderSubmitFormFields() {
  const ai = state.aiStatus || {};
  const reviewers = state.users.filter(u => (u.capabilities || []).includes('reviewer'));
  const executors = state.users.filter(u => (u.capabilities || []).includes('executor') && !(u.capabilities || []).includes('reviewer'));
  return `
    <div class="submit-step card">
      <div class="form-group"><label>需求标题</label><input id="reqTitle" placeholder="简要描述你的需求"></div>
      <div class="form-group"><label>应用场景</label><textarea id="reqScene" rows="3" placeholder="描述应用场景和业务目标..."></textarea></div>
      <div class="form-group"><label>验收目标</label><textarea id="reqAccept" rows="3" placeholder="期望达成什么效果？"></textarea></div>
      <div class="form-group"><label>期望时间</label><input id="reqDeadline" type="date"></div>
      <div class="section-title" style="font-size:0.85rem;margin:0.75rem 0 0.5rem">人员分配</div>
      <div class="form-group"><label>审核人</label>
        <select id="reqReviewer" style="width:100%;padding:0.45rem 0.6rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)">
          <option value="">请选择审核人</option>
          ${reviewers.map(r => `<option value="${esc(r.name)}">${esc(r.name)} (${esc(userDeptLabel(r))})</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>工作需要人数</label>
        <select id="reqTeamSize" onchange="updateExecutorLimit()" style="width:120px;padding:0.45rem 0.6rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)">
          <option value="1">1 人</option><option value="2" selected>2 人</option><option value="3">3 人</option><option value="4">4 人</option><option value="5">5 人</option>
        </select>
      </div>
      <div class="form-group"><label>主执行人员（多选，第一位为主执行）</label>
        <select id="reqExecutors" multiple size="5" style="width:100%;padding:0.35rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)">
          ${executors.map(e => `<option value="${esc(e.name)}">${esc(e.name)} (${esc(userDeptLabel(e))})</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" onclick="submitRequirement()">📤 提交需求</button>
      <p style="font-size:0.72rem;color:var(--muted);margin-top:0.5rem">提交后自动进入执行 · ${ai.llm ? ai.llm.provider : '未配置 LLM'}</p>
    </div>`;
}

function renderSubmitMeetingPanel() {
  const records = state.meetingRecords || [];
  const current = records.find(r => r.id === state.currentMeetingId);
  return `
    <div class="submit-step card">
      <div class="form-group"><label>会议内容</label>
        <textarea id="meetingText" rows="5" placeholder="粘贴会议纪要或讨论要点...">${esc(current?.transcript || '')}</textarea>
      </div>
      <div class="meeting-toolbar">
        <button class="btn btn-primary btn-sm" onclick="saveMeetingText()">💾 保存</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('meetVoiceInput').click()">🎙️ 语音</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('meetDocInput').click()">📄 文档</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleMeetingRecord()">🔴 录音</button>
        <input type="file" id="meetVoiceInput" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" hidden>
        <input type="file" id="meetDocInput" accept=".txt,.md,.pdf,.docx,text/*,application/pdf" hidden>
      </div>
      <div class="meeting-records" id="meetingRecordsList">
        ${records.length ? records.map(r => `
          <div class="meeting-record-item ${r.id === state.currentMeetingId ? 'active' : ''}" onclick="selectMeetingRecord('${r.id}')">
            <div>${esc(r.title || r.summary?.slice(0, 40) || '会议记录')}</div>
            <div class="meta">${fmtTime(r.created_at)} · ${esc(r.source_type || 'text')}</div>
          </div>`).join('') : '<div class="empty-state" style="padding:0.5rem">暂无记录</div>'}
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:0.75rem" onclick="parseMeetingToForm();setSubmitTab('quick')" ${!state.currentMeetingId ? 'disabled' : ''}>🤖 AI 拆解并填入表单</button>
    </div>`;
}

function renderSubmitHistory() {
  return `<div class="item-list card">
    ${state.items.filter(i => i.created_by === state.user.name).map(i => `
      <div class="item-row" onclick="showTaskDetailView('${i.id}')">
        <span class="type-badge type-${i.type}">${TYPE_LABELS[i.type]}</span>
        <div class="info"><div class="title">${i.req_no ? `<span class="req-no-tag">${esc(i.req_no)}</span> ` : ''}${esc(i.title)}</div>
        <div class="desc">${STATUS_LABELS[i.status] || i.status} · ${fmtTime(i.created_at)}</div></div>
      </div>`).join('') || '<div class="empty-state">暂无提交记录</div>'}
  </div>`;
}

function renderSubmitBody() {
  return `${renderSubmitFormFields()}
    <div class="card submit-copilot" style="margin-top:1rem">
      <h3>💬 AI 助手</h3>
      <div class="chat-box">
        <div class="chat-messages" id="submitChatMessages"><div class="chat-msg assistant">可帮你完善需求描述与验收标准。</div></div>
        <div class="chat-input-row">
          <input id="submitChatInput" placeholder="询问 AI..." onkeydown="if(event.key==='Enter')sendSubmitChat()">
          <button class="btn btn-primary btn-sm" onclick="sendSubmitChat()">发送</button>
        </div>
      </div>
    </div>
    <div class="section-title" style="margin-top:1rem">最近提交</div>
    ${renderSubmitHistory()}`;
}

function renderSubmit() {
  const tab = state.submitTab || 'quick';
  return `
    <div class="page-tabs">
      <button type="button" class="page-tab ${tab === 'quick' ? 'active' : ''}" onclick="setSubmitTab('quick')">📝 快速提交</button>
      <button type="button" class="page-tab ${tab === 'meeting' ? 'active' : ''}" onclick="setSubmitTab('meeting')">🎙️ 会议/语音</button>
      <button type="button" class="page-tab ${tab === 'history' ? 'active' : ''}" onclick="setSubmitTab('history')">📋 提交记录</button>
    </div>
    <div class="page-tab-panel">
      ${tab === 'quick' ? renderSubmitFormFields() + `<div class="card submit-copilot" style="margin-top:1rem"><h3>💬 AI 助手</h3><div class="chat-box"><div class="chat-messages" id="submitChatMessages"><div class="chat-msg assistant">可帮你完善需求描述。</div></div><div class="chat-input-row"><input id="submitChatInput" onkeydown="if(event.key==='Enter')sendSubmitChat()"><button class="btn btn-primary btn-sm" onclick="sendSubmitChat()">发送</button></div></div></div>` : ''}
      ${tab === 'meeting' ? renderSubmitMeetingPanel() : ''}
      ${tab === 'history' ? renderSubmitHistory() : ''}
    </div>`;
}

function renderReview() {
  const myReview = isLeaderUser()
    ? state.items.filter(i => i.reviewer || i.req_no)
    : state.items.filter(i => i.reviewer === state.user?.name);
  const active = myReview.filter(i => flowCategory(i) === 'in_progress');
  const blocked = myReview.filter(i => i.status === 'blocked');
  const completed = myReview.filter(i => flowCategory(i) === 'done');
  const terminated = myReview.filter(i => flowCategory(i) === 'terminated');

  const renderReviewCard = (i, mode = 'view') => {
    const updates = (i.progress_updates || []).slice(0, 3);
    return `<div class="accept-card" id="review-${i.id}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="type-badge type-${i.type}">${TYPE_LABELS[i.type]}</span>
        ${i.req_no ? `<span class="req-no-tag">${esc(i.req_no)}</span>` : ''}
        <span class="project-status-pill ${projectStatusMeta(i).cls}">${projectStatusMeta(i).label}</span>
      </div>
      <h3>${esc(i.title)}</h3>
      <p style="color:var(--muted);font-size:0.85rem">${esc(i.description || '')}</p>
      <p style="font-size:0.82rem">提交人: <strong>${esc(i.created_by || '未知')}</strong> · ${taskPeopleHtml(i)}</p>
      ${i.blocked_reason ? `<p style="color:var(--danger);font-size:0.82rem">${BLOCKER_ICONS[i.blocker_type] || '🚧'} ${esc(i.blocked_reason)}</p>` : ''}
      ${updates.length ? `<div style="font-size:0.82rem;max-height:80px;overflow-y:auto;margin:0.5rem 0">
        ${updates.map(u => `<div style="padding:0.2rem 0;border-bottom:1px solid var(--border)"><strong>${u.date}</strong> ${esc(u.user)}: ${esc(u.description?.slice(0, 60) || '')}</div>`).join('')}
      </div>` : ''}
      <div class="accept-actions" style="flex-wrap:wrap;gap:0.5rem">
        ${mode === 'active' && isLeaderUser() ? `
          <button class="btn btn-ghost btn-sm" onclick="reviewerTerminate('${i.id}')" style="border-color:var(--danger);color:var(--danger)">⏹ 终止</button>
        ` : ''}
        ${mode === 'blocked' && isLeaderUser() ? `
          <button class="btn btn-primary btn-sm" onclick="showReassignModal('${i.id}')">🔄 二次分配</button>
        ` : ''}
        ${mode === 'completed' && isLeaderUser() ? `
          <button class="btn btn-ghost btn-sm" onclick="reviewerRevoke('${i.id}')" style="border-color:${STAR_GOLD};color:#6b5410">↩ 退回执行中</button>
        ` : ''}
        ${mode === 'terminated' && isLeaderUser() ? `
          <button class="btn btn-ghost btn-sm" onclick="reviewerRevoke('${i.id}')" style="border-color:${STAR_GOLD};color:#6b5410">↩ 退回执行中</button>
        ` : ''}
      </div>
    </div>`;
  };

  return `
    <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1rem">任务审核视图（已合并至任务中心）：对<strong>执行中</strong>终止、<strong>阻塞</strong>二次分配、<strong>已归档/已终止</strong>退回执行中。</p>
    <div class="section-title">执行中 (${active.length})</div>
    ${active.length ? active.map(i => renderReviewCard(i, 'active')).join('') : '<div class="empty-state">暂无执行中任务</div>'}
    <div class="section-title" style="margin-top:1.5rem">阻塞 (${blocked.length})</div>
    ${blocked.length ? blocked.map(i => renderReviewCard(i, 'blocked')).join('') : '<div class="empty-state">暂无阻塞任务</div>'}
    <div class="section-title" style="margin-top:1.5rem">已归档 (${completed.length})</div>
    ${completed.length ? completed.map(i => renderReviewCard(i, 'completed')).join('') : '<div class="empty-state">暂无已归档任务</div>'}
    <div class="section-title" style="margin-top:1.5rem">已终止 (${terminated.length})</div>
    ${terminated.length ? terminated.map(i => renderReviewCard(i, 'terminated')).join('') : '<div class="empty-state">暂无已终止任务</div>'}`;
}

function taskEndTime(row = {}) {
  if (row.completed_at) return row.completed_at;
  if (row.status === 'done' || row.status === 'terminated') return row.updated_at || '';
  return '';
}

function profileProjectStatusMeta(row = {}) {
  const item = { status: row.status, acceptance_status: row.acceptance_status };
  return projectStatusMeta(item);
}

function renderProfileProjectRow(pr) {
  const meta = profileProjectStatusMeta(pr);
  const assist = (pr.assistants || []).length ? pr.assistants.map(esc).join('、') : '-';
  const end = taskEndTime(pr);
  return `<tr class="profile-task-row" onclick="showTaskDetailView('${pr.item_id}')">
    <td>${pr.task_no !== '-' ? `<span class="req-no-tag">${esc(pr.task_no)}</span>` : '<span class="flow-list-empty">-</span>'}</td>
    <td class="flow-list-title"><strong>${esc(pr.task_name)}</strong></td>
    <td><span class="project-status-pill ${meta.cls}">${meta.label}</span></td>
    <td>${priorityBadgeHtml({ priority: pr.priority }, { compact: true })}</td>
    <td>${esc(pr.proposer)}</td>
    <td>${esc(pr.reviewer)}</td>
    <td>${esc(pr.assignee)}</td>
    <td>${assist}</td>
    <td class="flow-list-time">${fmtTime(pr.created_at) || '-'}</td>
    <td class="flow-list-time">${end ? fmtTime(end) : '-'}</td>
    <td class="profile-task-actions" onclick="event.stopPropagation()">
      <button type="button" class="btn btn-ghost btn-sm profile-task-btn" onclick="showTaskDetailView('${pr.item_id}')">查看</button>
      <button type="button" class="btn btn-ghost btn-sm profile-task-btn" onclick="downloadTaskDetail('${pr.item_id}')">下载</button>
    </td>
  </tr>`;
}

function renderProfileProjectTable(projects, { title, exportKind, emptyText, limit }) {
  const total = projects.length;
  const showAll = state.profileShowAll || !limit;
  const sorted = sortByPriority(projects);
  const rows = showAll ? sorted : sorted.slice(0, limit || total);
  const count = rows.length;
  return `<div class="card profile-task-card">
    <div class="profile-task-head">
      <div class="section-title">${title} (${total})</div>
      <div class="profile-task-head-actions">
        ${limit && total > limit ? `<button type="button" class="btn btn-ghost btn-sm" onclick="toggleProfileShowAll()">${showAll ? '收起' : '展开全部'}</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm kanban-export-btn" onclick="exportProfileTaskList('${exportKind}')" ${total ? '' : 'disabled'}>📥 下载清单</button>
      </div>
    </div>
    <div class="project-table-wrap">
      <table class="project-table profile-task-table">
        <thead><tr>
          <th>任务编号</th><th>任务名称</th><th>状态</th><th>优先级</th>
          <th>需求提出人</th><th>审核人</th><th>主执行人</th><th>其他执行人</th>
          <th>开始时间</th><th>结束时间</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${count ? rows.map(renderProfileProjectRow).join('') : `<tr><td colspan="11" class="profile-task-empty">${emptyText}</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

function profileTaskExportRow(pr) {
  const meta = profileProjectStatusMeta(pr);
  const end = taskEndTime(pr);
  return [
    pr.task_no === '-' ? '' : pr.task_no,
    pr.task_name || '',
    meta.label,
    priorityMeta(pr.priority).label,
    pr.proposer || '',
    pr.reviewer || '',
    pr.assignee || '',
    (pr.assistants || []).join('、'),
    fmtExportTime(pr.created_at),
    end ? fmtExportTime(end) : '',
  ];
}

function exportProfileTaskList(kind) {
  const rows = kind === 'review' ? (state.userReviewProjects || []) : (state.userProjects || []);
  if (!rows.length) {
    toast('暂无数据可导出', 'error');
    return;
  }
  const headers = ['任务编号', '任务名称', '状态', '优先级', '需求提出人', '审核人', '主执行人', '其他执行人', '开始时间', '结束时间'];
  const csv = '\uFEFF' + [headers, ...rows.map(profileTaskExportRow)]
    .map(row => row.map(csvCell).join(','))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const owner = state.profileUser?.name || state.user?.name;
  const category = kind === 'review' ? '参与审核任务' : '参与任务';
  downloadBlobFile(blob, buildExportFileName({
    category,
    tags: owner ? [owner] : [],
    exporter: state.user?.name,
    count: rows.length,
    ext: 'csv',
  }));
  toast(`已导出 ${rows.length} 条${category}`);
}

function buildTaskDetailText(item) {
  const meta = projectStatusMeta(item);
  const end = taskEndTime(item);
  const lines = [
    `任务编号: ${item.req_no || '-'}`,
    `任务名称: ${item.title || '-'}`,
    `状态: ${meta.label}`,
    `优先级: ${priorityMeta(item.priority).label}`,
    `开始时间: ${fmtExportTime(item.created_at) || '-'}`,
    `结束时间: ${end ? fmtExportTime(end) : '-'}`,
    `需求提出人: ${item.created_by || '-'}`,
    `审核人: ${item.reviewer || '-'}`,
    `主执行人: ${item.assignee || '-'}`,
    `其他执行人: ${(item.assistants || []).length ? item.assistants.join('、') : '-'}`,
    '',
    '任务描述:',
    item.description || '无',
    '',
    '验收标准:',
    item.acceptance_criteria || '无',
  ];
  if (item.blocked_reason) {
    lines.push('', '阻塞原因:', item.blocked_reason);
  }
  const updates = item.progress_updates || [];
  if (updates.length) {
    lines.push('', '进展记录:');
    updates.forEach(u => {
      lines.push(`- [${u.date || ''}] ${u.user || ''}: ${u.description || ''}${u.blocker_type && u.blocker_type !== 'none' ? ` (${BLOCKER_TYPES[u.blocker_type] || u.blocker_type})` : ''}`);
    });
  }
  return lines.join('\r\n');
}

function renderTaskProgressTimeline(updates = []) {
  if (!updates.length) {
    return `<div class="task-progress-section">
      <div class="section-title">📅 每日进展提交记录</div>
      <div class="task-progress-empty">暂无每日进展记录</div>
    </div>`;
  }
  return `<div class="task-progress-section">
    <div class="section-title">📅 每日进展提交记录 <span class="task-progress-count">${updates.length} 条</span></div>
    <div class="task-progress-timeline">
      ${updates.map(u => `<div class="task-progress-item">
        <div class="task-progress-meta">
          <strong>${esc(u.date || (u.created_at ? fmtTime(u.created_at).split(/\s/)[0] : ''))}</strong>
          <span>${esc(u.user || '未知')}</span>
          ${u.created_at ? `<span class="task-progress-time">${fmtTime(u.created_at)}</span>` : ''}
        </div>
        <div class="task-progress-desc">${esc(u.description || '（无文字说明）')}</div>
        ${u.blocker_type && u.blocker_type !== 'none' ? `<div class="task-progress-blocker">${BLOCKER_ICONS[u.blocker_type] || '🚧'} ${esc(BLOCKER_TYPES[u.blocker_type] || u.blocker_type)}${u.blocker_desc ? `：${esc(u.blocker_desc)}` : ''}</div>` : ''}
      </div>`).join('')}
    </div>
  </div>`;
}

function showTaskDetailView(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return toast('任务不存在', 'error');
  const meta = projectStatusMeta(item);
  const end = taskEndTime(item);
  showModal(`${item.req_no ? esc(item.req_no) + ' · ' : ''}${esc(item.title)}`, `
    <div class="task-detail-view">
      <div class="task-detail-meta">
        ${item.req_no ? `<span class="req-no-tag">${esc(item.req_no)}</span>` : ''}
        ${priorityBadgeHtml(item)}
        <span class="project-status-pill ${meta.cls}">${meta.label}</span>
        <span class="type-badge type-${item.type}">${TYPE_LABELS[item.type]}</span>
      </div>
      <div class="task-detail-people">${taskPeopleHtml(item)}</div>
      ${canEditTaskPriority(item) ? `<div class="task-detail-priority-edit"><label>优先级</label>${priorityControlHtml(item, { editable: true })}</div>` : ''}
      <div class="task-detail-dates">
        <span>开始：${fmtTime(item.created_at) || '-'}</span>
        <span>结束：${end ? fmtTime(end) : '-'}</span>
      </div>
      <div class="task-detail-block"><strong>任务描述</strong><p>${esc(item.description || '无描述')}</p></div>
      ${item.acceptance_criteria ? `<div class="task-detail-block"><strong>验收标准</strong><pre class="task-detail-pre">${esc(item.acceptance_criteria)}</pre></div>` : ''}
      ${item.blocked_reason ? `<div class="task-detail-block task-detail-block--danger"><strong>阻塞原因</strong><p>${BLOCKER_ICONS[item.blocker_type] || '🚧'} ${esc(item.blocked_reason)}</p></div>` : ''}
      ${renderTaskProgressTimeline(item.progress_updates || [])}
      <div class="task-detail-actions">
        <button type="button" class="btn btn-ghost" onclick="downloadTaskDetail('${id}')">📥 下载详情</button>
        ${isReviewerUser() ? `<button type="button" class="btn btn-primary" onclick="closeModal();showItemDetail('${id}')">✏️ 编辑任务</button>` : ''}
      </div>
    </div>
  `);
}

function downloadTaskDetail(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return toast('任务不存在', 'error');
  const text = buildTaskDetailText(item);
  const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8;' });
  downloadBlobFile(blob, buildTaskDetailFileName(item));
  toast('任务详情已下载');
}

function renderProfile() {
  const uid = state.profileUserId || state.user?.id;
  const isSelf = uid === state.user?.id;
  const u = state.profileUser || state.user;
  const p = u?.profile || {};
  const projects = state.userProjects || [];
  const reviewProjects = state.userReviewProjects || [];
  const activeParticipating = projects.filter(p => !['done', 'terminated'].includes(p.status));
  const assigneeTasks = state.items.filter(i => i.assignee === u?.name && !['done', 'terminated'].includes(i.status));
  const assistTasks = state.items.filter(i => (i.assistants || []).includes(u?.name) && !['done', 'terminated'].includes(i.status));

  const blockedItems = projects.filter(p => p.status === 'blocked');

  return `
    <div class="profile-header card">
      <div class="profile-avatar-lg">${(u?.name || '?').slice(0,1)}</div>
      <div>
        <h2>${esc(u?.name)} ${isSelf ? '' : `<button class="btn btn-ghost btn-sm" onclick="state.profileUserId=null;navigate('profile')">← 返回</button>`}</h2>
        <p style="color:var(--muted)">工号 ${u?.emp_id} · ${userDeptLabel(u)}</p>
        <div style="margin-top:0.35rem">${(u?.capabilityLabels || []).map(c => `<span class="cap-tag">${esc(c)}</span>`).join('')}</div>
      </div>
    </div>

    <div class="profile-summary-bar card">
      <span>状态 <strong>${{available:'🟢 空闲',limited:'🟡 有限',busy:'🔴 繁忙'}[p.availability] || '未知'}</strong></span>
      <span>进行中 <strong>${activeParticipating.length}</strong></span>
      <span>主执行 <strong>${assigneeTasks.length}</strong></span>
      <span>协助 <strong>${assistTasks.length}</strong></span>
      ${isReviewerUser() ? `<span>审核 <strong>${reviewProjects.length}</strong></span>` : ''}
      ${blockedItems.length ? `<span class="profile-summary-danger">阻塞 <strong>${blockedItems.length}</strong></span>` : ''}
      <button type="button" class="btn btn-ghost btn-sm" onclick="goTaskCenter('all')">任务中心 →</button>
      ${!isReviewerUser() ? `<button type="button" class="btn btn-ghost btn-sm" onclick="navigate('mywork')">工作台 →</button>` : ''}
    </div>

    ${renderProfileProjectTable(projects, {
      title: '📂 参与任务',
      exportKind: 'projects',
      emptyText: '暂无参与任务',
      limit: 5,
    })}

    ${isReviewerUser() ? renderProfileProjectTable(reviewProjects, {
      title: '🔍 参与审核的任务',
      exportKind: 'review',
      emptyText: '暂无参与审核的任务',
      limit: 5,
    }) : ''}`;
}

function renderTeam() {
  return `
    <div class="section-title">团队成员 (${state.users.length})</div>
    <div class="team-grid">
      ${state.users.map(u => {
        const workload = state.items.filter(i => i.assignee === u.name && i.status !== 'done').length;
        return `<div class="team-card" onclick="viewProfile('${u.id}')" style="cursor:pointer">
          <div class="team-avatar">${u.name.slice(0,1)}</div>
          <div class="team-info">
            <div class="team-name">${esc(u.name)}</div>
            <div class="team-meta">${(u.capabilityLabels || []).join(' · ')} · 进行中 ${workload} 项</div>
            <div class="team-meta">工号 ${u.emp_id} · ${userDeptLabel(u)}</div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function renderVoice() {
  const ai = state.aiStatus || {};
  const llmInfo = ai.llm ? `${ai.llm.provider} · ${ai.llm.model}` : '未配置';
  const asrInfo = ai.asr ? `${ai.asr.provider} · ${ai.asr.model}` : '未配置 DASHSCOPE_API_KEY';
  const ready = ai.ready;
  return `
    <div class="voice-hero card">
      <h2>🎙️ 语音需求智能处理</h2>
      <p style="color:var(--muted);margin:0.5rem 0 1rem">上传会议录音或现场录音 → 国产大模型转写 → 梳理文档 → 自动拆解任务</p>
      <div class="engine-status">
        <span class="engine-chip ${ai.llm ? 'on' : 'off'}">🧠 ${llmInfo}</span>
        <span class="engine-chip ${ai.asr ? 'on' : 'off'}">🎙️ ${asrInfo}</span>
      </div>
      ${!ready ? '<p class="voice-warn">⚠️ 请在 .env 配置 DEEPSEEK_API_KEY + DASHSCOPE_API_KEY 启用完整能力</p>' : ''}
    </div>
    <div class="voice-panel">
      <div class="voice-upload-zone" id="voiceDropZone">
        <input type="file" id="voiceFileInput" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" hidden>
        <div class="upload-icon">📁</div>
        <p><strong>拖拽语音文件到此处</strong> 或 <button class="btn btn-ghost btn-sm" onclick="document.getElementById('voiceFileInput').click()">选择文件</button></p>
        <p style="font-size:0.78rem;color:var(--muted)">支持 MP3 / WAV / M4A / WebM，最大 50MB</p>
        <div style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="btnRecord" onclick="toggleRecording()">🔴 开始录音</button>
          <label style="font-size:0.82rem;display:flex;align-items:center;gap:0.35rem;color:var(--muted)">
            <input type="checkbox" id="autoCreateTasks" checked> 自动创建任务到任务中心
          </label>
        </div>
        <div id="recordStatus" style="margin-top:0.5rem;font-size:0.82rem;color:var(--danger);display:none"></div>
      </div>
      <div id="voiceProgress" style="display:none" class="card">
        <div class="voice-progress-steps">
          <div class="vstep" id="vstep1">① 语音转文字...</div>
          <div class="vstep" id="vstep2">② 大模型分析梳理...</div>
          <div class="vstep" id="vstep3">③ 拆解任务入库...</div>
        </div>
      </div>
      <div id="voiceResult" style="display:none"></div>
    </div>
    <div class="section-title">历史语音文档</div>
    <div class="voice-history" id="voiceHistory">
      ${(state.voiceDocs || []).map(d => `
        <div class="voice-doc-card" onclick="showVoiceDoc('${d.id}')">
          <div class="voice-doc-title">${esc(d.summary?.slice(0, 60) || d.filename)}</div>
          <div class="voice-doc-meta">${fmtTime(d.created_at)} · ${esc(d.user_name)} · ${esc(d.llm_provider || '')}</div>
        </div>`).join('') || '<div class="empty-state">暂无语音处理记录</div>'}
    </div>`;
}

let audioChunks = [];
async function loadVoiceDocs() {
  try { state.voiceDocs = await api('/ai/voice/docs'); } catch { state.voiceDocs = []; }
}

async function processVoiceFile(file) {
  if (!file) return;
  const progress = document.getElementById('voiceProgress');
  const resultEl = document.getElementById('voiceResult');
  progress.style.display = 'block';
  resultEl.style.display = 'none';
  ['vstep1','vstep2','vstep3'].forEach(id => { const el = document.getElementById(id); if (el) el.className = 'vstep'; });
  const setStep = (id, cls) => { const el = document.getElementById(id); if (el) el.classList.add(cls); };
  setStep('vstep1', 'active');
  toast('正在处理语音...');
  const form = new FormData();
  form.append('audio', file);
  form.append('autoCreate', document.getElementById('autoCreateTasks')?.checked !== false ? 'true' : 'false');
  try {
    const res = await fetch(API + '/ai/voice/process', {
      method: 'POST',
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '处理失败');
    setStep('vstep1', 'done'); setStep('vstep2', 'active');
    await new Promise(r => setTimeout(r, 200));
    setStep('vstep2', 'done'); setStep('vstep3', 'active');
    await new Promise(r => setTimeout(r, 200));
    setStep('vstep3', 'done');
    progress.style.display = 'none';
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div class="card" style="margin-bottom:1rem"><h3>✅ 处理完成 (${(data.duration_ms/1000).toFixed(1)}s)</h3>
        <p style="font-size:0.85rem;color:var(--muted)">ASR: ${esc(data.engines?.asr)} · LLM: ${esc(data.engines?.llm)}</p></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div class="card"><div class="section-title">📝 转写原文</div><div class="ai-result" style="display:block;max-height:300px">${esc(data.transcript)}</div></div>
        <div class="card"><div class="section-title">📄 需求文档</div><div class="ai-result" style="display:block;max-height:300px">${esc(data.document)}</div></div>
      </div>
      <div class="card" style="margin-top:1rem">
        <div class="section-title">📋 拆解结果</div><p>${esc(data.summary)}</p>
        <div class="item-list" style="margin-top:0.75rem">
          ${(data.createdItems?.stories || []).map(s => `<div class="item-row"><span class="type-badge type-story">Story</span><div class="info"><div class="title">${esc(s.title)}</div><div class="desc">${s.story_points||0} SP</div></div></div>`).join('')}
        </div>
      </div>`;
    toast('语音处理完成');
    await loadVoiceDocs();
  } catch (e) {
    setStep('vstep1', 'error');
    toast(e.message, 'error');
    progress.style.display = 'none';
  }
}

async function toggleRecording() {
  const btn = document.getElementById('btnRecord') || document.querySelector('[onclick="toggleRecording()"]');
  const status = document.getElementById('recordStatus') || document.getElementById('aiRecordStatus');
  if (!state.recording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      state.mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      state.mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
        if (state.currentView === 'ai') processAiVoice(file);
        else processVoiceFile(file);
        stream.getTracks().forEach(t => t.stop());
      };
      state.mediaRecorder.start();
      state.recording = true;
      btn.textContent = '⏹ 停止录音';
      btn.classList.add('btn-danger');
      status.style.display = 'block';
      status.textContent = '● 录音中...';
    } catch { toast('无法访问麦克风', 'error'); }
  } else {
    state.mediaRecorder?.stop();
    state.recording = false;
    btn.textContent = '🔴 开始录音';
    btn.classList.remove('btn-danger');
    status.style.display = 'none';
  }
}

function showVoiceDoc(id) {
  const doc = state.voiceDocs.find(d => d.id === id);
  if (!doc) return;
  showModal('语音需求文档', `<div class="ai-result" style="display:block;max-height:60vh">${esc(doc.document)}</div>`);
}

function initVoiceUpload() {
  const zone = document.getElementById('voiceDropZone');
  const input = document.getElementById('voiceFileInput');
  if (!zone || !input) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) processVoiceFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) processVoiceFile(input.files[0]); });
}

function initAiUpload() {
  const voiceZone = document.getElementById('aiVoiceZone');
  const voiceInput = document.getElementById('aiVoiceInput');
  const docZone = document.getElementById('aiDocZone');
  const docInput = document.getElementById('aiDocInput');

  if (voiceZone && voiceInput) {
    voiceZone.addEventListener('dragover', e => { e.preventDefault(); voiceZone.classList.add('drag-over'); });
    voiceZone.addEventListener('dragleave', () => voiceZone.classList.remove('drag-over'));
    voiceZone.addEventListener('drop', e => { e.preventDefault(); voiceZone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) processAiVoice(e.dataTransfer.files[0]); });
    voiceInput.addEventListener('change', () => { if (voiceInput.files[0]) processAiVoice(voiceInput.files[0]); });
  }
  if (docZone && docInput) {
    docZone.addEventListener('dragover', e => { e.preventDefault(); docZone.classList.add('drag-over'); });
    docZone.addEventListener('dragleave', () => docZone.classList.remove('drag-over'));
    docZone.addEventListener('drop', e => { e.preventDefault(); docZone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) processAiDocument(e.dataTransfer.files[0]); });
    docInput.addEventListener('change', () => { if (docInput.files[0]) processAiDocument(docInput.files[0]); });
  }
}

function showAiUploadResult(data, type) {
  const el = document.getElementById('aiUploadResult');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="card">
      <h3>✅ ${type === 'voice' ? '语音' : '文档'}处理完成</h3>
      <p style="font-size:0.85rem;color:var(--muted)">${esc(data.summary)}</p>
      ${data.meta ? `<p style="font-size:0.78rem;color:var(--muted)">📊 ${data.meta.wordCount || 0} 字 · ${data.meta.sectionCount || 0} 章节 · ${data.analysis_mode || ''} ${data.confidence ? `· 置信度 ${Math.round(data.confidence * 100)}%` : ''}</p>` : ''}
      ${(data.keywords || []).length ? `<p style="font-size:0.78rem">🏷️ ${data.keywords.map(k => esc(k)).join(' · ')}</p>` : ''}
      ${(data.risks || []).length ? `<p style="font-size:0.78rem;color:var(--warning)">⚠️ ${data.risks.map(r => esc(r)).join(' · ')}</p>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:0.75rem">
        <div><div class="section-title">📝 ${type === 'voice' ? '转写原文' : '文档内容'}</div>
          <div class="ai-result" style="display:block;max-height:200px">${esc(data.transcript || data.text)}</div></div>
        <div><div class="section-title">📄 需求文档</div>
          <div class="ai-result" style="display:block;max-height:200px">${esc(data.document)}</div></div>
      </div>
      ${(data.createdItems?.stories || []).length ? `<p style="margin-top:0.75rem;font-size:0.85rem">已创建 <strong>${data.createdItems.stories.length}</strong> 个 Story</p>` : ''}
      <button class="btn btn-ghost btn-sm" style="margin-top:0.5rem" onclick="goTaskCenter('all')">查看任务中心 →</button>
    </div>`;
  const req = document.getElementById('aiRequirement');
  if (req) req.value = data.transcript || data.text || '';
}

async function processAiVoice(file) {
  const prog = document.getElementById('aiUploadProgress');
  prog.style.display = 'block';
  document.getElementById('aiUploadResult').style.display = 'none';
  toast('正在处理语音...');
  const form = new FormData();
  form.append('audio', file);
  form.append('autoCreate', 'true');
  try {
    const res = await fetch(API + '/ai/voice/process', { method: 'POST', headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    prog.style.display = 'none';
    showAiUploadResult(data, 'voice');
    toast('语音处理完成');
  } catch (e) { prog.style.display = 'none'; toast(e.message, 'error'); }
}

async function processAiDocument(file) {
  const prog = document.getElementById('aiUploadProgress');
  prog.style.display = 'block';
  document.getElementById('aiUploadResult').style.display = 'none';
  toast('正在解析文档...');
  const form = new FormData();
  form.append('document', file);
  form.append('autoCreate', 'true');
  try {
    const res = await fetch(API + '/ai/document/process', { method: 'POST', headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    prog.style.display = 'none';
    showAiUploadResult(data, 'doc');
    toast('文档处理完成');
  } catch (e) { prog.style.display = 'none'; toast(e.message, 'error'); }
}

// ── Actions ──
async function navigate(view) {
  if (view === 'voice') view = 'submit';
  if (view === 'kanban' || view === 'review' || view === 'acceptance') {
    if (view === 'review') state.kanbanFilter = { flow: 'in_progress', reviewer: '', executor: '' };
    else if (view === 'acceptance') state.kanbanFilter = { flow: 'done', reviewer: '', executor: '' };
    view = 'taskcenter';
  } else if (view === 'ai') {
    state.demandAiTab = 'ai';
    view = 'demandai';
  }

  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  const titles = {
    taskcenter: '任务中心', dashboard: isReviewerUser() ? '全局看板' : '仪表盘',
    demandai: '需求与 AI', mywork: '今日工作台', submit: '提交需求',
    profile: isReviewerUser() ? '我的' : '我的记录', team: '团队',
    kanban: '任务中心', review: '任务中心', acceptance: '任务中心', ai: '需求与 AI',
  };
  document.getElementById('pageTitle').textContent = titles[view] || view;
  await loadData();
  if (view === 'submit' || view === 'demandai') await loadMeetingRecords();
  if (view === 'mywork' || view === 'taskcenter') {
    const isExecutor = (state.user?.capabilities || []).includes('executor');
    if (isExecutor) {
      try { state.myWorkItems = await api('/items/my-work'); } catch { state.myWorkItems = []; }
    }
  }
  if (view === 'profile') {
    const uid = state.profileUserId || state.user?.id;
    const profile = await api(`/users/${uid}`);
    state.profileUser = { ...profile, dept: userDeptLabel(profile) };
    state.userProjects = await api(`/users/${uid}/projects`);
    state.userReviewProjects = await api(`/users/${uid}/review-projects`);
  }
  const renderers = {
    taskcenter: renderTaskCenter, dashboard: renderDashboard, demandai: renderDemandAI,
    mywork: renderMyWork, submit: renderSubmit, profile: renderProfile, team: renderTeam,
    kanban: renderTaskCenter, review: renderTaskCenter, acceptance: renderTaskCenter, ai: renderDemandAI,
  };
  document.getElementById('content').innerHTML = renderers[view] ? renderers[view]() : '<div class="empty-state">页面不存在</div>';
  if (view === 'dashboard' && isReviewerUser()) startGlobalKanbanPolling();
  else stopGlobalKanbanPolling();
  if (view === 'taskcenter' && state.kanbanViewMode === 'board') initDragDrop();
  if (view === 'submit' || (view === 'demandai' && state.demandAiTab === 'submit')) initSubmitPage();
}

function flowStatusBody(category, extra = {}) {
  const statusMap = { in_progress: 'in_progress', blocked: 'blocked', done: 'done', terminated: 'terminated' };
  const status = statusMap[category] || category;
  const body = { status, ...extra };
  if (category === 'terminated') body.acceptance_status = 'terminated';
  else if (category === 'done') body.acceptance_status = 'accepted';
  else if (category === 'in_progress') {
    body.acceptance_status = 'pending';
    body.clear_completed = true;
  }
  return body;
}

async function leaderAction(actionFn, successMsg) {
  try {
    await actionFn();
    toast(successMsg);
    await reloadViewAfterMutation();
  } catch (e) {
    toast(e.message || '操作失败', 'error');
  }
}

async function moveItem(id, newCategory) {
  if (!isReviewerUser()) {
    toast('执行人员无权改动任务中心状态，请提交进展后等待领导处理', 'error');
    return;
  }
  const col = FLOW_COLS.find(c => c.id === newCategory);
  const count = kanbanBaseItems().filter(i => flowCategory(i) === newCategory && i.id !== id).length;
  if (count >= WIP_LIMITS[newCategory]) {
    toast(`${col.label} 列已达 WIP 上限 (${WIP_LIMITS[newCategory]})`, 'error');
    return;
  }
  try {
    await api(`/items/${id}`, { method: 'PATCH', body: flowStatusBody(newCategory) });
    toast(`已移至「${col.label}」`);
    await reloadViewAfterMutation();
  } catch (e) {
    toast(e.message || '移动失败', 'error');
  }
}

function initDragDrop() {
  let draggedId = null;
  let touchDragging = false;
  let touchCard = null;
  let touchClone = null;
  const canDrag = isReviewerUser();

  document.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', e => { if (!touchDragging) showItemDetail(card.dataset.id); });
    if (!canDrag) return;
    card.addEventListener('dragstart', e => { draggedId = card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); draggedId = null; });

    card.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      touchDragging = false;
      touchCard = card;
      draggedId = card.dataset.id;
      card.classList.add('dragging');
    }, { passive: true });

    card.addEventListener('touchmove', e => {
      if (!touchCard || e.touches.length !== 1) return;
      touchDragging = true;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touchClone) {
        touchClone = card.cloneNode(true);
        touchClone.style.cssText = 'position:fixed;z-index:9999;opacity:0.85;pointer-events:none;width:' + card.offsetWidth + 'px';
        document.body.appendChild(touchClone);
      }
      touchClone.style.left = (touch.clientX - card.offsetWidth / 2) + 'px';
      touchClone.style.top = (touch.clientY - 20) + 'px';
      document.querySelectorAll('.kanban-col').forEach(col => {
        const rect = col.getBoundingClientRect();
        col.classList.toggle('drag-over', touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom);
      });
    }, { passive: false });

    card.addEventListener('touchend', async e => {
      if (!touchCard) return;
      const touch = e.changedTouches[0];
      let targetStatus = null;
      document.querySelectorAll('.kanban-col').forEach(col => {
        const rect = col.getBoundingClientRect();
        if (touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
          targetStatus = col.querySelector('.kanban-cards')?.dataset.status;
        }
        col.classList.remove('drag-over');
      });
      touchCard.classList.remove('dragging');
      if (touchClone) { touchClone.remove(); touchClone = null; }
      const id = draggedId;
      touchCard = null;
      draggedId = null;
      if (touchDragging && targetStatus && id) await moveItem(id, targetStatus);
      setTimeout(() => { touchDragging = false; }, 100);
    });
  });

  document.querySelectorAll('.kanban-cards').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.parentElement.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.parentElement.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.parentElement.classList.remove('drag-over');
      if (draggedId) await moveItem(draggedId, zone.dataset.status);
    });
  });
}

function showReassignModal(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  const executors = state.users.filter(u => (u.capabilities || []).includes('executor') && !(u.capabilities || []).includes('reviewer'));
  showModal('二次分配 · ' + item.title, `
    <p style="color:var(--muted);font-size:0.85rem;margin-bottom:0.75rem">当前主执行: <strong>${esc(item.assignee || '未分配')}</strong>${item.blocked_reason ? `<br>阻塞原因: ${esc(item.blocked_reason)}` : ''}</p>
    <div class="form-group"><label>新主执行人</label>
      <select id="reassignPrimary" style="width:100%;padding:0.45rem 0.6rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)">
        <option value="">请选择</option>
        ${executors.map(e => `<option value="${esc(e.name)}" ${e.name === item.assignee ? 'selected' : ''}>${esc(e.name)} (${esc(userDeptLabel(e))})</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>协助人员（可多选）</label>
      <select id="reassignAssist" multiple size="4" style="width:100%;padding:0.35rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)">
        ${executors.map(e => `<option value="${esc(e.name)}" ${(item.assistants || []).includes(e.name) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>备注（可选）</label><input id="reassignComment" placeholder="分配说明..."></div>
    <button class="btn btn-primary" style="width:100%" onclick="reviewerReassign('${id}')">确认二次分配并退回执行中</button>
  `);
}

async function reviewerReassign(id) {
  const assignee = document.getElementById('reassignPrimary')?.value;
  const assistEl = document.getElementById('reassignAssist');
  const assistants = assistEl ? Array.from(assistEl.selectedOptions).map(o => o.value).filter(v => v !== assignee) : [];
  const comment = document.getElementById('reassignComment')?.value || '';
  if (!assignee) return toast('请选择主执行人', 'error');
  await leaderAction(async () => {
    await api(`/items/${id}/reviewer-reassign`, { method: 'POST', body: { assignee, assistants, comment } });
    closeModal();
  }, '已二次分配，任务退回执行中');
}

function showNewItemModal() {
  showModal('新建工作项', `
    <div class="form-group"><label>类型</label><select id="fType"><option value="story">Story</option><option value="epic">Epic</option><option value="task">Task</option><option value="bug">Bug</option></select></div>
    <div class="form-group"><label>标题</label><input id="fTitle" placeholder="用户故事标题"></div>
    <div class="form-group"><label>描述</label><textarea id="fDesc" placeholder="详细描述"></textarea></div>
    <div class="form-group"><label>Story Points</label><input id="fPts" type="number" value="3" min="0" max="21"></div>
    <div class="form-group"><label>优先级</label><select id="fPriority"><option value="1">P1 紧急</option><option value="2" selected>P2 高</option><option value="3">P3 普通</option></select></div>
    <button class="btn btn-primary" style="width:100%" onclick="createItem()">创建</button>
  `);
}

async function createItem() {
  const data = {
    type: document.getElementById('fType').value,
    title: document.getElementById('fTitle').value,
    description: document.getElementById('fDesc').value,
    story_points: Number(document.getElementById('fPts').value),
    priority: Number(document.getElementById('fPriority').value),
    status: 'in_progress',
  };
  if (!data.title.trim()) return toast('请输入标题', 'error');
  await api('/items', { method: 'POST', body: data });
  closeModal();
  toast('创建成功');
  await reloadViewAfterMutation();
}

function showItemDetail(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  const updates = (item.progress_updates || []);
  const isAdmin = state.user?.role === 'admin';
  const canEdit = isReviewerUser();
  const canProgress = item.assignee === state.user?.name || (item.assistants || []).includes(state.user?.name);
  showModal(item.title, `
    <div style="margin-bottom:0.75rem">
      ${item.req_no ? `<span class="req-no-tag">${esc(item.req_no)}</span> ` : ''}
      ${priorityBadgeHtml(item, { compact: true })}
      <span class="type-badge type-${item.type}">${TYPE_LABELS[item.type]}</span>
      <span style="color:var(--muted)">${STATUS_LABELS[item.status]}</span>
      ${myWorkRole(item) === 'primary' ? '<span class="type-badge type-story" style="margin-left:0.35rem">我的主执行</span>' : ''}
      ${myWorkRole(item) === 'assist' ? '<span class="type-badge type-task" style="margin-left:0.35rem">我的协助</span>' : ''}
    </div>
    <div style="font-size:0.85rem;margin-bottom:0.75rem;padding:0.5rem;background:var(--bg);border-radius:6px">${taskPeopleHtml(item)}</div>
    <p style="color:var(--muted);margin-bottom:0.75rem">${esc(item.description || '无描述')}</p>
    ${item.blocked_reason ? `<p style="color:var(--danger);font-size:0.85rem;margin-bottom:0.5rem">${BLOCKER_ICONS[item.blocker_type] || '🚧'} ${esc(item.blocked_reason)}</p>` : ''}
    ${renderTaskProgressTimeline(updates)}
    <div class="section-title" style="font-size:0.85rem;margin-top:0.5rem">任务编辑</div>
    ${canEditTaskPriority(item) ? `<div class="form-group"><label>优先级</label>${priorityControlHtml(item, { editable: true })}</div>` : ''}
    <div class="form-group"><label>状态</label><select id="eStatus">${FLOW_COLS.map(c => `<option value="${c.id}" ${flowCategory(item) === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div>
    <div class="form-group"><label>负责人</label><input id="eAssignee" value="${esc(item.assignee || '')}"></div>
    <div class="form-group"><label>Story Points</label><input id="ePts" type="number" value="${item.story_points || 0}"></div>
    ${item.status === 'blocked' ? `<div class="form-group"><label>阻塞原因</label><input id="eBlocked" value="${esc(item.blocked_reason || '')}"></div>` : ''}
    <div class="form-group"><label>验收标准</label><textarea id="eCriteria">${esc(item.acceptance_criteria || '')}</textarea></div>
    ${canProgress ? `<div class="section-title" style="font-size:0.85rem">提交进展</div>
      <div class="form-group"><textarea id="modalProgDesc" rows="2" placeholder="今日进展..."></textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
        <select id="modalBlockerType">${Object.entries(BLOCKER_TYPES).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <input id="modalBlockerDesc" placeholder="卡点说明">
      </div>
      <button class="btn btn-ghost btn-sm" style="margin:0.5rem 0" onclick="submitProgress('${id}', true)">📤 提交进展</button>
      ${ACTIVE_STATUSES.includes(item.status) || item.status === 'blocked' ? `<button class="btn btn-success btn-sm" style="margin:0.5rem 0.5rem" onclick="completeTask('${id}')">✅ 任务完成</button>` : ''}` : ''}
    ${canEdit ? `<button class="btn btn-primary" style="width:100%;margin-bottom:0.5rem" onclick="updateItem('${id}')">保存</button>` : ''}
    ${isLeaderUser() && flowCategory(item) === 'in_progress' ? `
      <button class="btn btn-ghost" style="width:100%;margin-bottom:0.5rem;border-color:var(--danger);color:var(--danger)" onclick="reviewerTerminate('${id}')">⏹ 终止执行</button>
    ` : ''}
    ${isLeaderUser() && item.status === 'blocked' ? `
      <button class="btn btn-primary" style="width:100%;margin-bottom:0.5rem" onclick="showReassignModal('${id}')">🔄 二次分配</button>
    ` : ''}
    ${isLeaderUser() && (item.status === 'done' || item.status === 'terminated') ? `
      <button class="btn btn-ghost" style="width:100%;margin-bottom:0.5rem;border-color:${STAR_GOLD};color:#6b5410" onclick="reviewerRevoke('${id}')">↩ 退回执行中</button>
    ` : ''}
    ${isAdmin ? `<button class="btn btn-danger" style="width:100%" onclick="deleteItem('${id}')">🗑️ 删除任务（超级管理员）</button>` : ''}
  `);
  if (!canEdit) {
    const body = document.getElementById('modalBody');
    const note = document.createElement('div');
    note.className = 'readonly-note';
    note.textContent = '执行人员请在「今日工作台」提交进展并标记完成。无权直接改动任务状态，由审核人员统一管理。';
    body.prepend(note);
    ['eStatus', 'eAssignee', 'ePts', 'eBlocked', 'eCriteria'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = true;
      el.readOnly = true;
    });
    body.querySelectorAll('button').forEach(btn => {
      if ((btn.getAttribute('onclick') || '').includes('updateItem(')) btn.style.display = 'none';
    });
  }
}

async function updateItem(id) {
  if (!isReviewerUser()) {
    toast('执行人员无权改动任务中心，请提交进展后等待领导处理', 'error');
    return;
  }
  const category = document.getElementById('eStatus').value;
  const priorityEl = document.querySelector('#modalOverlay .priority-select');
  const body = flowStatusBody(category, {
    assignee: document.getElementById('eAssignee').value,
    story_points: Number(document.getElementById('ePts').value),
    acceptance_criteria: document.getElementById('eCriteria').value,
    ...(priorityEl ? { priority: normalizePriority(priorityEl.value) } : {}),
  });
  const blocked = document.getElementById('eBlocked');
  if (blocked) body.blocked_reason = blocked.value;
  try {
    await api(`/items/${id}`, { method: 'PATCH', body });
    closeModal();
    toast('已更新');
    await reloadViewAfterMutation();
  } catch (e) {
    toast(e.message || '更新失败', 'error');
  }
}

async function acceptItem(id, status) {
  await api(`/items/${id}/accept`, { method: 'POST', body: { status, feedback: '' } });
  toast('验收通过 ✅');
  await navigate('acceptance');
}

async function rejectItem(id) {
  showModal('打回修改', `
    <div class="form-group"><label>反馈意见</label><textarea id="rejectFeedback" placeholder="请描述需要修改的内容..."></textarea></div>
    <button class="btn btn-danger" style="width:100%" onclick="submitReject('${id}')">提交反馈并打回</button>
  `);
}

async function submitReject(id) {
  const feedback = document.getElementById('rejectFeedback').value;
  if (!feedback.trim()) return toast('请填写反馈', 'error');
  await api(`/items/${id}/accept`, { method: 'POST', body: { status: 'rejected', feedback } });
  closeModal();
  toast('已打回，反馈已自动创建新 Story');
  await navigate('acceptance');
}

async function runSplit() {
  const text = document.getElementById('aiRequirement')?.value;
  if (!text?.trim()) return toast('请输入需求描述', 'error');
  toast('AI 正在拆分需求...');
  const result = await api('/ai/split-requirement', { method: 'POST', body: { text } });
  const el = document.getElementById('aiSplitResult');
  if (el) { el.style.display = 'block'; el.textContent = result.summary + '\n\n已创建:\n• Epic: ' + result.epic.title + '\n• Stories: ' + result.stories.map(s => s.title).join('\n• '); }
  toast('AI 拆分完成');
  await loadData();
  document.getElementById('insightList').innerHTML = state.insights.map(i => `
    <div class="insight-item ${i.severity}"><div class="insight-title">${esc(i.title)}</div><div class="insight-time">${fmtTime(i.created_at)}</div><div class="insight-content">${esc(i.content)}</div></div>
  `).join('');
}

async function runStandup() {
  toast('AI 生成站会摘要...');
  const result = await api('/ai/standup', { method: 'POST' });
  showModal('AI 站会摘要', `<div class="ai-result" style="display:block;max-height:60vh">${esc(result.content)}</div>`);
  await loadData();
  if (state.currentView === 'dashboard') await refreshGlobalKanban(true);
}

async function runRisks() {
  toast('AI 扫描风险...');
  const result = await api('/ai/risks', { method: 'POST' });
  showModal(`风险扫描 (${result.count} 项)`, `<div class="ai-result" style="display:block;max-height:60vh">${esc(result.content)}</div>`);
  toast(result.count ? `发现 ${result.count} 个风险` : '无显著风险', result.count ? 'error' : 'success');
  await loadData();
  if (state.currentView === 'dashboard') await refreshGlobalKanban(true);
}

async function runReviewReport() {
  toast('AI 生成回顾报告...');
  const result = await api('/ai/review-report', { method: 'POST' });
  showModal(`项目回顾 (${result.engine === 'llm' ? 'LLM' : '本地'})`, `<div class="ai-result" style="display:block;max-height:60vh">${esc(result.content)}</div>`);
  await loadData();
}

async function sendChat(deep = false) {
  const input = document.getElementById('chatInput');
  const q = input?.value?.trim();
  if (!q) return;
  appendChat('user', q);
  input.value = '';
  try {
    const result = await api('/ai/copilot', { method: 'POST', body: { question: q, deep } });
    appendChat('assistant', result.answer, result.engine + (result.intent ? ` · ${result.intent}` : ''));
  } catch (e) { appendChat('assistant', '抱歉，处理失败：' + e.message); }
}

async function sendDeepChat() {
  const input = document.getElementById('chatInput');
  if (!input?.value?.trim()) { toast('请先输入问题', 'error'); return; }
  toast('深度推理中，请稍候...');
  await sendChat(true);
}

function quickChat(q) {
  const hasProposer = (state.user?.capabilities || []).includes('proposer');
  navigate(hasProposer ? 'submit' : 'ai').then(() => {
    setTimeout(() => {
      const el = hasProposer ? document.getElementById('submitChatInput') : document.getElementById('chatInput');
      if (el) { el.value = q; hasProposer ? sendSubmitChat() : sendChat(); }
    }, 300);
  });
}
function appendChat(role, text, engine) {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `${esc(text)}${engine ? `<span class="engine-tag">${engine}</span>` : ''}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function loadMeetingRecords() {
  try { state.meetingRecords = await api('/ai/meeting/records'); } catch { state.meetingRecords = []; }
}

async function saveMeetingText() {
  const text = document.getElementById('meetingText')?.value?.trim();
  if (!text) return toast('请输入会议记录内容', 'error');
  setMeetingStatus('保存中...');
  try {
    const res = await api('/ai/meeting/save-text', { method: 'POST', body: { text } });
    state.currentMeetingId = res.doc.id;
    await loadMeetingRecords();
    toast('会议记录已保存');
    await navigate('submit');
  } catch (e) { toast(e.message, 'error'); setMeetingStatus(''); }
}

function setMeetingStatus(msg) {
  const el = document.getElementById('meetingRecordStatus');
  if (el) el.textContent = msg;
}

async function selectMeetingRecord(id) {
  state.currentMeetingId = id;
  const rec = state.meetingRecords.find(r => r.id === id);
  await navigate('submit');
  if (rec) {
    const ta = document.getElementById('meetingText');
    if (ta) ta.value = rec.transcript || rec.document || '';
  }
}

async function parseMeetingToForm() {
  if (!state.currentMeetingId) return toast('请先选择或保存会议记录', 'error');
  toast('AI 正在拆解会议记录...');
  setMeetingStatus('AI 拆解中，请稍候...');
  try {
    const res = await api(`/ai/meeting/${state.currentMeetingId}/parse`, { method: 'POST' });
    const r = res.requirement;
    const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    set('reqTitle', r.title);
    set('reqScene', r.scene);
    set('reqAccept', r.acceptance);
    set('reqDeadline', r.deadline);
    setMeetingStatus(`✅ 已拆解 (${r.engine || 'llm'})：${r.summary || ''}`);
    toast('AI 已自动填写需求表单，请核对后提交');
    await loadMeetingRecords();
  } catch (e) { toast(e.message, 'error'); setMeetingStatus('拆解失败'); }
}

async function uploadMeetingAudio(file) {
  setMeetingStatus('语音转写中，请稍候...');
  const form = new FormData();
  form.append('audio', file);
  try {
    const res = await fetch(API + '/ai/meeting/upload-audio', { method: 'POST', headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.currentMeetingId = data.doc.id;
    await loadMeetingRecords();
    toast('语音已转写并保存为会议记录');
    await navigate('submit');
  } catch (e) { toast(e.message, 'error'); setMeetingStatus(''); }
}

async function uploadMeetingDoc(file) {
  setMeetingStatus('文档解析中...');
  const form = new FormData();
  form.append('document', file);
  try {
    const res = await fetch(API + '/ai/meeting/upload-doc', { method: 'POST', headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.currentMeetingId = data.doc.id;
    await loadMeetingRecords();
    toast('文档已保存为会议记录');
    await navigate('submit');
  } catch (e) { toast(e.message, 'error'); setMeetingStatus(''); }
}

function toggleMeetingRecord() {
  if (state.recording) {
    state.mediaRecorder?.stop();
    state.recording = false;
    setMeetingStatus('');
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    state.mediaRecorder = new MediaRecorder(stream);
    const chunks = [];
    state.mediaRecorder.ondataavailable = e => chunks.push(e.data);
    state.mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      uploadMeetingAudio(new File(chunks, 'recording.webm', { type: 'audio/webm' }));
    };
    state.mediaRecorder.start();
    state.recording = true;
    setMeetingStatus('🔴 录音中，再次点击结束...');
  }).catch(() => toast('无法访问麦克风', 'error'));
}

function initSubmitPage() {
  document.getElementById('meetVoiceInput')?.addEventListener('change', e => { if (e.target.files[0]) uploadMeetingAudio(e.target.files[0]); });
  document.getElementById('meetDocInput')?.addEventListener('change', e => { if (e.target.files[0]) uploadMeetingDoc(e.target.files[0]); });
}

async function sendSubmitChat() {
  const input = document.getElementById('submitChatInput');
  const q = input?.value?.trim();
  if (!q) return;
  const box = document.getElementById('submitChatMessages');
  const userDiv = document.createElement('div');
  userDiv.className = 'chat-msg user';
  userDiv.textContent = q;
  box?.appendChild(userDiv);
  input.value = '';
  try {
    const result = await api('/ai/copilot', { method: 'POST', body: { question: q } });
    const div = document.createElement('div');
    div.className = 'chat-msg assistant';
    div.innerHTML = `${esc(result.answer)}<span class="engine-tag">${result.engine || ''}</span>`;
    box?.appendChild(div);
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    const div = document.createElement('div');
    div.className = 'chat-msg assistant';
    div.textContent = '处理失败：' + e.message;
    box?.appendChild(div);
  }
}

async function submitRequirement() {
  const title = document.getElementById('reqTitle').value;
  const scene = document.getElementById('reqScene').value;
  const accept = document.getElementById('reqAccept').value;
  const deadline = document.getElementById('reqDeadline').value;
  const reviewer = document.getElementById('reqReviewer')?.value;
  const teamSize = Number(document.getElementById('reqTeamSize')?.value) || 1;
  const execEl = document.getElementById('reqExecutors');
  const selected = execEl ? Array.from(execEl.selectedOptions).map(o => o.value) : [];
  if (!title.trim()) return toast('请填写需求标题', 'error');
  if (!reviewer) return toast('请选择审核人', 'error');
  if (!selected.length) return toast('请选择至少一名执行人员', 'error');
  if (selected.length > teamSize) return toast(`执行人员不能超过 ${teamSize} 人`, 'error');
  const assignee = selected[0];
  const assistants = selected.slice(1);
  const meetingNote = state.currentMeetingId ? `\n\n会议记录ID: ${state.currentMeetingId}` : '';
  const item = await api('/items', { method: 'POST', body: {
    type: 'story',
    title, description: `场景: ${scene}\n验收: ${accept}\n期望: ${deadline}${meetingNote}`,
    acceptance_criteria: accept, story_points: 3, priority: 2,
    reviewer, team_size: teamSize, assignee, assistants,
  }});
  if (item.status === 'in_progress') {
    toast(`✅ 需求 ${item.req_no || ''} 已派发，${assignee} 可在工作台查看`);
  } else {
    toast(`需求 ${item.req_no || ''} 提交异常（状态: ${item.status}），请重启服务后重试`, 'error');
  }
  state.currentMeetingId = null;
  await navigate('submit');
}

function updateExecutorLimit() {
  const teamSize = Number(document.getElementById('reqTeamSize')?.value) || 1;
  const execEl = document.getElementById('reqExecutors');
  if (!execEl) return;
  const selected = Array.from(execEl.selectedOptions);
  if (selected.length > teamSize) {
    selected.slice(teamSize).forEach(o => { o.selected = false; });
    toast(`已限制为 ${teamSize} 人`, 'error');
  }
}

async function completeTask(id) {
  if (!confirm('确认标记任务完成？完成后将自动归档并通知审核人。')) return;
  await api(`/items/${id}/complete`, { method: 'POST' });
  toast('任务已完成，已自动归档 ✅');
  await reloadViewAfterMutation();
}

async function reviewerReject(id) {
  const comment = prompt('驳回原因（可选）：');
  if (comment === null) return;
  await api(`/items/${id}/reviewer-reject`, { method: 'POST', body: { comment: comment || '审核人驳回' } });
  toast('已驳回任务');
  await navigate('review');
}

async function reviewerTerminate(id) {
  const comment = prompt('终止原因（可选）：');
  if (comment === null) return;
  if (!confirm('确认终止该任务的执行？任务将归入已终止。')) return;
  await leaderAction(
    () => api(`/items/${id}/reviewer-terminate`, { method: 'POST', body: { comment: comment || '领导终止执行' } }),
    '已终止，任务已归入已终止',
  );
}

async function reviewerRevoke(id) {
  const comment = prompt('退回原因（可选）：');
  if (comment === null) return;
  if (!confirm('确认将任务退回执行中？')) return;
  await leaderAction(
    () => api(`/items/${id}/reviewer-revoke`, { method: 'POST', body: { comment: comment || '领导退回执行中' } }),
    '已退回执行中',
  );
}

async function confirmComplete(id) {
  if (!confirm('确认该任务已完成？')) return;
  await api(`/items/${id}/confirm-complete`, { method: 'POST' });
  toast('已确认完成 ✅');
  await reloadViewAfterMutation();
}

async function reviewItem(id, action) {
  const assignee = document.getElementById(`assign-${id}`)?.value;
  const assistEl = document.getElementById(`assist-${id}`);
  const assistants = assistEl ? Array.from(assistEl.selectedOptions).map(o => o.value) : [];
  if (action === 'approve' && !assignee) return toast('请选择主执行人', 'error');
  if (action === 'reject') {
    const comment = prompt('驳回原因：');
    if (!comment) return;
    await api(`/items/${id}/review`, { method: 'POST', body: { action, comment } });
  } else {
    await api(`/items/${id}/review`, { method: 'POST', body: { action, assignee, assistants } });
  }
  toast(action === 'approve' ? '已通过并分配' : '已驳回');
  await navigate('review');
}

async function smartAssign(id) {
  const teamSize = Number(document.getElementById(`team-size-${id}`)?.value) || 2;
  toast(`AI 分析最佳 ${teamSize} 人团队...`);
  const result = await api(`/items/${id}/smart-assign`, { method: 'POST', body: { team_size: teamSize } });
  const el = document.getElementById(`smart-result-${id}`);
  if (el) {
    el.style.display = 'block';
    const scoreLines = (result.scores || []).slice(0, 5).map(s =>
      `${esc(s.name)}: ${s.score}分 (${esc(s.reason)})`
    ).join('<br>');
    el.innerHTML = `<strong>🤖 推荐 ${teamSize} 人团队 (${result.engine})</strong><br>
      主执行: <strong>${esc(result.primary)}</strong><br>
      协助: ${(result.assistants || []).map(esc).join('、') || '无'}<br>
      <span style="color:var(--muted)">${esc(result.reason)}</span>
      <details style="margin-top:0.5rem;font-size:0.78rem"><summary>评分明细</summary>${scoreLines}</details>`;
  }
  const sel = document.getElementById(`assign-${id}`);
  if (sel && result.primary) sel.value = result.primary;
  const assist = document.getElementById(`assist-${id}`);
  if (assist && result.assistants) {
    Array.from(assist.options).forEach(o => { o.selected = result.assistants.includes(o.value); });
  }
  toast(`推荐: ${result.primary} + ${(result.assistants||[]).length} 协助`);
}

async function updateTaskPriority(id, priority) {
  const p = normalizePriority(priority);
  try {
    const updated = await api(`/items/${id}/priority`, { method: 'PATCH', body: { priority: p } });
    syncItemInState(updated);
    toast(`优先级已设为 ${priorityMeta(p).label}`);
    const modalOpen = document.getElementById('modalOverlay')?.classList.contains('show');
    if (modalOpen) {
      if (isReviewerUser()) showItemDetail(id);
      else showTaskDetailView(id);
      return;
    }
    await reloadViewAfterMutation();
  } catch (e) {
    toast(e.message || '优先级更新失败', 'error');
    await reloadViewAfterMutation();
  }
}

async function submitProgress(id, fromModal = false) {
  const description = fromModal
    ? document.getElementById('modalProgDesc')?.value
    : document.getElementById(`prog-desc-${id}`)?.value;
  const blocker_type = fromModal
    ? document.getElementById('modalBlockerType')?.value
    : document.getElementById(`prog-blocker-${id}`)?.value;
  const blocker_desc = fromModal
    ? document.getElementById('modalBlockerDesc')?.value
    : document.getElementById(`prog-blocker-desc-${id}`)?.value;
  if (!description?.trim() && (!blocker_type || blocker_type === 'none')) {
    return toast('请填写进展描述或选择卡点类型', 'error');
  }
  const result = await api(`/items/${id}/progress`, { method: 'POST', body: { description, blocker_type, blocker_desc } });
  if (result?.item) syncItemInState(result.item);
  if (result?.activity) prependActivityInState(result.activity);
  toast(blocker_type && blocker_type !== 'none' ? '进展已提交，任务已标记为阻塞' : '今日进展已提交');
  if (fromModal) closeModal();
  if (state.currentView === 'dashboard' && isReviewerUser()) {
    refreshActivityFeedDom();
    updateDashboardLivePanels();
    return;
  }
  await reloadViewAfterMutation();
}

async function deleteItem(id) {
  if (!confirm('确定删除此任务？此操作不可恢复。')) return;
  await api(`/items/${id}`, { method: 'DELETE' });
  closeModal();
  toast('任务已删除');
  await reloadViewAfterMutation();
}

async function viewProfile(userId) {
  state.profileUserId = userId;
  await navigate('profile');
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  localStorage.clear();
  location.href = '/login.html';
}

async function initApp() {
  if (!getToken()) { location.href = '/login.html'; return; }
  try {
    const me = await api('/auth/me');
    const leader = leaderNavConfig(me.user);
    state.user = {
      ...me.user,
      dept: userDeptLabel(me.user),
      ...(leader ? { nav: leader.nav, defaultView: leader.defaultView } : {}),
    };
    state.roleConfig = leader
      ? { ...me.roleConfig, nav: leader.nav, defaultView: leader.defaultView }
      : me.roleConfig;
    state.llmEnabled = me.llmEnabled;
    state.aiStatus = me.ai;
    setupUserCard();
    buildNav();
    buildTopbar();
    const defaultView = state.user?.defaultView || state.roleConfig?.defaultView || state.roleConfig?.nav?.[0]?.id || 'mywork';
    await navigate(defaultView);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.currentView === 'dashboard' && isReviewerUser()) {
        refreshGlobalKanban(true);
      }
    });
  } catch { localStorage.clear(); location.href = '/login.html'; }
}

// ── Utils ──
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function fmtTime(t) { if (!t) return ''; const d = new Date(t.includes('T') ? t : t + 'Z'); return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function fmtExportTime(t) {
  if (!t) return '';
  const d = new Date(t.includes('T') ? t : t + 'Z');
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sanitizeFileNamePart(value, maxLen = 24) {
  const s = String(value ?? '').trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function exportTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function kanbanFilterTags() {
  const f = state.kanbanFilter || { flow: 'all', reviewer: '', executor: '' };
  const flowLabels = { all: '全部', in_progress: '执行中', blocked: '阻塞', done: '已归档', terminated: '已终止' };
  const tags = [flowLabels[f.flow] || '全部'];
  if (f.reviewer) tags.push(`审核${f.reviewer}`);
  if (f.executor) tags.push(`执行${f.executor}`);
  return tags;
}

function buildExportFileName({ category, tags = [], exporter, count, ext = 'csv' }) {
  const parts = ['FDE', sanitizeFileNamePart(category, 32)];
  tags.forEach(tag => {
    const part = sanitizeFileNamePart(tag, 20);
    if (part) parts.push(part);
  });
  if (exporter) {
    const exp = sanitizeFileNamePart(exporter, 12);
    if (exp) parts.push(`导出人${exp}`);
  }
  parts.push(exportTimestamp());
  if (count != null) parts.push(`${count}条`);
  return `${parts.join('_')}.${ext}`;
}

function buildTaskDetailFileName(item) {
  const tags = [
    item.req_no || '无编号',
    item.title || '任务详情',
  ];
  return buildExportFileName({
    category: '任务详情',
    tags,
    exporter: state.user?.name,
    ext: 'txt',
  });
}

function downloadBlobFile(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Init ──
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('btnLogout').addEventListener('click', logout);

initApp();
