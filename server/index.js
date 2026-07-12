require('./env');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { queries } = require('./db');
const ai = require('./ai/engine');
const llm = require('./ai/llm');
const asr = require('./ai/asr');
const voice = require('./ai/voice');
const assigner = require('./ai/assign');
const meeting = require('./ai/meeting');
const { CAPABILITIES, login, logout, authMiddleware, requirePermission, getNavForUser, getDefaultView, getRoleLabel, isLeader } = require('./auth');

async function autoApproveItem(itemId, reviewer, teamSize = 2, actor = 'system') {
  const item = queries.getItem(itemId);
  if (!item || item.status !== 'submitted') return null;
  let assignee = item.assignee;
  let assistants = item.assistants || [];
  if (!assignee) {
    const result = await assigner.intelligentAssign(itemId, teamSize);
    if (!result?.primary) return null;
    assignee = result.primary;
    assistants = result.assistants || [];
  }
  const updated = queries.updateItem(itemId, {
    status: 'in_progress',
    reviewer: reviewer || item.reviewer || actor,
    assignee,
    assistants,
    team_size: item.team_size || teamSize,
    actor,
  });
  queries.logActivity(itemId, 'auto_approved', `自动审核通过并分配给 ${assignee}${assistants.length ? '，协助: ' + assistants.join('、') : ''}`, reviewer || item.reviewer || actor);
  return updated;
}

async function processAllPendingSubmissions(actor = 'system') {
  const pending = queries.getItems({ status: 'submitted' });
  const processed = [];
  for (const item of pending) {
    if (!item.reviewer && !item.assignee) continue;
    const approved = await autoApproveItem(
      item.id,
      item.reviewer || actor,
      item.team_size || 2,
      actor,
    );
    if (approved) processed.push(approved);
  }
  return processed;
}

async function healIncompleteDispatchedItems(actor = 'system') {
  const items = queries.getItems().filter(i =>
    ['story', 'epic', 'task', 'bug'].includes(i.type) &&
    i.status === 'in_progress' &&
    !i.assignee &&
    (i.ai_generated || i.created_by)
  );
  const healed = [];
  for (const item of items) {
    if (item.type === 'task' && item.parent_id) {
      const parent = queries.getItem(item.parent_id);
      if (parent?.assignee) {
        const updated = queries.updateItem(item.id, {
          assignee: parent.assignee,
          assistants: parent.assistants || [],
          reviewer: item.reviewer || parent.reviewer,
          actor,
        });
        if (updated) healed.push(updated);
        continue;
      }
    }
    const reviewer = item.reviewer || item.created_by || actor;
    const result = await assigner.intelligentAssign(item.id, item.team_size || 2);
    if (!result?.primary) continue;
    const updated = queries.updateItem(item.id, {
      assignee: result.primary,
      assistants: result.assistants || [],
      reviewer,
      team_size: item.team_size || 2,
      actor,
    });
    if (updated) {
      queries.logActivity(item.id, 'auto_assigned', `补全执行人 ${result.primary}${(result.assistants || []).length ? '，协助: ' + result.assistants.join('、') : ''}`, actor);
      healed.push(updated);
    }
  }
  queries.getItems().filter(i => i.type === 'task' && !i.assignee && i.parent_id).forEach(task => {
    const parent = queries.getItem(task.parent_id);
    if (!parent?.assignee) return;
    const updated = queries.updateItem(task.id, {
      assignee: parent.assignee,
      assistants: parent.assistants || [],
      reviewer: task.reviewer || parent.reviewer,
      actor,
    });
    if (updated) healed.push(updated);
  });
  return healed;
}

function dispatchMetaForUser(user, extra = {}) {
  const caps = user.capabilities || [];
  const reviewer = extra.reviewer || (caps.includes('reviewer') ? user.name : null);
  return {
    created_by: user.name,
    reviewer,
    generate_req_no: true,
    actor: user.name,
    ...extra,
  };
}

async function createDispatchedItem(data, user) {
  const item = queries.createItem({
    ...data,
    ...dispatchMetaForUser(user, data),
    status: data.status || 'in_progress',
  });
  if (item.assignee || !['story', 'epic'].includes(item.type)) return item;
  const result = await assigner.intelligentAssign(item.id, data.team_size || 2);
  if (!result?.primary) return item;
  return queries.updateItem(item.id, {
    assignee: result.primary,
    assistants: result.assistants || [],
    reviewer: item.reviewer || user.name,
    team_size: data.team_size || 2,
    actor: user.name,
  }) || item;
}

function createChildTask(data, user, parent) {
  return queries.createItem({
    type: 'task',
    priority: 3,
    status: 'in_progress',
    ...data,
    ...dispatchMetaForUser(user, {
      reviewer: parent?.reviewer || ((user.capabilities || []).includes('reviewer') ? user.name : null),
      assignee: parent?.assignee || null,
      assistants: parent?.assistants || [],
      parent_id: parent?.id || data.parent_id,
    }),
  });
}

function checkReviewerAccess(item, user) {
  if (isLeader(user)) return true;
  return item.reviewer === user.name;
}

const app = express();
const PORT = process.env.PORT || 3456;
const auth = authMiddleware(() => queries.getUsersRaw());

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Public Auth ──
app.get('/api/auth/roles', (req, res) => {
  res.json(Object.fromEntries(Object.entries(CAPABILITIES).map(([k, v]) => [k, { label: v.label, icon: v.icon }])));
});

app.post('/api/auth/login', (req, res) => {
  const { emp_id, password } = req.body;
  if (!emp_id || !password) return res.status(400).json({ error: '请输入工号和密码' });
  const result = login(emp_id, password, queries.getUsersRaw());
  if (!result) return res.status(401).json({ error: '工号或密码错误' });
  res.json(result);
});

app.post('/api/auth/logout', auth, (req, res) => {
  logout(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({
    user: req.user,
    roleConfig: {
      label: req.user.roleLabel,
      nav: req.user.nav || getNavForUser(req.user),
      capabilities: req.user.capabilities,
      defaultView: req.user.defaultView || getDefaultView(req.user),
    },
    llmEnabled: llm.isConfigured(),
    ai: llm.getProviderInfo(),
  });
});

// ── Protected API ──
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  auth(req, res, next);
});

// ── Users / Team / Profile ──
app.get('/api/users', (req, res) => res.json(queries.getUsers()));
app.get('/api/users/reviewers/list', (req, res) => {
  res.json(queries.getUsers().filter(u => (u.capabilities || []).includes('reviewer')));
});
app.get('/api/users/executors/list', (req, res) => {
  res.json(queries.getUsers().filter(u =>
    (u.capabilities || []).includes('executor') && !(u.capabilities || []).includes('reviewer')
  ));
});
app.get('/api/users/:id', (req, res) => {
  const user = queries.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (req.params.id !== req.user.id && !req.user.can_view_profiles && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权查看' });
  }
  const workload = assigner.getWorkload(user.name);
  const tasks = queries.getItems({ assignee: user.name }).filter(i => !['done'].includes(i.status));
  res.json({ ...user, workload, currentTasks: tasks });
});
app.get('/api/users/:id/projects', (req, res) => {
  const user = queries.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (req.params.id !== req.user.id && !req.user.can_view_profiles && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权查看' });
  }
  res.json(queries.getUserProjects(user.name));
});
app.get('/api/users/:id/review-projects', (req, res) => {
  const user = queries.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (req.params.id !== req.user.id && !req.user.can_view_profiles && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权查看' });
  }
  res.json(queries.getUserReviewProjects(user.name));
});

app.patch('/api/users/:id/profile', (req, res) => {
  if (req.params.id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '只能编辑自己的主页' });
  }
  const user = queries.updateUserProfile(req.params.id, req.body);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

// ── Items ──
app.get('/api/items', (req, res) => {
  queries.healStuckSubmissions();
  const filters = { ...req.query };
  if (filters.status_in) filters.status_in = filters.status_in.split(',');
  if (req.user.role === 'executor' && req.query.mine === 'true') {
    filters.assignee = req.user.name;
  }
  res.json(queries.getItems(filters));
});

app.get('/api/items/my-work', (req, res) => {
  res.json(queries.getMyWorkItems(req.user.name));
});

app.get('/api/items/:id', (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.post('/api/items', async (req, res) => {
  const body = { ...req.body, actor: req.user.name, created_by: req.user.name };

  // ── 敏捷需求提交流程：直接派发给执行人，审核人仅做记录 ──
  if (body.reviewer && body.assignee) {
    const item = queries.createItem({
      ...body,
      type: body.type || 'story',
      status: 'in_progress',
      generate_req_no: true,
      assistants: body.assistants || [],
      team_size: body.team_size || 1 + (body.assistants?.length || 0),
    });
    queries.logActivity(item.id, 'dispatched', `任务已自动派发给 ${item.assignee}${(item.assistants||[]).length ? '，协助: ' + item.assistants.join('、') : ''}，审核人 ${item.reviewer} 备案`, body.reviewer);
    return res.json(item);
  }

  const isProposer = (req.user.capabilities || []).includes('proposer');
  const isReviewer = (req.user.capabilities || []).includes('reviewer');

  if (body.reviewer || body.assignee) {
    body.status = 'submitted';
    body.type = body.type || 'story';
    body.generate_req_no = true;
    body.assistants = body.assistants || [];
  } else if (isProposer && !isReviewer) {
    body.status = 'submitted';
    body.type = body.type || 'story';
    body.generate_req_no = true;
  } else if (body.status === 'submitted' || req.body.submit_for_review) {
    body.status = 'submitted';
    body.generate_req_no = true;
  }
  let item = queries.createItem(body);
  if (item.status === 'submitted' && (item.reviewer || item.assignee)) {
    const approved = await autoApproveItem(
      item.id,
      item.reviewer || body.reviewer || req.user.name,
      item.team_size || body.team_size || 2,
      req.user.name,
    );
    if (approved) item = approved;
  }
  res.json(item);
});

app.patch('/api/items/:id', (req, res) => {
  const isReviewer = (req.user.capabilities || []).includes('reviewer') || req.user.role === 'admin';
  if (!isReviewer) {
    return res.status(403).json({ error: '执行人员无权改动流动看板，请提交进展后等待审核人员处理' });
  }
  const body = { ...req.body, actor: req.user.name };
  const item = queries.updateItem(req.params.id, body);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.patch('/api/items/:id/priority', (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: '任务不存在' });
  const isAssignee = item.assignee === req.user.name;
  const isAssistant = (item.assistants || []).includes(req.user.name);
  const isReviewer = (req.user.capabilities || []).includes('reviewer') || req.user.role === 'admin';
  if (!isAssignee && !isAssistant && !isReviewer) {
    return res.status(403).json({ error: '无权修改此任务优先级' });
  }
  const priority = Number(req.body.priority);
  if (![1, 2, 3].includes(priority)) {
    return res.status(400).json({ error: '优先级须为 P1(1)、P2(2) 或 P3(3)' });
  }
  const updated = queries.updateItem(req.params.id, { priority, actor: req.user.name });
  const labels = { 1: 'P1 紧急', 2: 'P2 高', 3: 'P3 普通' };
  queries.logActivity(req.params.id, 'priority_changed', `优先级调整为 ${labels[priority]}`, req.user.name);
  res.json(updated);
});

app.delete('/api/items/:id', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅超级管理员可删除任务' });
  }
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: '任务不存在' });
  queries.deleteItem(req.params.id);
  queries.logActivity(req.params.id, 'deleted', `删除任务: ${item.title}`, req.user.name);
  res.json({ ok: true });
});

app.post('/api/items/:id/progress', (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: '任务不存在' });
  const isAssignee = item.assignee === req.user.name;
  const isAssistant = (item.assistants || []).includes(req.user.name);
  if (!isAssignee && !isAssistant && req.user.role !== 'admin') {
    return res.status(403).json({ error: '只能为自己负责的任务提交进展' });
  }
  const { description, blocker_type, blocker_desc } = req.body;
  if (!description?.trim() && (!blocker_type || blocker_type === 'none')) {
    return res.status(400).json({ error: '请填写进展描述或卡点问题' });
  }
  const result = queries.addProgressUpdate(req.params.id, {
    user: req.user.name,
    description: description?.trim() || '',
    blocker_type: blocker_type || 'none',
    blocker_desc: blocker_desc?.trim() || '',
  });
  res.json(result);
});

app.post('/api/review/auto-process', requirePermission('review', 'all'), async (req, res) => {
  const processed = await processAllPendingSubmissions(req.user.name);
  res.json({ processed, count: processed.length });
});

// ── Review & Assign ──
app.post('/api/items/:id/review', requirePermission('review', 'all'), async (req, res) => {
  const { action, assignee, assistants, comment } = req.body;
  const updates = { actor: req.user.name };
  if (action === 'approve') {
    updates.status = 'todo';
    updates.reviewer = req.user.name;
    if (assignee) updates.assignee = assignee;
    if (assistants) updates.assistants = assistants;
  } else if (action === 'reject') {
    updates.status = 'in_progress';
    updates.acceptance_status = 'rejected';
    updates.acceptance_feedback = comment;
  }
  const item = queries.updateItem(req.params.id, updates);
  res.json(item);
});

app.post('/api/items/:id/smart-assign', requirePermission('assign', 'all'), async (req, res) => {
  const teamSize = Number(req.body.team_size) || 2;
  const result = await assigner.intelligentAssign(req.params.id, teamSize);
  if (!result) return res.status(404).json({ error: '任务不存在' });
  res.json(result);
});

app.post('/api/items/:id/confirm-complete', requirePermission('review', 'acceptance', 'all'), (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: '任务不存在' });
  if (!['review', 'in_progress', 'blocked'].includes(item.status)) {
    return res.status(400).json({ error: '仅待验收或进行中的任务可确认完成' });
  }
  const updated = queries.updateItem(req.params.id, {
    status: 'done',
    acceptance_status: 'accepted',
    reviewer: req.user.name,
    actor: req.user.name,
  });
  queries.logActivity(req.params.id, 'confirmed', `审核人 ${req.user.name} 确认完成`, req.user.name);
  res.json(updated);
});

app.post('/api/items/:id/complete', (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: '任务不存在' });
  const isAssignee = item.assignee === req.user.name;
  const isAssistant = (item.assistants || []).includes(req.user.name);
  if (!isAssignee && !isAssistant && req.user.role !== 'admin') {
    return res.status(403).json({ error: '只能完成自己负责的任务' });
  }
  if (!['todo', 'in_progress', 'blocked'].includes(item.status)) {
    return res.status(400).json({ error: '当前状态无法标记完成' });
  }
  const updated = queries.updateItem(req.params.id, {
    status: 'done',
    acceptance_status: 'accepted',
    actor: req.user.name,
  });
  queries.logActivity(req.params.id, 'completed', `${req.user.name} 标记任务完成，已自动归档`, req.user.name);
  res.json(updated);
});

app.post('/api/items/:id/reviewer-reject', requirePermission('review', 'all'), (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: '任务不存在' });
  if (!checkReviewerAccess(item, req.user)) {
    return res.status(403).json({ error: '只能操作指定给您审核的任务' });
  }
  const { comment } = req.body;
  const updated = queries.updateItem(req.params.id, {
    status: 'in_progress',
    acceptance_status: 'rejected',
    acceptance_feedback: comment || '领导驳回',
    actor: req.user.name,
  });
  queries.logActivity(req.params.id, 'reviewer_reject', `审核人 ${req.user.name} 驳回任务: ${comment || '无说明'}`, req.user.name);
  res.json(updated);
});

app.post('/api/items/:id/reviewer-terminate', requirePermission('review', 'all'), (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: '任务不存在' });
  if (!checkReviewerAccess(item, req.user)) {
    return res.status(403).json({ error: '只能操作指定给您审核的任务' });
  }
  if (!['todo', 'in_progress', 'review', 'submitted'].includes(item.status)) {
    return res.status(400).json({ error: '仅执行中的任务可终止' });
  }
  const { comment } = req.body;
  const updated = queries.updateItem(req.params.id, {
    status: 'terminated',
    acceptance_status: 'terminated',
    acceptance_feedback: comment || '领导终止执行',
    actor: req.user.name,
  });
  queries.logActivity(req.params.id, 'reviewer_terminate', `领导 ${req.user.name} 终止执行: ${comment || '无说明'}`, req.user.name);
  res.json(updated);
});

app.post('/api/items/:id/reviewer-reassign', requirePermission('review', 'all'), (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: '任务不存在' });
  if (!checkReviewerAccess(item, req.user)) {
    return res.status(403).json({ error: '无权操作此任务' });
  }
  if (item.status !== 'blocked') {
    return res.status(400).json({ error: '仅阻塞任务可二次分配' });
  }
  const { assignee, assistants, comment } = req.body;
  if (!assignee?.trim()) {
    return res.status(400).json({ error: '请选择主执行人' });
  }
  const updated = queries.updateItem(req.params.id, {
    status: 'in_progress',
    assignee: assignee.trim(),
    assistants: assistants || [],
    blocked_reason: null,
    blocker_type: null,
    actor: req.user.name,
  });
  queries.logActivity(
    req.params.id,
    'reviewer_reassign',
    `领导 ${req.user.name} 二次分配: ${assignee}${(assistants || []).length ? '，协助: ' + assistants.join('、') : ''}${comment ? ' · ' + comment : ''}`,
    req.user.name,
  );
  res.json(updated);
});

app.post('/api/items/:id/reviewer-revoke', requirePermission('review', 'all'), (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: '任务不存在' });
  if (!checkReviewerAccess(item, req.user)) {
    return res.status(403).json({ error: '只能操作指定给您审核的任务' });
  }
  if (!['done', 'terminated'].includes(item.status)) {
    return res.status(400).json({ error: '仅已归档或已终止任务可撤回' });
  }
  const { comment } = req.body;
  const updated = queries.updateItem(req.params.id, {
    status: 'in_progress',
    acceptance_status: 'pending',
    acceptance_feedback: comment || '审核人撤回已完成',
    clear_completed: true,
    actor: req.user.name,
  });
  queries.logActivity(req.params.id, 'reviewer_revoke', `审核人 ${req.user.name} 撤回已完成: ${comment || '无说明'}`, req.user.name);
  res.json(updated);
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
      priority: 1, parent_id: item.id, created_by: req.user.name, status: 'in_progress',
    });
  }
  res.json(item);
});

// ── Activity & Metrics ──
app.get('/api/activity', (req, res) => res.json(queries.getActivity(Number(req.query.limit) || 50)));
app.get('/api/metrics', (req, res) => res.json(queries.getMetrics()));

// ── AI Endpoints ──
app.post('/api/ai/split-requirement', requirePermission('ai', 'ai_copilot', 'all'), async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: '请提供需求描述' });
  const result = await ai.splitRequirementSmart(text.trim());
  const epic = await createDispatchedItem({ ...result.epic, status: 'in_progress' }, req.user);
  const createdStories = [];
  for (const s of result.stories) {
    createdStories.push(await createDispatchedItem({ ...s, parent_id: epic.id, status: 'in_progress' }, req.user));
  }
  for (const t of result.tasks) {
    const parent = createdStories.find(s => s.title === t.parent_title);
    createChildTask({ title: t.title }, req.user, parent);
  }
  queries.saveInsight('split', 'AI 需求拆分', result.summary, 'info');
  res.json({ ...result, epic, stories: createdStories, engine: result.summary?.includes('LLM') ? 'llm' : 'local' });
});

app.post('/api/ai/standup', async (req, res) => res.json(await ai.generateStandupSummary(req.user)));
app.post('/api/ai/risks', async (req, res) => res.json(await ai.analyzeRisks()));
app.post('/api/ai/review-report', async (req, res) => res.json(await ai.generateReviewReport()));
app.get('/api/ai/insights', (req, res) => res.json(queries.getInsights()));

app.post('/api/ai/copilot', async (req, res) => {
  const { question, deep } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: '请输入问题' });
  res.json(await ai.copilotChat(question.trim(), req.user, { deep: !!deep }));
});

app.get('/api/ai/chat-history', (req, res) => {
  res.json(queries.getChatHistory(req.user.id));
});

// ── Voice: 语音上传 → 转写 → 分析 → 拆任务 ──
const upload = multer({
  dest: path.join(__dirname, '..', 'data', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp3|wav|m4a|webm|ogg|aac|flac|mp4)$/i;
    cb(null, allowed.test(file.originalname) || file.mimetype.startsWith('audio/'));
  },
});

const uploadDoc = multer({
  dest: path.join(__dirname, '..', 'data', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(txt|md|markdown|docx|pdf|csv)$/i;
    cb(null, allowed.test(file.originalname) || file.mimetype.startsWith('text/') || file.mimetype === 'application/pdf');
  },
});

const tempAudioFiles = new Map();

app.get('/api/ai/temp-audio/:token', (req, res) => {
  const info = tempAudioFiles.get(req.params.token);
  if (!info || Date.now() > info.expires) return res.status(404).send('Not found');
  res.sendFile(info.path);
});

app.get('/api/ai/meeting/records', (req, res) => {
  const docs = queries.getVoiceDocs(50).filter(d => !d.user_id || d.user_id === req.user.id);
  res.json(docs);
});

app.post('/api/ai/meeting/save-text', async (req, res) => {
  const { text, title } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: '请输入会议记录内容' });
  try {
    const doc = await meeting.saveTextRecord(text.trim(), req.user, queries, title);
    res.json({ doc, message: '会议记录已保存' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/meeting/upload-audio', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传语音文件' });
  try {
    const doc = await meeting.transcribeAndSave(req.file.path, req.file.originalname, req.file.mimetype, req.user, queries);
    fs.unlink(req.file.path, () => {});
    res.json({ doc, transcript: doc.transcript, message: '语音已转写并保存为会议记录' });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/meeting/upload-doc', uploadDoc.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文档' });
  try {
    const doc = await meeting.parseDocumentAndSave(req.file.path, req.file.originalname, req.user, queries);
    fs.unlink(req.file.path, () => {});
    res.json({ doc, text: doc.transcript, message: '文档已解析并保存为会议记录' });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/meeting/:id/parse', async (req, res) => {
  try {
    const result = await meeting.parseToRequirement(req.params.id, req.user, queries);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ai/voice/docs', (req, res) => res.json(queries.getVoiceDocs()));
app.get('/api/ai/voice/docs/:id', (req, res) => {
  const doc = queries.getVoiceDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  res.json(doc);
});

app.post('/api/ai/voice/process', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传语音文件' });
  const token = path.basename(req.file.path);
  tempAudioFiles.set(token, { path: req.file.path, expires: Date.now() + 600000 });
  try {
    const result = await voice.processVoiceFile(
      req.file.path, req.file.originalname, req.file.mimetype,
      req.user, queries, { autoCreate: req.body.autoCreate !== 'false' },
    );
    tempAudioFiles.delete(token);
    fs.unlink(req.file.path, () => {});
    res.json(result);
  } catch (err) {
    tempAudioFiles.delete(token);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/document/process', uploadDoc.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传需求文档' });
  try {
    const parsed = await docparse.parseDocument(req.file.path, req.file.originalname);
    fs.unlink(req.file.path, () => {});

    const analysis = await llm.analyzeDocument(parsed, req.user.name);
    const splitResult = analysis || await ai.splitRequirementSmart(parsed.text);
    const data = analysis || splitResult;

    const status = (req.user.capabilities || []).includes('reviewer') ? 'in_progress' : 'submitted';
    let createdItems = { epic: null, stories: [], tasks: [] };

    if (req.body.autoCreate !== 'false') {
      createdItems.epic = await createDispatchedItem({
        ...(data.epic || { type: 'epic', title: req.file.originalname, description: parsed.text.slice(0, 300) }),
        status, ai_generated: 1,
        description: data.document?.slice(0, 500) || parsed.text.slice(0, 500),
      }, req.user);
      for (const s of (data.stories || [])) {
        createdItems.stories.push(await createDispatchedItem({
          ...s, type: 'story', parent_id: createdItems.epic.id, status, ai_generated: 1,
        }, req.user));
      }
      for (const t of (data.tasks || [])) {
        const parent = createdItems.stories.find(s => s.title === t.parent_title);
        createdItems.tasks.push(createChildTask({ title: t.title }, req.user, parent));
      }
    }

    const cfg = llm.getConfig();
    res.json({
      filename: req.file.originalname,
      text: parsed.text,
      meta: parsed.meta,
      document: data?.document || `# 需求文档\n\n${parsed.text}`,
      summary: data?.summary || `已解析 ${parsed.meta.wordCount} 字 · ${parsed.meta.sectionCount} 个章节`,
      stories: data?.stories || splitResult?.stories || [],
      keywords: data?.keywords || [],
      risks: data?.risks || [],
      action_items: data?.action_items || [],
      confidence: data?.confidence,
      analysis_mode: data?.analysis_mode || 'fallback',
      createdItems,
      engines: { llm: cfg?.provider || '本地规则引擎', docparse: `${parsed.meta.ext} · ${parsed.meta.chunkCount} 段分析` },
    });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ai/status', (req, res) => {
  res.json(llm.getProviderInfo());
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, async () => {
  const info = llm.getProviderInfo();
  try {
    const healed = await processAllPendingSubmissions('system');
    if (healed.length) console.log(`  🔄 已自动修复 ${healed.length} 个滞留待分配任务`);
    const incomplete = await healIncompleteDispatchedItems('system');
    if (incomplete.length) console.log(`  🔄 已补全 ${incomplete.length} 个缺失派发信息的历史任务`);
  } catch (e) {
    console.warn('  ⚠️ 启动时自动分配修复失败:', e.message);
  }
  console.log(`\n  🚀 FDE管理平台已启动`);
  console.log(`  📍 http://localhost:${PORT}`);
  console.log(`  🧠 大模型: ${info.llm ? `${info.llm.provider} (${info.llm.model})` : '未配置 (规则模式)'}`);
  console.log(`  🎙️ 语音转写: ${info.asr ? `${info.asr.provider} (${info.asr.model})` : '未配置 DASHSCOPE_API_KEY'}\n`);
});
