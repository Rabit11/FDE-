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

let state = { items: [], sprints: [], users: [], metrics: {}, activity: [], insights: [], chatHistory: [], voiceDocs: [], currentView: '', activeSprint: null, user: null, roleConfig: null, llmEnabled: false, aiStatus: null, recording: false, mediaRecorder: null };

function getToken() { return localStorage.getItem('agileai_token'); }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) { localStorage.clear(); location.href = '/login.html'; return; }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function loadData() {
  const [items, sprints, metrics, activity, insights, users] = await Promise.all([
    api('/items'), api('/sprints'), api('/metrics'), api('/activity?limit=30'), api('/ai/insights'), api('/users'),
  ]);
  state = { ...state, items, sprints, metrics, activity, insights, users, activeSprint: sprints.find(s => s.status === 'active') };
  updateSprintBadge();
}

function buildNav() {
  const nav = document.getElementById('navMenu');
  const items = state.roleConfig?.nav || [];
  nav.innerHTML = items.map(n => `<button class="nav-item" data-view="${n.id}">${n.label}</button>`).join('');
  nav.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.view)));
}

function buildTopbar() {
  const el = document.getElementById('topbarActions');
  const role = state.user?.role;
  if (role === 'executor') {
    el.innerHTML = `<button class="btn btn-ghost" id="btnStandup">📋 站会</button><button class="btn btn-primary" id="btnNewItem">+ 上报进度</button>`;
  } else {
    el.innerHTML = `<button class="btn btn-ghost" id="btnStandup">📋 站会摘要</button><button class="btn btn-ghost" id="btnRisks">⚠️ 风险扫描</button><button class="btn btn-primary" id="btnNewItem">+ 新建</button>`;
  }
  document.getElementById('btnNewItem')?.addEventListener('click', () => role === 'executor' ? navigate('submit') : showNewItemModal());
  document.getElementById('btnStandup')?.addEventListener('click', runStandup);
  document.getElementById('btnRisks')?.addEventListener('click', runRisks);
}

function setupUserCard() {
  const u = state.user;
  document.getElementById('userName').textContent = u.name;
  document.getElementById('userAvatar').textContent = u.name.slice(0, 1);
  document.getElementById('userRole').innerHTML = `<span class="role-badge role-${u.role}">${state.roleConfig?.label || u.role}</span> · ${u.dept || ''}`;
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
  const showSplit = state.user?.role !== 'executor';
  return `
    <div class="ai-panel">
      ${showSplit ? `<div class="ai-card">
        <h3>🧠 AI 需求拆分 ${state.llmEnabled ? '<span class="llm-tag">LLM</span>' : ''}</h3>
        <p style="color:var(--muted);font-size:0.85rem;margin-bottom:0.75rem">自然语言需求 → Epic + Story + Task</p>
        <div class="form-group"><textarea id="aiRequirement" placeholder="描述你的需求..."></textarea></div>
        <button class="btn btn-primary" onclick="runSplit()">🚀 AI 拆分并创建</button>
        <div class="ai-result" id="aiSplitResult" style="display:none"></div>
      </div>` : ''}
      <div class="ai-card" style="${showSplit ? '' : 'grid-column:1/-1'}">
        <h3>💬 AI 智能协作者 ${state.llmEnabled ? '<span class="llm-tag">LLM</span>' : '<span class="llm-tag local">本地</span>'}</h3>
        <div class="chat-box" id="chatBox">
          <div class="chat-messages" id="chatMessages">
            <div class="chat-msg assistant">你好 ${esc(state.user?.name)}！我是 AgileAI 协作者，可以帮你分析任务、评估风险、规划 Sprint。</div>
          </div>
          <div class="chat-input-row">
            <input id="chatInput" placeholder="问我 anything：任务进度、风险分析、拆分建议..." onkeydown="if(event.key==='Enter')sendChat()">
            <button class="btn btn-primary btn-sm" onclick="sendChat()">发送</button>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="quickChat('我当前有哪些任务？')">我的任务</button>
          <button class="btn btn-ghost btn-sm" onclick="quickChat('分析当前项目风险')">风险分析</button>
          <button class="btn btn-ghost btn-sm" onclick="runStandup()">站会摘要</button>
          <button class="btn btn-ghost btn-sm" onclick="runRisks()">风险扫描</button>
          ${showSplit ? '<button class="btn btn-ghost btn-sm" onclick="runRetro()">Retro</button>' : ''}
        </div>
      </div>
      ${showSplit ? `<div class="ai-card" style="grid-column:1/-1">
        <h3>📡 AI 洞察历史</h3>
        <div class="insight-list" id="insightList">
          ${state.insights.map(i => `<div class="insight-item ${i.severity}"><div class="insight-title">${esc(i.title)}</div><div class="insight-time">${fmtTime(i.created_at)} · ${i.type}</div><div class="insight-content">${esc(i.content)}</div></div>`).join('') || '<div class="empty-state">暂无</div>'}
        </div>
      </div>` : ''}
    </div>`;
}

function renderMyWork() {
  const mine = state.items.filter(i => i.assignee === state.user.name);
  const active = mine.filter(i => ['todo', 'in_progress', 'blocked', 'review'].includes(i.status));
  const done = mine.filter(i => i.status === 'done');
  const submitted = state.items.filter(i => i.created_by === state.user.name);
  return `
    <div class="card-grid">
      <div class="card stat-card blue"><div class="label">我的任务</div><div class="value">${mine.length}</div></div>
      <div class="card stat-card yellow"><div class="label">进行中</div><div class="value">${active.length}</div></div>
      <div class="card stat-card green"><div class="label">已完成</div><div class="value">${done.length}</div></div>
      <div class="card stat-card purple"><div class="label">我提交的</div><div class="value">${submitted.length}</div></div>
    </div>
    <div class="section-title">待办任务</div>
    <div class="backlog-list">
      ${active.map(i => `<div class="backlog-item" onclick="showItemDetail('${i.id}')">
        <div class="priority-dot priority-${i.priority}"></div>
        <span class="type-badge type-${i.type}">${TYPE_LABELS[i.type]}</span>
        <div class="info"><div class="title">${esc(i.title)}</div><div class="desc">${STATUS_LABELS[i.status]} · ${i.story_points || 0} SP</div></div>
      </div>`).join('') || '<div class="empty-state">暂无待办 🎉</div>'}
    </div>
    <div style="margin-top:1rem;display:flex;gap:0.5rem">
      <button class="btn btn-primary" onclick="navigate('submit')">📤 提交需求</button>
      <button class="btn btn-ghost" onclick="quickChat('帮我规划今天的工作优先级')">🤖 AI 规划今日</button>
    </div>`;
}

function renderSubmit() {
  return `
    <div class="card" style="max-width:640px">
      <h3 style="margin-bottom:0.75rem">📤 提交需求</h3>
      <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1rem">提交后将进入管理员审核队列，审核通过后分配执行人。</p>
      <div class="form-group"><label>需求标题</label><input id="reqTitle" placeholder="简要描述你的需求"></div>
      <div class="form-group"><label>应用场景</label><textarea id="reqScene" placeholder="描述应用场景和业务目标..."></textarea></div>
      <div class="form-group"><label>验收目标</label><textarea id="reqAccept" placeholder="期望达成什么效果？"></textarea></div>
      <div class="form-group"><label>期望时间</label><input id="reqDeadline" type="date"></div>
      <button class="btn btn-primary" onclick="submitRequirement()">提交需求</button>
      <button class="btn btn-ghost" style="margin-left:0.5rem" onclick="aiAssistSubmit()">🤖 AI 辅助填写</button>
    </div>
    <div class="section-title">我提交的需求</div>
    <div class="backlog-list">
      ${state.items.filter(i => i.created_by === state.user.name).map(i => `
        <div class="backlog-item" onclick="showItemDetail('${i.id}')">
          <span class="type-badge type-${i.type}">${TYPE_LABELS[i.type]}</span>
          <div class="info"><div class="title">${esc(i.title)}</div><div class="desc">${STATUS_LABELS[i.status] || i.status} · 提交于 ${fmtTime(i.created_at)}</div></div>
        </div>`).join('') || '<div class="empty-state">暂无提交记录</div>'}
    </div>`;
}

function renderReview() {
  const pending = state.items.filter(i => i.status === 'submitted' || (i.status === 'backlog' && !i.assignee && i.created_by));
  const executors = state.users.filter(u => u.role === 'executor');
  return `
    <div class="section-title">待审核需求 (${pending.length})</div>
    ${pending.length ? pending.map(i => `
      <div class="accept-card">
        <span class="type-badge type-${i.type}">${TYPE_LABELS[i.type]}</span>
        <h3>${esc(i.title)}</h3>
        <p style="color:var(--muted);font-size:0.85rem">${esc(i.description || '')}</p>
        <p style="font-size:0.82rem">提交人: <strong>${esc(i.created_by || '未知')}</strong> · ${i.story_points || 0} SP</p>
        <div class="accept-actions">
          <select id="assign-${i.id}" style="padding:0.35rem 0.5rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);margin-right:0.5rem">
            <option value="">选择执行人</option>
            ${executors.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" onclick="aiAssign('${i.id}')">🤖 AI推荐</button>
          <button class="btn btn-success btn-sm" onclick="reviewItem('${i.id}','approve')">✅ 通过并分配</button>
          <button class="btn btn-danger btn-sm" onclick="reviewItem('${i.id}','reject')">❌ 驳回</button>
        </div>
      </div>`).join('') : '<div class="empty-state">✅ 无待审核需求</div>'}`;
}

function renderTeam() {
  const roleLabels = { admin: '超级管理员', manager: '管理员', executor: '执行人员' };
  return `
    <div class="section-title">团队成员 (${state.users.length})</div>
    <div class="team-grid">
      ${state.users.map(u => {
        const workload = state.items.filter(i => i.assignee === u.name && !['done','backlog'].includes(i.status)).length;
        return `<div class="team-card">
          <div class="team-avatar">${u.name.slice(0,1)}</div>
          <div class="team-info">
            <div class="team-name">${esc(u.name)} <span class="role-badge role-${u.role}">${roleLabels[u.role]}</span></div>
            <div class="team-meta">工号 ${u.emp_id} · ${u.dept || ''} · 进行中 ${workload} 项</div>
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
            <input type="checkbox" id="autoCreateTasks" checked> 自动创建任务到 Backlog
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
        <div class="backlog-list" style="margin-top:0.75rem">
          ${(data.createdItems?.stories || []).map(s => `<div class="backlog-item"><span class="type-badge type-story">Story</span><div class="info"><div class="title">${esc(s.title)}</div><div class="desc">${s.story_points||0} SP</div></div></div>`).join('')}
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
  const btn = document.getElementById('btnRecord');
  const status = document.getElementById('recordStatus');
  if (!state.recording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      state.mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      state.mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        processVoiceFile(new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' }));
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

// ── Actions ──
async function navigate(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  const titles = { dashboard: '仪表盘', kanban: '流动看板', backlog: 'Backlog', sprint: 'Sprint', review: '审核分配', acceptance: '验收中心', ai: 'AI 助手', mywork: '我的工作台', submit: '提交需求', team: '团队管理', voice: '语音需求' };
  document.getElementById('pageTitle').textContent = titles[view] || view;
  await loadData();
  if (view === 'voice') await loadVoiceDocs();
  const renderers = { dashboard: renderDashboard, kanban: renderKanban, backlog: renderBacklog, sprint: renderSprint, review: renderReview, acceptance: renderAcceptance, ai: renderAI, mywork: renderMyWork, submit: renderSubmit, team: renderTeam, voice: renderVoice };
  document.getElementById('content').innerHTML = renderers[view] ? renderers[view]() : '<div class="empty-state">页面不存在</div>';
  if (view === 'kanban') initDragDrop();
  if (view === 'voice') initVoiceUpload();
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
  showModal(`Sprint Retro (${result.engine === 'llm' ? 'LLM' : '本地'})`, `<div class="ai-result" style="display:block;max-height:60vh">${esc(result.content)}</div>`);
  await loadData();
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const q = input?.value?.trim();
  if (!q) return;
  appendChat('user', q);
  input.value = '';
  try {
    const result = await api('/ai/copilot', { method: 'POST', body: { question: q } });
    appendChat('assistant', result.answer, result.engine);
  } catch (e) { appendChat('assistant', '抱歉，处理失败：' + e.message); }
}

function quickChat(q) { navigate('ai').then(() => { setTimeout(() => { const el = document.getElementById('chatInput'); if (el) { el.value = q; sendChat(); } }, 300); }); }
function appendChat(role, text, engine) {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `${esc(text)}${engine ? `<span class="engine-tag">${engine}</span>` : ''}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function submitRequirement() {
  const title = document.getElementById('reqTitle').value;
  const scene = document.getElementById('reqScene').value;
  const accept = document.getElementById('reqAccept').value;
  const deadline = document.getElementById('reqDeadline').value;
  if (!title.trim()) return toast('请填写需求标题', 'error');
  await api('/items', { method: 'POST', body: {
    type: 'story', title, description: `场景: ${scene}\n验收: ${accept}\n期望: ${deadline}`,
    acceptance_criteria: accept, story_points: 3, priority: 2,
  }});
  toast('需求已提交，等待管理员审核');
  await navigate('submit');
}

async function aiAssistSubmit() {
  const scene = document.getElementById('reqScene').value;
  if (!scene.trim()) return toast('请先填写应用场景', 'error');
  toast('AI 辅助生成中...');
  const result = await api('/ai/copilot', { method: 'POST', body: { question: `根据以下场景生成需求标题和验收标准，简洁回答：\n${scene}` } });
  showModal('AI 辅助建议', `<div class="ai-result" style="display:block">${esc(result.answer)}</div>`);
}

async function reviewItem(id, action) {
  const assignee = document.getElementById(`assign-${id}`)?.value;
  if (action === 'approve' && !assignee) return toast('请选择执行人', 'error');
  if (action === 'reject') {
    const comment = prompt('驳回原因：');
    if (!comment) return;
    await api(`/items/${id}/review`, { method: 'POST', body: { action, comment } });
  } else {
    await api(`/items/${id}/review`, { method: 'POST', body: { action, assignee } });
  }
  toast(action === 'approve' ? '已通过并分配' : '已驳回');
  await navigate('review');
}

async function aiAssign(id) {
  toast('AI 分析最佳人选...');
  const result = await api(`/items/${id}/suggest-assignee`, { method: 'POST' });
  if (result?.assignee) {
    const sel = document.getElementById(`assign-${id}`);
    if (sel) sel.value = result.assignee;
    toast(`AI 推荐: ${result.assignee} (${result.reason})`);
  }
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
    state.user = me.user;
    state.roleConfig = me.roleConfig;
    state.llmEnabled = me.llmEnabled;
    state.aiStatus = me.ai;
    setupUserCard();
    buildNav();
    buildTopbar();
    const defaultView = state.roleConfig?.nav?.[0]?.id || 'dashboard';
    await navigate(defaultView);
  } catch { localStorage.clear(); location.href = '/login.html'; }
}

// ── Utils ──
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function fmtTime(t) { if (!t) return ''; const d = new Date(t.includes('T') ? t : t + 'Z'); return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }

// ── Init ──
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('activeSprintBadge').addEventListener('click', () => { if (state.roleConfig?.nav?.find(n => n.id === 'sprint')) navigate('sprint'); });
document.getElementById('btnLogout').addEventListener('click', logout);

initApp();
