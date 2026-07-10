const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { queries } = require('./db');
const ai = require('./ai/engine');
const llm = require('./ai/llm');
const { ROLES, login, logout, authMiddleware, requirePermission } = require('./auth');

// Load .env if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  });
}

const app = express();
const PORT = process.env.PORT || 3456;
const auth = authMiddleware(() => queries.getUsersRaw());

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Public Auth ──
app.get('/api/auth/roles', (req, res) => {
  res.json(Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, { label: v.label, badge: v.badge }])));
});

app.post('/api/auth/login', (req, res) => {
  const { emp_id, password } = req.body;
  if (!emp_id || !password) return res.status(400).json({ error: '请输入工号和密码' });
  const result = login(emp_id, password, queries.getUsersRaw());
  if (!result) return res.status(401).json({ error: '工号或密码错误' });
  res.json({ ...result, roleConfig: ROLES[result.user.role] });
});

app.post('/api/auth/logout', auth, (req, res) => {
  logout(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: req.user, roleConfig: ROLES[req.user.role], llmEnabled: llm.isConfigured() });
});

// ── Protected API ──
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  auth(req, res, next);
});

// ── Users / Team ──
app.get('/api/users', (req, res) => res.json(queries.getUsers()));
app.get('/api/users/executors', (req, res) => {
  res.json(queries.getUsers().filter(u => u.role === 'executor'));
});

// ── Sprints ──
app.get('/api/sprints', (req, res) => res.json(queries.getSprints()));
app.post('/api/sprints', requirePermission('sprint', 'all'), (req, res) => res.json(queries.createSprint(req.body)));
app.patch('/api/sprints/:id', requirePermission('sprint', 'all'), (req, res) => {
  const sprint = queries.updateSprint(req.params.id, req.body);
  if (!sprint) return res.status(404).json({ error: 'Not found' });
  res.json(sprint);
});

// ── Items ──
app.get('/api/items', (req, res) => {
  const filters = { ...req.query };
  if (filters.status_in) filters.status_in = filters.status_in.split(',');
  if (req.user.role === 'executor' && req.query.mine === 'true') {
    filters.assignee = req.user.name;
  }
  res.json(queries.getItems(filters));
});

app.get('/api/items/:id', (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.post('/api/items', (req, res) => {
  const body = { ...req.body, actor: req.user.name, created_by: req.user.name };
  if (req.user.role === 'executor') {
    body.status = 'submitted';
    body.type = body.type || 'story';
  }
  res.json(queries.createItem(body));
});

app.patch('/api/items/:id', (req, res) => {
  const body = { ...req.body, actor: req.user.name };
  const item = queries.updateItem(req.params.id, body);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.delete('/api/items/:id', requirePermission('all'), (req, res) => {
  queries.deleteItem(req.params.id);
  res.json({ ok: true });
});

// ── Review & Assign ──
app.post('/api/items/:id/review', requirePermission('review', 'all'), async (req, res) => {
  const { action, assignee, comment } = req.body;
  const updates = { actor: req.user.name };
  if (action === 'approve') {
    updates.status = 'todo';
    if (assignee) updates.assignee = assignee;
  } else if (action === 'reject') {
    updates.status = 'backlog';
    updates.acceptance_feedback = comment;
  }
  const item = queries.updateItem(req.params.id, updates);
  res.json(item);
});

app.post('/api/items/:id/suggest-assignee', requirePermission('assign', 'all'), async (req, res) => {
  const suggestion = await ai.suggestAssignee(req.params.id);
  res.json(suggestion || { error: '无法推荐' });
});

// ── Acceptance ──
app.post('/api/items/:id/accept', requirePermission('acceptance', 'all'), (req, res) => {
  const { status, feedback } = req.body;
  const item = queries.updateItem(req.params.id, {
    acceptance_status: status,
    acceptance_feedback: feedback,
    status: status === 'accepted' ? 'done' : 'in_progress',
    actor: req.user.name,
  });
  if (status === 'rejected' && feedback) {
    queries.createItem({
      type: 'story', title: `[返工] ${item.title}`, description: feedback,
      priority: 1, sprint_id: item.sprint_id, parent_id: item.id, created_by: req.user.name,
    });
  }
  res.json(item);
});

// ── Activity & Metrics ──
app.get('/api/activity', (req, res) => res.json(queries.getActivity(Number(req.query.limit) || 50)));
app.get('/api/metrics', (req, res) => res.json(queries.getMetrics()));

// ── AI Endpoints ──
app.post('/api/ai/split-requirement', requirePermission('ai', 'ai_copilot', 'all'), async (req, res) => {
  const { text, sprint_id } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: '请提供需求描述' });
  const result = await ai.splitRequirementSmart(text.trim());
  const epic = queries.createItem({ ...result.epic, sprint_id, status: 'backlog', created_by: req.user.name });
  const createdStories = result.stories.map(s => {
    return queries.createItem({ ...s, sprint_id, parent_id: epic.id, status: 'backlog', created_by: req.user.name });
  });
  result.tasks.forEach(t => {
    const parent = createdStories.find(s => s.title === t.parent_title);
    queries.createItem({ type: 'task', title: t.title, parent_id: parent?.id, sprint_id, status: 'backlog', priority: 3, created_by: req.user.name });
  });
  queries.saveInsight('split', 'AI 需求拆分', result.summary, 'info');
  res.json({ ...result, epic, stories: createdStories, engine: result.summary?.includes('LLM') ? 'llm' : 'local' });
});

app.post('/api/ai/standup', async (req, res) => res.json(await ai.generateStandupSummary(req.user)));
app.post('/api/ai/risks', async (req, res) => res.json(await ai.analyzeRisks()));
app.post('/api/ai/retro', async (req, res) => res.json(await ai.generateRetro()));
app.get('/api/ai/insights', (req, res) => res.json(queries.getInsights()));

app.post('/api/ai/copilot', async (req, res) => {
  const { question } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: '请输入问题' });
  res.json(await ai.copilotChat(question.trim(), req.user));
});

app.get('/api/ai/chat-history', (req, res) => {
  res.json(queries.getChatHistory(req.user.id));
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🚀 AI 敏捷管理平台已启动`);
  console.log(`  📍 http://localhost:${PORT}`);
  console.log(`  🤖 LLM 引擎: ${llm.isConfigured() ? '已启用' : '规则模式 (配置 .env 启用 LLM)'}\n`);
});
