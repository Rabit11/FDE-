const crypto = require('crypto');

const ROLES = {
  admin: {
    label: '超级管理员',
    badge: 'admin',
    nav: [
      { id: 'dashboard', label: '📊 全局仪表盘' },
      { id: 'kanban', label: '📋 流动看板' },
      { id: 'backlog', label: '📝 Backlog' },
      { id: 'sprint', label: '🏃 Sprint' },
      { id: 'review', label: '🔍 审核分配' },
      { id: 'acceptance', label: '✅ 验收中心' },
      { id: 'ai', label: '🤖 AI 指挥中心' },
      { id: 'team', label: '👥 团队管理' },
    ],
    permissions: ['all'],
  },
  manager: {
    label: '管理员',
    badge: 'manager',
    nav: [
      { id: 'dashboard', label: '📊 管理仪表盘' },
      { id: 'kanban', label: '📋 团队看板' },
      { id: 'backlog', label: '📝 Backlog' },
      { id: 'sprint', label: '🏃 Sprint' },
      { id: 'review', label: '🔍 审核分配' },
      { id: 'acceptance', label: '✅ 验收中心' },
      { id: 'ai', label: '🤖 AI 助手' },
    ],
    permissions: ['review', 'assign', 'sprint', 'acceptance', 'ai', 'metrics'],
  },
  executor: {
    label: '执行人员',
    badge: 'executor',
    nav: [
      { id: 'mywork', label: '💼 我的工作台' },
      { id: 'kanban', label: '📋 任务看板' },
      { id: 'submit', label: '📤 提交需求' },
      { id: 'ai', label: '🤖 AI 协作者' },
    ],
    permissions: ['execute', 'submit', 'ai_copilot'],
  },
};

const SEED_USERS = [
  { emp_id: '666666', name: 'admin', password: 'aiic@2026', role: 'admin', dept: '系统管理' },
  { emp_id: '600412', name: '曾锐', password: '600412', role: 'manager', dept: '管理部门' },
  { emp_id: '600764', name: '张弛', password: '600764', role: 'manager', dept: '管理部门' },
  { emp_id: '600471', name: '林宇飞', password: '600471', role: 'manager', dept: '管理部门' },
  { emp_id: '600664', name: '毛研勋', password: '600664', role: 'manager', dept: '管理部门' },
  { emp_id: '600785', name: '赵立泽', password: '600785', role: 'executor', dept: '执行团队' },
  { emp_id: '600831', name: '王诗瑶', password: '600831', role: 'executor', dept: '执行团队' },
  { emp_id: '600838', name: '万贤书', password: '600838', role: 'executor', dept: '执行团队' },
  { emp_id: '600932', name: '刘紫薇', password: '600932', role: 'executor', dept: '执行团队' },
  { emp_id: '601247', name: '王紫薇', password: '601247', role: 'executor', dept: '执行团队' },
  { emp_id: '601308', name: '杨会冉', password: '601308', role: 'executor', dept: '执行团队' },
  { emp_id: '609107', name: '杨子豪', password: '609107', role: 'executor', dept: '执行团队' },
];

const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000;

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return { ...safe, roleLabel: ROLES[user.role]?.label || user.role };
}

function login(empId, password, users) {
  const user = users.find(u => u.emp_id === empId && u.active !== false);
  if (!user || user.password !== hashPassword(password)) return null;
  const token = createToken();
  sessions.set(token, { userId: user.id, createdAt: Date.now() });
  return { token, user: sanitizeUser(user) };
}

function logout(token) {
  sessions.delete(token);
}

function getSessionUser(token, users) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  const user = users.find(u => u.id === session.userId);
  return user ? sanitizeUser(user) : null;
}

function hasPermission(user, permission) {
  if (!user) return false;
  const role = ROLES[user.role];
  if (!role) return false;
  if (role.permissions.includes('all')) return true;
  return role.permissions.includes(permission);
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
    if (hasPermission(req.user, 'all')) return next();
    if (perms.some(p => hasPermission(req.user, p))) return next();
    return res.status(403).json({ error: '权限不足' });
  };
}

module.exports = {
  ROLES, SEED_USERS, hashPassword, login, logout, getSessionUser,
  hasPermission, authMiddleware, requirePermission, sanitizeUser,
};
