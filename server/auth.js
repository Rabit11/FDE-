const crypto = require('crypto');

const CAPABILITIES = {
  reviewer: { label: '审核人员', icon: '🔍' },
  proposer: { label: '需求提出人员', icon: '📤' },
  executor: { label: '执行人员', icon: '⚡' },
};

const LEADER_NAMES = ['曾锐', '林宇飞', '毛研勋', '张弛'];

function normalizeDept(dept) {
  if (dept === '管理部门') return '审核人';
  if (dept === '执行团队' || dept === '执行部门') return '执行人';
  return dept || '';
}

const NAV_ITEMS = {
  taskcenter: { id: 'taskcenter', label: '📋 任务中心', caps: ['reviewer'], roles: ['admin', 'manager'] },
  dashboard: { id: 'dashboard', label: '📊 概览', caps: ['reviewer'], roles: ['admin'] },
  demandai: { id: 'demandai', label: '📤 提交需求', caps: ['reviewer'], roles: ['admin', 'manager'] },
  mywork: { id: 'mywork', label: '💼 今日工作台', caps: ['executor'], roles: [] },
  submit: { id: 'submit', label: '📤 提交需求', caps: ['proposer'], roles: [] },
  profile: { id: 'profile', label: '👤 我的', caps: [], roles: [] },
  team: { id: 'team', label: '👥 团队', caps: [], roles: ['admin'] },
};

const SEED_USERS = [
  { emp_id: '666666', name: 'admin', password: 'aiic@2026', role: 'admin', dept: '系统管理', capabilities: ['reviewer', 'proposer', 'executor'], can_manage_users: true },
  { emp_id: '600412', name: '曾锐', password: '600412', role: 'manager', dept: '审核人', capabilities: ['reviewer', 'proposer', 'executor'], can_manage_users: false },
  { emp_id: '600764', name: '张弛', password: '600764', role: 'manager', dept: '审核人', capabilities: ['reviewer', 'proposer', 'executor'], can_manage_users: false },
  { emp_id: '600471', name: '林宇飞', password: '600471', role: 'manager', dept: '审核人', capabilities: ['reviewer', 'proposer', 'executor'], can_manage_users: false },
  { emp_id: '600664', name: '毛研勋', password: '600664', role: 'manager', dept: '审核人', capabilities: ['reviewer', 'proposer', 'executor'], can_manage_users: false },
  { emp_id: '600785', name: '赵立泽', password: '600785', role: 'member', dept: '执行人', capabilities: ['proposer', 'executor'], can_manage_users: false },
  { emp_id: '600831', name: '王诗瑶', password: '600831', role: 'member', dept: '执行人', capabilities: ['proposer', 'executor'], can_manage_users: false },
  { emp_id: '600838', name: '万贤书', password: '600838', role: 'member', dept: '执行人', capabilities: ['proposer', 'executor'], can_manage_users: false },
  { emp_id: '600932', name: '刘紫薇', password: '600932', role: 'member', dept: '执行人', capabilities: ['proposer', 'executor'], can_manage_users: false },
  { emp_id: '601247', name: '王紫薇', password: '601247', role: 'member', dept: '执行人', capabilities: ['proposer', 'executor'], can_manage_users: false },
  { emp_id: '601308', name: '杨会冉', password: '601308', role: 'member', dept: '执行人', capabilities: ['proposer', 'executor'], can_manage_users: false },
  { emp_id: '609107', name: '杨子豪', password: '609107', role: 'member', dept: '执行人', capabilities: ['proposer', 'executor'], can_manage_users: false },
];

const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000;

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getDefaultView(user) {
  if (user.role === 'admin') return 'team';
  const caps = user.capabilities || [];
  if (caps.includes('reviewer')) return 'dashboard';
  if (caps.includes('executor')) return 'mywork';
  if (caps.includes('proposer')) return 'submit';
  return 'profile';
}

function getNavForUser(user) {
  const caps = user.capabilities || [];
  const nav = [];
  const isReviewer = caps.includes('reviewer') || user.role === 'admin';

  if (isReviewer) {
    if (user.role === 'admin') {
      nav.push({ id: 'team', label: '👥 团队管理' });
      nav.push({ id: 'dashboard', label: '📊 全局看板' });
      nav.push({ id: 'profile', label: '👤 我的' });
      nav.push({ id: 'taskcenter', label: '📋 任务中心' });
      nav.push({ id: 'demandai', label: '📤 提交需求' });
      return nav;
    }
    nav.push({ id: 'dashboard', label: '📊 全局看板' });
    nav.push({ id: 'profile', label: '👤 我的' });
    nav.push({ id: 'taskcenter', label: '📋 任务中心' });
    nav.push({ id: 'demandai', label: '📤 提交需求' });
    return nav;
  }

  if (caps.includes('executor')) {
    nav.push({ id: 'mywork', label: '💼 今日工作台' });
    nav.push({ id: 'taskcenter', label: '📋 任务中心' });
    if (caps.includes('proposer')) nav.push({ id: 'submit', label: '📤 提交需求' });
    nav.push({ id: 'profile', label: '👤 我的记录' });
    return nav;
  }

  if (caps.includes('proposer')) nav.push({ id: 'submit', label: '📤 提交需求' });
  nav.push({ id: 'taskcenter', label: '📋 任务中心' });
  nav.push({ id: 'profile', label: '👤 我的' });
  return nav;
}

function getRoleLabel(user) {
  if (user.role === 'admin') return '超级管理员';
  if (LEADER_NAMES.includes(user.name) || (user.role === 'manager' && (user.capabilities || []).includes('reviewer'))) {
    return '领导';
  }
  const caps = (user.capabilities || []).map(c => CAPABILITIES[c]?.label).filter(Boolean);
  return caps.join(' · ') || '成员';
}

function isLeader(user) {
  if (!user) return false;
  return user.role === 'admin' || (user.capabilities || []).includes('reviewer');
}

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return {
    ...safe,
    dept: normalizeDept(safe.dept),
    roleLabel: getRoleLabel(user),
    nav: getNavForUser(user),
    defaultView: getDefaultView(user),
    capabilityLabels: (user.capabilities || []).map(c => CAPABILITIES[c]?.label || c),
  };
}

function login(empId, password, users) {
  const user = users.find(u => u.emp_id === empId && u.active !== false);
  if (!user || user.password !== hashPassword(password)) return null;
  const token = createToken();
  sessions.set(token, { userId: user.id, createdAt: Date.now() });
  const safe = sanitizeUser(user);
  return {
    token,
    user: safe,
    roleConfig: { label: safe.roleLabel, nav: safe.nav, capabilities: user.capabilities, defaultView: safe.defaultView },
  };
}

function logout(token) { sessions.delete(token); }

function getSessionUser(token, users) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) { sessions.delete(token); return null; }
  const user = users.find(u => u.id === session.userId);
  return user ? sanitizeUser(user) : null;
}

function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const capMap = { review: 'reviewer', assign: 'reviewer', acceptance: 'reviewer', submit: 'proposer', execute: 'executor', ai: true, ai_copilot: true, metrics: 'reviewer', all: false };
  if (permission === 'all') return user.role === 'admin';
  const need = capMap[permission];
  if (need === true) return true;
  return (user.capabilities || []).includes(need);
}

function authMiddleware(getUsers) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: '未登录' });
    const user = getSessionUser(token, getUsers());
    if (!user) return res.status(401).json({ error: '会话已过期，请重新登录' });
    req.user = user;
    req.token = token;
    next();
  };
}

function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (req.user.role === 'admin') return next();
    const effective = perms.filter(p => p !== 'all');
    if (effective.length === 0) return res.status(403).json({ error: '权限不足' });
    if (effective.some(p => hasPermission(req.user, p))) return next();
    return res.status(403).json({ error: '权限不足' });
  };
}

module.exports = {
  CAPABILITIES, NAV_ITEMS, SEED_USERS, LEADER_NAMES, normalizeDept, hashPassword, login, logout, getSessionUser,
  hasPermission, authMiddleware, requirePermission, sanitizeUser, getNavForUser, getRoleLabel, getDefaultView, isLeader,
};
