const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'platform.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function load() {
  if (!fs.existsSync(dbFile)) {
    return { sprints: [], items: [], activity_log: [], ai_insights: [] };
  }
  return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}

function save(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

function seedIfEmpty(data) {
  if (data.items.length > 0) return data;

  const sprintId = uuid();
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 14);

  data.sprints.push({
    id: sprintId, name: 'Sprint 1', goal: '搭建 AI 敏捷平台 MVP，完成看板与 AI 需求助手',
    start_date: now.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10),
    status: 'active', created_at: now.toISOString(),
  });

  const stories = [
    { title: '智能 Backlog 管理', desc: '支持 Epic/Story/Task 层级与拖拽排序', pts: 5, status: 'done' },
    { title: '流动看板与 WIP 限制', desc: 'Kanban 多列视图，WIP 上限告警', pts: 8, status: 'in_progress' },
    { title: 'AI 需求拆分助手', desc: '自然语言需求自动拆分为用户故事', pts: 5, status: 'in_progress' },
    { title: '在线验收中心', desc: '需求方在线验收，反馈自动转 Backlog', pts: 3, status: 'review' },
    { title: 'Sprint 度量仪表盘', desc: 'Lead Time、燃尽图、吞吐量', pts: 5, status: 'todo' },
    { title: 'AI 站会摘要生成', desc: '基于任务变更自动生成站会报告', pts: 3, status: 'backlog' },
    { title: '风险预警引擎', desc: '延期概率预测与阻塞智能分类', pts: 5, status: 'backlog' },
  ];

  stories.forEach((s, i) => {
    data.items.push({
      id: uuid(), type: 'story', title: s.title, description: s.desc, status: s.status,
      priority: i < 2 ? 1 : 2, story_points: s.pts, sprint_id: sprintId,
      acceptance_criteria: `Given ${s.title}\nWhen 功能完成\nThen 可通过验收测试`,
      ai_generated: 0, blocked_reason: null, demo_url: null,
      acceptance_status: 'pending', acceptance_feedback: null,
      assignee: null, parent_id: null,
      created_at: now.toISOString(), updated_at: now.toISOString(), completed_at: s.status === 'done' ? now.toISOString() : null,
    });
  });

  data.items.push({
    id: uuid(), type: 'bug', title: '看板拖拽在移动端失效', description: '触摸事件未绑定',
    status: 'blocked', priority: 1, story_points: 2, sprint_id: sprintId,
    blocked_reason: '等待前端工程师修复触摸事件',
    acceptance_criteria: '', ai_generated: 0, demo_url: null,
    acceptance_status: 'pending', acceptance_feedback: null,
    assignee: null, parent_id: null,
    created_at: now.toISOString(), updated_at: now.toISOString(), completed_at: null,
  });

  save(data);
  return data;
}

let _data = seedIfEmpty(load());

const queries = {
  _persist() { save(_data); },

  getSprints() { return [..._data.sprints].sort((a, b) => b.start_date.localeCompare(a.start_date)); },
  getSprint(id) { return _data.sprints.find(s => s.id === id); },
  createSprint(data) {
    const sprint = {
      id: uuid(), name: data.name, goal: data.goal || '',
      start_date: data.start_date, end_date: data.end_date,
      status: data.status || 'planning', created_at: new Date().toISOString(),
    };
    _data.sprints.push(sprint);
    queries._persist();
    return sprint;
  },

  getItems(filters = {}) {
    let items = [..._data.items];
    if (filters.sprint_id) items = items.filter(i => i.sprint_id === filters.sprint_id);
    if (filters.status) items = items.filter(i => i.status === filters.status);
    if (filters.type) items = items.filter(i => i.type === filters.type);
    return items.sort((a, b) => a.priority - b.priority || b.created_at.localeCompare(a.created_at));
  },
  getItem(id) { return _data.items.find(i => i.id === id); },
  createItem(data) {
    const item = {
      id: uuid(), type: data.type || 'story', title: data.title,
      description: data.description || '', status: data.status || 'backlog',
      priority: data.priority ?? 3, story_points: data.story_points ?? 0,
      assignee: data.assignee || null, sprint_id: data.sprint_id || null,
      parent_id: data.parent_id || null, acceptance_criteria: data.acceptance_criteria || '',
      ai_generated: data.ai_generated ? 1 : 0, blocked_reason: data.blocked_reason || null,
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
    const fields = ['title', 'description', 'status', 'priority', 'story_points', 'assignee', 'sprint_id', 'parent_id', 'acceptance_criteria', 'blocked_reason', 'demo_url', 'acceptance_status', 'acceptance_feedback'];
    fields.forEach(f => { if (data[f] !== undefined) current[f] = data[f]; });
    if (data.status === 'done' && !current.completed_at) {
      current.completed_at = new Date().toISOString();
    }
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
};

module.exports = { queries };
