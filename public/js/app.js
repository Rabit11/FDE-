const API = '/api';
const WIP_LIMITS = { backlog: 99, todo: 5, in_progress: 4, blocked: 3, review: 3, done: 99 };
const KANBAN_COLS = [
  { id: 'backlog', label: 'Backlog', color: '#8899b4' },
  { id: 'todo', label: '待办', color: '#3b82f6' },
  { id: 'in_progress', label: '进行中', color: '#f59e0b' },
  { id: 'blocked', label: '阻塞', color: '#ef4444' },
  { id: 'review', label: '待验收', color: '#a855f7' },
  { id: 'done', label: '完成', color: '#22c55e' },
];

const STATUS_LABELS = Object.fromEntries(KANBAN_COLS.map(c => [c.id, c.label]));
const TYPE_LABELS = { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Bug' };

let state = { items: [], sprints: [], metrics: {}, activity: [], insights: [], currentView: 'dashboard', activeSprint: null };

// ── API helpers ──
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function loadData() {
  const [items, sprints, metrics, activity, insights] = await Promise.all([
    api('/items'), api('/sprints'), api('/metrics'), api('/activity?limit=30'), api('/ai/insights'),
  ]);
  state = { ...state, items, sprints, metrics, activity, insights, activeSprint: sprints.find(s => s.status === 'active') };
  updateSprintBadge();
}

function updateSprintBadge() {
  const el = document.getElementById('activeSprintBadge');
  if (state.activeSprint) {
    el.innerHTML = `🏃 <strong>${state.activeSprint.name}</strong><br><span style="font-size:0.7rem">${state.activeSprint.start_date} ~ ${state.activeSprint.end_date}</span>`;
  } else {
    el.textContent = '无活跃 Sprint';
  }
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
function renderTaskCard(item) {
  return `<div class="task-card ${item.status === 'blocked' ? 'blocked' : ''}" draggable="true" data-id="${item.id}">
    <span class="type-badge type-${item.type}">${TYPE_LABELS[item.type] || item.type}</span>
    <div class="title">${esc(item.title)}</div>
    <div class="meta">
      ${item.story_points ? `<span class="pts">${item.story_points} SP</span>` : ''}
      ${item.assignee ? `<span>👤 ${esc(item.assignee)}</span>` : ''}
      ${item.ai_generated ? '<span class="ai-tag">🤖 AI</span>' : ''}
      ${item.blocked_reason ? `<span style="color:var(--danger)">🚧 ${esc(item.blocked_reason)}</span>` : ''}
    </div>
  </div>`;
}

function renderDashboard() {
  const m = state.metrics;
  const pct = m.totalPoints ? Math.round((m.donePoints / m.totalPoints) * 100) : 0;
  const statusMap = Object.fromEntries((m.byStatus || []).map(s => [s.status, s.count]));

  return `
    <div class="card-grid">
      <div class="card stat-card blue"><div class="label">Sprint 进度</div><div class="value">${pct}%</div><div class="label">${m.donePoints}/${m.totalPoints} SP</div></div>
      <div class="card stat-card green"><div class="label">近14天吞吐量</div><div class="value">${m.throughput}</div><div class="label">已完成项</div></div>
      <div class="card stat-card yellow"><div class="label">平均 Lead Time</div><div class="value">${m.avgLeadTime}</div><div class="label">天</div></div>
      <div class="card stat-card red"><div class="label">阻塞项</div><div class="value">${m.blocked}</div><div class="label">需立即处理</div></div>
      <div class="card stat-card purple"><div class="label">进行中</div><div class="value">${statusMap.in_progress || 0}</div><div class="label">WIP 上限 ${WIP_LIMITS.in_progress}</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div class="card">
        <div class="section-title">状态分布</div>
        <div class="burndown">
          ${KANBAN_COLS.map(c => {
            const count = statusMap[c.id] || 0;
            const max = Math.max(...KANBAN_COLS.map(x => statusMap[x.id] || 0), 1);
            return `<div class="burndown-bar ${c.id === 'done' ? 'done' : ''}" style="height:${Math.max(8, (count / max) * 100)}px" title="${c.label}: ${count}">
              <span class="bar-label">${c.label}(${count})</span>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="card">
        <div class="section-title">最近活动</div>
        <div class="activity-list">
          ${state.activity.slice(0, 8).map(a => `
            <div class="activity-item">
              <span class="time">${fmtTime(a.created_at)}</span>
              <span><strong>${esc(a.item_title || '')}</strong> ${esc(a.detail)}</span>
            </div>
          `).join('') || '<div class="empty-state">暂无活动</div>'}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <div class="section-title">最新 AI 洞察</div>
      <div class="insight-list">
        ${state.insights.slice(0, 3).map(i => `
          <div class="insight-item ${i.severity}">
            <div class="insight-title">${esc(i.title)}</div>
            <div class="insight-time">${fmtTime(i.created_at)}</div>
            <div class="insight-content">${esc(i.content.slice(0, 200))}</div>
          </div>
        `).join('') || '<div class="empty-state">点击顶部「站会摘要」或「风险扫描」生成 AI 洞察</div>'}
      </div>
    </div>`;
}

function renderKanban() {
  const items = state.items.filter(i => i.type !== 'task' || i.status !== 'backlog');
  return `<div class="kanban" id="kanban">
    ${KANBAN_COLS.map(col => {
      const cards = items.filter(i => i.status === col.id);
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
          ${cards.map(renderTaskCard).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderBacklog() {
  const items = state.items.filter(i => ['epic', 'story', 'bug'].includes(i.type)).sort((a, b) => a.priority - b.priority);
  return `
    <div style="margin-bottom:1rem;display:flex;gap:0.5rem">
      <button class="btn btn-primary" onclick="showNewItemModal()">+ 新建 Story</button>
      <button class="btn btn-ghost" onclick="navigate('ai')">🤖 AI 拆分需求</button>
    </div>
    <div class="backlog-list">
      ${items.map(i => `
        <div class="backlog-item" onclick="showItemDetail('${i.id}')">
          <div class="priority-dot priority-${i.priority}"></div>
          <span class="type-badge type-${i.type}">${TYPE_LABELS[i.type]}</span>
          <div class="info">
            <div class="title">${esc(i.title)} ${i.ai_generated ? '🤖' : ''}</div>
            <div class="desc">${esc(i.description || '')} · ${STATUS_LABELS[i.status] || i.status} · ${i.story_points || 0} SP</div>
          </div>
        </div>
      `).join('') || '<div class="empty-state">Backlog 为空，使用 AI 助手拆分需求开始</div>'}
    </div>`;
}

function renderSprint() {
  const sprint = state.activeSprint;
  if (!sprint) {
    return `<div class="empty-state">
      <p>无活跃 Sprint</p>
      <button class="btn btn-primary" style="margin-top:1rem" onclick="showNewSprintModal()">+ 创建 Sprint</button>
    </div>`;
  }
  const items = state.items.filter(i => i.sprint_id === sprint.id);
  const totalPts = items.reduce((s, i) => s + (i.story_points || 0), 0);
  const donePts = items.filter(i => i.status === 'done').reduce((s, i) => s + (i.story_points || 0), 0);
  const daysLeft = Math.max(0, Math.ceil((new Date(sprint.end_date) - new Date()) / 86400000));

  return `
    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.75rem">
        <div>
          <h2 style="margin-bottom:0.5rem">${esc(sprint.name)}</h2>
          <p style="color:var(--muted);margin-bottom:0.75rem">🎯 ${esc(sprint.goal || '无目标')}</p>
        </div>
        <div style="display:flex;gap:0.5rem">
          <button class="btn btn-ghost btn-sm" onclick="showNewSprintModal()">+ 新 Sprint</button>
          <button class="btn btn-ghost btn-sm" onclick="closeSprint('${sprint.id}')">结束 Sprint</button>
        </div>
      </div>
      <div style="display:flex;gap:2rem;font-size:0.88rem;flex-wrap:wrap">
        <span>📅 ${sprint.start_date} ~ ${sprint.end_date}</span>
        <span>⏳ 剩余 ${daysLeft} 天</span>
        <span>📊 ${donePts}/${totalPts} SP (${totalPts ? Math.round(donePts/totalPts*100) : 0}%)</span>
      </div>
      <div style="margin-top:0.75rem;height:8px;background:var(--bg);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${totalPts ? donePts/totalPts*100 : 0}%;background:linear-gradient(90deg,var(--accent),var(--success));border-radius:4px;transition:width 0.5s"></div>
      </div>
    </div>
    <div class="section-title">Sprint Backlog (${items.length} 项)</div>
    <div class="backlog-list">
      ${items.map(i => `
        <div class="backlog-item" onclick="showItemDetail('${i.id}')">
          <div class="priority-dot priority-${i.priority}"></div>
          <span class="type-badge type-${i.type}">${TYPE_LABELS[i.type]}</span>
          <div class="info">
            <div class="title">${esc(i.title)}</div>
            <div class="desc">${STATUS_LABELS[i.status]} · ${i.story_points || 0} SP</div>
          </div>
        </div>
      `).join('') || '<div class="empty-state">Sprint Backlog 为空</div>'}
    </div>
    <div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="runRetro()">📊 生成 Sprint Retro 报告</button>
    </div>`;
}

function renderAcceptance() {
  const items = state.items.filter(i => i.status === 'review');
  if (!items.length) return '<div class="empty-state">✅ 当前无待验收项<br><span style="font-size:0.85rem">将看板中的任务拖入「待验收」列即可</span></div>';
  return items.map(i => `
    <div class="accept-card">
      <span class="type-badge type-${i.type}">${TYPE_LABELS[i.type]}</span>
      <h3>${esc(i.title)}</h3>
      <p style="color:var(--muted);font-size:0.85rem">${esc(i.description || '')}</p>
      ${i.demo_url ? `<p>🔗 Demo: <a href="${esc(i.demo_url)}" target="_blank" style="color:var(--accent)">${esc(i.demo_url)}</a></p>` : ''}
      <div class="criteria"><strong>验收标准:</strong>\n${esc(i.acceptance_criteria || '无')}</div>
      <div class="accept-actions">
        <button class="btn btn-success btn-sm" onclick="acceptItem('${i.id}', 'accepted')">✅ 通过验收</button>
        <button class="btn btn-danger btn-sm" onclick="rejectItem('${i.id}')">❌ 打回修改</button>
      </div>
    </div>
  `).join('');
}

function renderAI() {
  return `
    <div class="ai-panel">
      <div class="ai-card">
        <h3>🧠 AI 需求拆分</h3>
        <p style="color:var(--muted);font-size:0.85rem;margin-bottom:0.75rem">输入自然语言需求，AI 自动拆分为 Epic + Story + Task</p>
        <div class="form-group">
          <textarea id="aiRequirement" placeholder="例：我们需要一个 AI 赋能的敏捷看板，支持拖拽、WIP 限制、Sprint 管理和在线验收..."></textarea>
        </div>
        <button class="btn btn-primary" onclick="runSplit()">🚀 AI 拆分并创建</button>
        <div class="ai-result" id="aiSplitResult" style="display:none"></div>
      </div>
      <div class="ai-card">
        <h3>📡 AI 洞察中心</h3>
        <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="runStandup()">站会摘要</button>
          <button class="btn btn-ghost btn-sm" onclick="runRisks()">风险扫描</button>
          <button class="btn btn-ghost btn-sm" onclick="runRetro()">Retro 报告</button>
        </div>
        <div class="insight-list" id="insightList">
          ${state.insights.map(i => `
            <div class="insight-item ${i.severity}">
              <div class="insight-title">${esc(i.title)}</div>
              <div class="insight-time">${fmtTime(i.created_at)} · ${i.type}</div>
              <div class="insight-content">${esc(i.content)}</div>
            </div>
          `).join('') || '<div class="empty-state">暂无 AI 洞察</div>'}
        </div>
      </div>
    </div>`;
}

// ── Actions ──
async function navigate(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  const titles = { dashboard: '仪表盘', kanban: '流动看板', backlog: 'Backlog', sprint: 'Sprint', acceptance: '验收中心', ai: 'AI 助手' };
  document.getElementById('pageTitle').textContent = titles[view];
  await loadData();
  const content = document.getElementById('content');
  const renderers = { dashboard: renderDashboard, kanban: renderKanban, backlog: renderBacklog, sprint: renderSprint, acceptance: renderAcceptance, ai: renderAI };
  content.innerHTML = renderers[view]();
  if (view === 'kanban') initDragDrop();
}

async function moveItem(id, newStatus) {
  const col = KANBAN_COLS.find(c => c.id === newStatus);
  const count = state.items.filter(i => i.status === newStatus && i.id !== id).length;
  if (count >= WIP_LIMITS[newStatus]) {
    toast(`${col.label} 列已达 WIP 上限 (${WIP_LIMITS[newStatus]})`, 'error');
    return;
  }
  await api(`/items/${id}`, { method: 'PATCH', body: { status: newStatus } });
  toast(`已移至「${col.label}」`);
  await navigate('kanban');
}

function initDragDrop() {
  let draggedId = null;
  let touchDragging = false;
  let touchCard = null;
  let touchClone = null;

  document.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('dragstart', e => { draggedId = card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); draggedId = null; });
    card.addEventListener('click', e => { if (!touchDragging) showItemDetail(card.dataset.id); });

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

function showNewSprintModal() {
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const num = state.sprints.length + 1;
  showModal('创建 Sprint', `
    <div class="form-group"><label>Sprint 名称</label><input id="sName" value="Sprint ${num}"></div>
    <div class="form-group"><label>Sprint 目标</label><textarea id="sGoal" placeholder="本迭代要达成的目标..."></textarea></div>
    <div class="form-group"><label>开始日期</label><input id="sStart" type="date" value="${start}"></div>
    <div class="form-group"><label>结束日期</label><input id="sEnd" type="date" value="${end}"></div>
    <button class="btn btn-primary" style="width:100%" onclick="createSprint()">创建并激活</button>
  `);
}

async function createSprint() {
  const data = {
    name: document.getElementById('sName').value,
    goal: document.getElementById('sGoal').value,
    start_date: document.getElementById('sStart').value,
    end_date: document.getElementById('sEnd').value,
    status: 'active',
  };
  if (!data.name.trim() || !data.start_date || !data.end_date) return toast('请填写完整信息', 'error');
  await api('/sprints', { method: 'POST', body: data });
  closeModal();
  toast('Sprint 已创建');
  await navigate('sprint');
}

async function closeSprint(id) {
  await api(`/sprints/${id}`, { method: 'PATCH', body: { status: 'completed' } });
  toast('Sprint 已结束');
  await navigate('sprint');
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
    sprint_id: state.activeSprint?.id,
    status: 'backlog',
  };
  if (!data.title.trim()) return toast('请输入标题', 'error');
  await api('/items', { method: 'POST', body: data });
  closeModal();
  toast('创建成功');
  await navigate(state.currentView);
}

function showItemDetail(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  showModal(item.title, `
    <div style="margin-bottom:0.75rem"><span class="type-badge type-${item.type}">${TYPE_LABELS[item.type]}</span> <span style="color:var(--muted)">${STATUS_LABELS[item.status]}</span></div>
    <p style="color:var(--muted);margin-bottom:0.75rem">${esc(item.description || '无描述')}</p>
    <div class="form-group"><label>状态</label><select id="eStatus">${KANBAN_COLS.map(c => `<option value="${c.id}" ${c.id === item.status ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div>
    <div class="form-group"><label>负责人</label><input id="eAssignee" value="${esc(item.assignee || '')}"></div>
    <div class="form-group"><label>Story Points</label><input id="ePts" type="number" value="${item.story_points || 0}"></div>
    ${item.status === 'blocked' ? `<div class="form-group"><label>阻塞原因</label><input id="eBlocked" value="${esc(item.blocked_reason || '')}"></div>` : ''}
    <div class="form-group"><label>验收标准</label><textarea id="eCriteria">${esc(item.acceptance_criteria || '')}</textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="updateItem('${id}')">保存</button>
  `);
}

async function updateItem(id) {
  const body = {
    status: document.getElementById('eStatus').value,
    assignee: document.getElementById('eAssignee').value,
    story_points: Number(document.getElementById('ePts').value),
    acceptance_criteria: document.getElementById('eCriteria').value,
  };
  const blocked = document.getElementById('eBlocked');
  if (blocked) body.blocked_reason = blocked.value;
  await api(`/items/${id}`, { method: 'PATCH', body });
  closeModal();
  toast('已更新');
  await navigate(state.currentView);
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
  const result = await api('/ai/split-requirement', { method: 'POST', body: { text, sprint_id: state.activeSprint?.id } });
  const el = document.getElementById('aiSplitResult');
  if (el) { el.style.display = 'block'; el.textContent = result.summary + '\n\n已创建:\n• Epic: ' + result.epic.title + '\n• Stories: ' + result.stories.map(s => s.title).join('\n• '); }
  toast('AI 拆分完成，已加入 Backlog');
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
}

async function runRisks() {
  toast('AI 扫描风险...');
  const result = await api('/ai/risks', { method: 'POST' });
  const level = result.count > 0 ? 'warning' : 'success';
  showModal(`风险扫描 (${result.count} 项)`, `<div class="ai-result" style="display:block;max-height:60vh">${esc(result.content)}</div>`);
  toast(result.count ? `发现 ${result.count} 个风险` : '无显著风险', result.count ? 'error' : 'success');
  await loadData();
}

async function runRetro() {
  toast('AI 生成 Retro 报告...');
  const result = await api('/ai/retro', { method: 'POST' });
  showModal('Sprint Retro 报告', `<div class="ai-result" style="display:block;max-height:60vh">${esc(result.content)}</div>`);
  await loadData();
}

// ── Utils ──
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function fmtTime(t) { if (!t) return ''; const d = new Date(t.includes('T') ? t : t + 'Z'); return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }

// ── Init ──
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.view)));
document.getElementById('btnNewItem').addEventListener('click', showNewItemModal);
document.getElementById('btnStandup').addEventListener('click', runStandup);
document.getElementById('btnRisks').addEventListener('click', runRisks);
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('activeSprintBadge').addEventListener('click', () => navigate('sprint'));

navigate('dashboard');
