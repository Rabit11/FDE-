const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { SEED_USERS, hashPassword, LEADER_NAMES, normalizeDept } = require('./auth');

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'platform.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function load() {
  if (!fs.existsSync(dbFile)) {
    return { items: [], activity_log: [], ai_insights: [], chat_history: [], voice_documents: [] };
  }
  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  if (!data.users) data.users = [];
  if (!data.chat_history) data.chat_history = [];
  if (!data.voice_documents) data.voice_documents = [];
  if (!data.req_counter) data.req_counter = {};
  let healed = false;
  if (data.sprints) {
    delete data.sprints;
    healed = true;
  }
  data.items.forEach(i => {
    if (!i.progress_updates) i.progress_updates = [];
    if (!i.assistants) i.assistants = [];
    if (i.reviewer === undefined) i.reviewer = null;
    if (i.team_size === undefined) i.team_size = null;
    if (i.blocker_type === undefined) i.blocker_type = null;
    if (i.sprint_id) {
      delete i.sprint_id;
      healed = true;
    }
    if (i.status === 'backlog') {
      i.status = 'in_progress';
      healed = true;
    }
    if (!i.req_no && (i.status === 'submitted' || (i.status === 'in_progress' && ['story', 'epic', 'task', 'bug'].includes(i.type)))) {
      const year = new Date(i.created_at || Date.now()).getFullYear();
      data.req_counter[year] = (data.req_counter[year] || 0) + 1;
      i.req_no = `REQ-${year}-${String(data.req_counter[year]).padStart(4, '0')}`;
      healed = true;
    }
    if (!i.reviewer && i.created_by && data.users?.length) {
      const creator = data.users.find(u => u.name === i.created_by);
      if (creator && (creator.capabilities || []).includes('reviewer')) {
        i.reviewer = i.created_by;
        healed = true;
      }
    }
    if (i.status === 'done' && i.acceptance_status === 'terminated') {
      i.status = 'terminated';
      healed = true;
    }
    if (i.status === 'submitted' && i.reviewer && i.assignee) {
      i.status = 'in_progress';
      i.updated_at = new Date().toISOString();
      healed = true;
    }
    if (i.type === 'task' && !i.assignee && i.parent_id) {
      const parent = data.items.find(p => p.id === i.parent_id);
      if (parent) {
        if (parent.assignee && !i.assignee) { i.assignee = parent.assignee; healed = true; }
        if ((parent.assistants || []).length && !(i.assistants || []).length) { i.assistants = parent.assistants; healed = true; }
        if (!i.reviewer && parent.reviewer) { i.reviewer = parent.reviewer; healed = true; }
      }
    }
  });
  if (healed) save(data);
  if (data.users?.length) {
    data.users.forEach(u => {
      const nextDept = normalizeDept(u.dept);
      if (nextDept !== u.dept) {
        u.dept = nextDept;
        save(data);
      }
    });
  }
  return data;
}

function save(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

function seedUsers(data) {
  const defaultProfile = () => ({
    bio: '', skills: [], availability: 'available', max_wip: 4,
    project_history: [],
  });

  if (data.users.length === 0) {
    data.users = SEED_USERS.map(u => ({
      id: uuid(), emp_id: u.emp_id, name: u.name,
      password: hashPassword(u.password), role: u.role, dept: u.dept,
      capabilities: u.capabilities || ['proposer', 'executor'],
      can_manage_users: u.can_manage_users || false,
      can_view_profiles: true,
      profile: defaultProfile(),
      active: true, created_at: new Date().toISOString(),
    }));
    save(data);
    return;
  }

  data.users.forEach(u => {
    if (!u.capabilities) {
      u.capabilities = u.role === 'admin' || u.role === 'manager'
        ? ['reviewer', 'proposer', 'executor'] : ['proposer', 'executor'];
      u.can_manage_users = u.role === 'admin';
      u.can_view_profiles = true;
      u.role = u.role === 'executor' ? 'member' : u.role;
    }
    if (u.dept === '管理部门') u.dept = '审核人';
    if (u.dept === '执行团队' || u.dept === '执行部门') u.dept = '执行人';
    if (LEADER_NAMES.includes(u.name) || (u.role === 'manager' && (u.capabilities || []).includes('reviewer'))) {
      u.can_manage_users = false;
    }
    if (u.role === 'admin') u.can_manage_users = true;
    if (!u.profile) u.profile = defaultProfile();
  });
  save(data);
}

function seedIfEmpty(data) {
  seedUsers(data);
  if (data.items.length > 0) return data;

  const now = new Date();

  const stories = [
    { title: '流动看板与 WIP 限制', desc: 'Kanban 三列视图，WIP 上限告警', pts: 8, status: 'in_progress' },
    { title: 'AI 需求拆分助手', desc: '自然语言需求自动拆分为用户故事', pts: 5, status: 'in_progress' },
    { title: '在线验收中心', desc: '需求方在线验收，反馈自动回流', pts: 3, status: 'review' },
    { title: '度量仪表盘', desc: 'Lead Time、吞吐量', pts: 5, status: 'todo' },
    { title: 'AI 站会摘要生成', desc: '基于任务变更自动生成站会报告', pts: 3, status: 'in_progress' },
    { title: '风险预警引擎', desc: '延期概率预测与阻塞智能分类', pts: 5, status: 'in_progress' },
  ];

  stories.forEach((s, i) => {
    data.items.push({
      id: uuid(), type: 'story', title: s.title, description: s.desc, status: s.status,
      priority: i < 2 ? 1 : 2, story_points: s.pts,
      acceptance_criteria: `Given ${s.title}\nWhen 功能完成\nThen 可通过验收测试`,
      ai_generated: 0, blocked_reason: null, demo_url: null,
      acceptance_status: 'pending', acceptance_feedback: null,
      assignee: i === 0 ? '赵立泽' : i === 1 ? '王诗瑶' : null,
      created_by: '曾锐', parent_id: null,
      created_at: now.toISOString(), updated_at: now.toISOString(), completed_at: s.status === 'done' ? now.toISOString() : null,
    });
  });

  data.items.push({
    id: uuid(), type: 'bug', title: '看板拖拽在移动端失效', description: '触摸事件未绑定',
    status: 'blocked', priority: 1, story_points: 2,
    blocked_reason: '等待前端工程师修复触摸事件',
    acceptance_criteria: '', ai_generated: 0, demo_url: null,
    acceptance_status: 'pending', acceptance_feedback: null,
    assignee: '万贤书', created_by: '张弛', parent_id: null,
    created_at: now.toISOString(), updated_at: now.toISOString(), completed_at: null,
  });

  data.items.push({
    id: uuid(), type: 'story', title: 'AI 模型接入与智能对话', description: '接入 LLM API 实现智能需求拆分和 AI Copilot',
    status: 'submitted', priority: 1, story_points: 8,
    acceptance_criteria: 'Given LLM API 配置\nWhen 用户提问\nThen AI 给出专业回答',
    ai_generated: 0, blocked_reason: null, demo_url: null,
    acceptance_status: 'pending', acceptance_feedback: null,
    assignee: null, created_by: '刘紫薇', parent_id: null,
    created_at: now.toISOString(), updated_at: now.toISOString(), completed_at: null,
  });

  save(data);
  return data;
}

let _data = seedIfEmpty(load());

const queries = {
  _persist() { save(_data); },

  getUsers() { return _data.users.map(({ password, ...u }) => ({ ...u, dept: normalizeDept(u.dept) })); },
  getUserById(id) { const u = _data.users.find(x => x.id === id); if (!u) return null; const { password, ...safe } = u; return { ...safe, dept: normalizeDept(safe.dept) }; },
  getUserByName(name) { const u = _data.users.find(x => x.name === name); if (!u) return null; const { password, ...safe } = u; return safe; },
  getUsersRaw() { return _data.users; },

  updateUserProfile(id, profileData) {
    const u = _data.users.find(x => x.id === id);
    if (!u) return null;
    u.profile = { ...u.profile, ...profileData };
    queries._persist();
    const { password, ...safe } = u;
    return safe;
  },

  saveChat(userId, role, content) {
    _data.chat_history.push({ id: uuid(), user_id: userId, role, content, created_at: new Date().toISOString() });
    if (_data.chat_history.length > 500) _data.chat_history = _data.chat_history.slice(-500);
    queries._persist();
  },
  getChatHistory(userId, limit = 30) {
    return _data.chat_history.filter(c => c.user_id === userId).slice(-limit);
  },

  getItems(filters = {}) {
    let items = [..._data.items];
    if (filters.status) items = items.filter(i => i.status === filters.status);
    if (filters.type) items = items.filter(i => i.type === filters.type);
    if (filters.assignee) items = items.filter(i => i.assignee === filters.assignee);
    if (filters.created_by) items = items.filter(i => i.created_by === filters.created_by);
    if (filters.status_in) items = items.filter(i => filters.status_in.includes(i.status));
    if (filters.involved) {
      const name = filters.involved;
      items = items.filter(i => i.assignee === name || (i.assistants || []).includes(name));
    }
    return items.sort((a, b) => a.priority - b.priority || b.created_at.localeCompare(a.created_at));
  },
  getMyWorkItems(userName) {
    queries.healStuckSubmissions();
    const active = ['todo', 'in_progress', 'blocked', 'review'];
    return _data.items.filter(i =>
      (i.assignee === userName || (i.assistants || []).includes(userName)) &&
      active.includes(i.status)
    ).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  },
  healStuckSubmissions() {
    let count = 0;
    _data.items.forEach(i => {
      if (i.status === 'submitted' && i.reviewer && i.assignee) {
        i.status = 'in_progress';
        i.updated_at = new Date().toISOString();
        count++;
      }
    });
    if (count) queries._persist();
    return count;
  },
  getItem(id) { return _data.items.find(i => i.id === id); },
  generateReqNo() {
    const year = new Date().getFullYear();
    if (!_data.req_counter) _data.req_counter = {};
    _data.req_counter[year] = (_data.req_counter[year] || 0) + 1;
    return `REQ-${year}-${String(_data.req_counter[year]).padStart(4, '0')}`;
  },
  createItem(data) {
    let status = data.status || 'in_progress';
    // 需求提交流程：有审核人+主执行人则直接进入进行中，不经过 submitted
    if (data.reviewer && data.assignee && status === 'submitted') {
      status = 'in_progress';
    }
    const reqNo = (status === 'submitted' || data.generate_req_no) ? queries.generateReqNo() : (data.req_no || null);
    const item = {
      id: uuid(), type: data.type || 'story', title: data.title,
      req_no: reqNo,
      description: data.description || '', status,
      priority: data.priority ?? 3, story_points: data.story_points ?? 0,
      assignee: data.assignee || null,
      parent_id: data.parent_id || null, acceptance_criteria: data.acceptance_criteria || '',
      created_by: data.created_by || null,
      assistants: data.assistants || [],
      reviewer: data.reviewer || null,
      team_size: data.team_size || null,
      ai_generated: data.ai_generated ? 1 : 0,
      blocked_reason: data.blocked_reason || null,
      blocker_type: data.blocker_type || null,
      progress_updates: data.progress_updates || [],
      demo_url: data.demo_url || null, acceptance_status: 'pending', acceptance_feedback: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null,
    };
    _data.items.push(item);
    queries.logActivity(item.id, 'created', `创建 ${item.type}: ${item.title}`, data.actor || 'user');
    queries._persist();
    return item;
  },
  updateItem(id, data) {
    const idx = _data.items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    const prev = { ..._data.items[idx] };
    const current = _data.items[idx];
    const fields = ['title', 'description', 'status', 'priority', 'story_points', 'assignee', 'assistants', 'parent_id', 'acceptance_criteria', 'blocked_reason', 'blocker_type', 'demo_url', 'acceptance_status', 'acceptance_feedback', 'created_by', 'reviewer', 'team_size', 'req_no'];
    fields.forEach(f => { if (data[f] !== undefined) current[f] = data[f]; });
    if (data.status === 'terminated' && data.acceptance_status === undefined) {
      current.acceptance_status = 'terminated';
    }
    if (data.status === 'done' && data.acceptance_status === undefined && prev.status !== 'done') {
      current.acceptance_status = 'accepted';
    }
    if (data.status === 'in_progress' && ['done', 'terminated'].includes(prev.status) && data.acceptance_status === undefined) {
      current.acceptance_status = 'pending';
    }
    if (data.status === 'in_progress' && prev.status === 'blocked') {
      if (data.blocked_reason === undefined) current.blocked_reason = null;
      if (data.blocker_type === undefined) current.blocker_type = null;
    }
    if (data.status === 'done' || data.status === 'terminated') {
      if (!current.completed_at) current.completed_at = new Date().toISOString();
    }
    if (data.status && !['done', 'terminated'].includes(data.status) && ['done', 'terminated'].includes(prev.status)) {
      current.completed_at = null;
    }
    if (data.clear_completed) current.completed_at = null;
    current.updated_at = new Date().toISOString();
    _data.items[idx] = current;
    if (data.status && data.status !== prev.status) {
      queries.logActivity(id, 'status_change', `${prev.status} → ${data.status}`, data.actor || 'user');
    }
    queries._persist();
    return current;
  },
  deleteItem(id) {
    _data.items = _data.items.filter(i => i.id !== id);
    queries._persist();
  },
  addProgressUpdate(itemId, data) {
    const item = _data.items.find(i => i.id === itemId);
    if (!item) return null;
    if (!item.progress_updates) item.progress_updates = [];
    const update = {
      id: uuid(),
      date: data.date || new Date().toISOString().slice(0, 10),
      user: data.user,
      description: data.description || '',
      blocker_type: data.blocker_type || null,
      blocker_desc: data.blocker_desc || '',
      created_at: new Date().toISOString(),
    };
    item.progress_updates.unshift(update);
    if (item.progress_updates.length > 30) item.progress_updates = item.progress_updates.slice(0, 30);
    if (data.blocker_type && data.blocker_type !== 'none') {
      item.status = 'blocked';
      item.blocker_type = data.blocker_type;
      const typeLabels = { resource: '资源冲突', time: '时间冲突', technical: '技术问题', other: '其他' };
      item.blocked_reason = `[${typeLabels[data.blocker_type] || data.blocker_type}] ${data.blocker_desc || data.description}`;
    }
    item.updated_at = new Date().toISOString();
    queries.logActivity(itemId, 'progress', `${data.user} 提交进展${data.blocker_type && data.blocker_type !== 'none' ? ' · 卡点: ' + data.blocker_type : ''}`, data.user);
    queries._persist();
    return { item, update };
  },
  getUserProjects(userName) {
    const items = _data.items.filter(i =>
      ['story', 'epic', 'task', 'bug'].includes(i.type) &&
      (i.assignee === userName || (i.assistants || []).includes(userName) || i.created_by === userName)
    );
    return items.map(i => queries.mapProfileProjectRow(i))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  },
  getUserReviewProjects(userName) {
    const items = _data.items.filter(i =>
      ['story', 'epic', 'task', 'bug'].includes(i.type) &&
      i.reviewer === userName
    );
    return items.map(i => queries.mapProfileProjectRow(i))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  },
  mapProfileProjectRow(i) {
    return {
      item_id: i.id,
      task_no: i.req_no || '-',
      task_name: i.title,
      proposer: i.created_by || '-',
      reviewer: i.reviewer || '-',
      assignee: i.assignee || '-',
      assistants: i.assistants || [],
      status: i.status,
      acceptance_status: i.acceptance_status,
      acceptance_feedback: i.acceptance_feedback,
      blocker_type: i.blocker_type,
      blocked_reason: i.blocked_reason,
      description: i.description || '',
      acceptance_criteria: i.acceptance_criteria || '',
      progress_updates: i.progress_updates || [],
      created_at: i.created_at || null,
      completed_at: i.completed_at || null,
      updated_at: i.updated_at || i.created_at,
    };
  },
  logActivity(itemId, action, detail, actor = 'system') {
    _data.activity_log.push({
      id: uuid(), item_id: itemId, action, detail, actor,
      created_at: new Date().toISOString(),
    });
    queries._persist();
  },
  getActivity(limit = 50) {
    return _data.activity_log
      .map(a => ({ ...a, item_title: _data.items.find(i => i.id === a.item_id)?.title }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  },
  getMetrics() {
    const byStatus = {};
    _data.items.forEach(i => { byStatus[i.status] = (byStatus[i.status] || 0) + 1; });
    const totalPoints = _data.items.filter(i => ['story', 'task'].includes(i.type)).reduce((s, i) => s + (i.story_points || 0), 0);
    const donePoints = _data.items.filter(i => i.status === 'done').reduce((s, i) => s + (i.story_points || 0), 0);
    const blocked = _data.items.filter(i => i.status === 'blocked').length;
    const completed = _data.items.filter(i => i.completed_at);
    const avgLeadTime = completed.length
      ? Math.round(completed.reduce((s, i) => s + (new Date(i.completed_at) - new Date(i.created_at)) / 86400000, 0) / completed.length * 10) / 10
      : 0;
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    const throughput = _data.items.filter(i => i.status === 'done' && i.completed_at >= twoWeeksAgo).length;
    return {
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      totalPoints, donePoints, blocked, avgLeadTime, throughput,
    };
  },
  saveInsight(type, title, content, severity = 'info') {
    const insight = { id: uuid(), type, title, content, severity, created_at: new Date().toISOString() };
    _data.ai_insights.unshift(insight);
    queries._persist();
    return insight;
  },
  getInsights(limit = 20) { return _data.ai_insights.slice(0, limit); },

  saveVoiceDoc(doc) {
    _data.voice_documents.unshift(doc);
    if (_data.voice_documents.length > 100) _data.voice_documents = _data.voice_documents.slice(0, 100);
    queries._persist();
    return doc;
  },
  getVoiceDocs(limit = 20) {
    return _data.voice_documents.slice(0, limit);
  },
  getVoiceDoc(id) { return _data.voice_documents.find(d => d.id === id); },
  updateVoiceDoc(id, updates) {
    const doc = _data.voice_documents.find(d => d.id === id);
    if (!doc) return null;
    Object.assign(doc, updates);
    queries._persist();
    return doc;
  },
};

module.exports = { queries };
