import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, signToken, projectScope, canExport, canApply, canEditProject, canManageUsers, ROLES, normalizeRole } from './middleware/auth.js';
import { CHANNEL_FLOWS, getChannelFlow } from './channelFlows.js';
import { getApprovalFlow, APPROVAL_RULES, listApprovalFlows } from './approvalFlows.js';
import {
  buildApprovalState,
  canUserApproveStep,
  inUserInbox,
  isSubmitter,
  parsePayload,
} from './approvalService.js';
import { buildChannelFlowPayload, aggregateStepCounts, resolveFlowStep } from './flowUtils.js';
import { LIFECYCLE_FRAMEWORK } from './lifecycleFramework.js';
import { seedDatabase, syncDemoUsers } from './seed.js';
import {
  pickProjectFields,
  validateProjectUpload,
  generateProjectCode,
  generateOutcomeCode,
  calcPartnerLevel,
  calcPlanRisk,
} from './projectUpload.js';
import {
  buildBoardAnalytics,
  buildBoardFilters,
  filterProjects,
  canAccessBoard,
} from './boardAnalytics.js';
import {
  buildProjectFieldChart,
  buildPersonnelFieldChart,
  derivePersonnelFromProjects,
} from './charts.js';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'keyan-platform' }));

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const { password: _, ...safe } = user;
  res.json({ token: signToken(safe), user: { ...safe, role: normalizeRole(user.role) } });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

app.get('/api/meta/roles', authMiddleware, (_req, res) => {
  res.json(Object.values(ROLES));
});

app.get('/api/channels', authMiddleware, async (_req, res) => {
  const dbChannels = await prisma.channel.findMany({ orderBy: [{ level: 'asc' }, { name: 'asc' }] });
  const allProjects = await prisma.project.findMany({
    select: {
      id: true, code: true, name: true, channelId: true, flowStep: true, phase: true, status: true, risk: true, org: true,
    },
  });
  const items = dbChannels.map((ch) => {
    const def = getChannelFlow(ch.id);
    const steps = def?.steps || (ch.flow ? ch.flow.split('→') : []);
    const channelProjects = allProjects.filter((p) => p.channelId === ch.id);
    const stepCounts = aggregateStepCounts(channelProjects, steps);
    const projectsByStep = steps.map((_, i) =>
      channelProjects
        .filter((p) => resolveFlowStep(p, steps) === i)
        .map((p) => ({ id: p.id, code: p.code, name: p.name, risk: p.risk, org: p.org })),
    );
    const avgProgress = channelProjects.length
      ? Math.round(
          channelProjects.reduce((s, p) => {
            const idx = resolveFlowStep(p, steps);
            return s + ((idx + 0.5) / Math.max(steps.length, 1)) * 100;
          }, 0) / channelProjects.length,
        )
      : 0;
    return {
      ...ch,
      steps,
      stepCounts,
      projectsByStep,
      projectTotal: channelProjects.length,
      avgProgress,
      dept: def?.dept || ch.dept,
      approvalFlow: getApprovalFlow(ch.id),
    };
  });
  res.json(items);
});

app.get('/api/channels/:id/flow', authMiddleware, (req, res) => {
  const def = getChannelFlow(req.params.id);
  if (!def) return res.status(404).json({ error: '渠道不存在' });
  res.json(def);
});

app.get('/api/channel-flows', authMiddleware, (_req, res) => {
  res.json(CHANNEL_FLOWS);
});

app.get('/api/approval-flows', authMiddleware, (_req, res) => {
  res.json({ rules: APPROVAL_RULES, flows: listApprovalFlows() });
});

app.get('/api/approval-flows/:channelId', authMiddleware, (req, res) => {
  const flow = getApprovalFlow(req.params.channelId);
  res.json({ channelId: req.params.channelId, ...flow, rules: APPROVAL_RULES });
});

app.get('/api/applications', authMiddleware, async (req, res) => {
  const { status, mine } = req.query;
  const where = {};
  if (status) where.status = status;
  if (mine === '1' || mine === 'true') where.applicant = req.user.name;
  const apps = await prisma.application.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: { records: { orderBy: { createdAt: 'asc' } }, _count: { select: { files: true } } },
  });
  const items = apps.map((app) => {
    const flowDef = getApprovalFlow(app.channelId);
    const payload = parsePayload(app);
    const approval = buildApprovalState(app, flowDef);
    const canApprove = app.status === 'pending' && canUserApproveStep(req.user, flowDef.steps[app.currentStep], app, payload);
    return {
      ...app,
      payload,
      approval,
      canApprove,
      canRevoke: isSubmitter(req.user, app) && ['pending', 'submitted', 'rejected'].includes(app.status),
    };
  });
  res.json({ items });
});

app.get('/api/approvals/inbox', authMiddleware, async (req, res) => {
  const apps = await prisma.application.findMany({
    where: { status: { in: ['pending', 'draft', 'rejected', 'archived'] } },
    orderBy: { updatedAt: 'desc' },
    include: { records: { orderBy: { createdAt: 'asc' } }, _count: { select: { files: true } } },
  });
  const items = apps
    .map((app) => {
      const flowDef = getApprovalFlow(app.channelId);
      const payload = parsePayload(app);
      const approval = buildApprovalState(app, flowDef);
      const canApprove = app.status === 'pending' && canUserApproveStep(req.user, flowDef.steps[app.currentStep], app, payload);
      const isMine = isSubmitter(req.user, app);
      return {
        id: app.id,
        channelId: app.channelId,
        channelName: app.channelName,
        org: app.org,
        applicant: app.applicant,
        status: app.status,
        rejectReason: app.rejectReason,
        projectCode: app.projectCode || payload.code,
        name: payload.name || app.channelName,
        updatedAt: app.updatedAt,
        fileCount: app._count.files,
        approval,
        canApprove,
        isMine,
        canRevoke: isMine && ['pending', 'rejected'].includes(app.status),
        canEdit: isMine && ['draft', 'rejected'].includes(app.status),
      };
    })
    .filter((item) => {
      const flowDef = getApprovalFlow(item.channelId);
      const app = apps.find((a) => a.id === item.id);
      return inUserInbox(req.user, app, flowDef);
    });
  res.json({
    items,
    pendingCount: items.filter((i) => i.canApprove).length,
    rules: APPROVAL_RULES,
  });
});

app.get('/api/applications/:id', authMiddleware, async (req, res) => {
  const app = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: { records: { orderBy: { createdAt: 'asc' } }, files: true },
  });
  if (!app) return res.status(404).json({ error: '申报不存在' });
  const flowDef = getApprovalFlow(app.channelId);
  const payload = parsePayload(app);
  const approval = buildApprovalState(app, flowDef);
  res.json({
    ...app,
    payload,
    approval,
    canApprove: app.status === 'pending' && canUserApproveStep(req.user, flowDef.steps[app.currentStep], app, payload),
    canRevoke: isSubmitter(req.user, app) && ['pending', 'submitted', 'rejected'].includes(app.status),
    canEdit: isSubmitter(req.user, app) && ['draft', 'rejected'].includes(app.status),
  });
});

async function recordApproval(appId, step, user, action, comment) {
  return prisma.approvalRecord.create({
    data: {
      applicationId: appId,
      stepIndex: step?.index ?? 0,
      stepName: step?.label || step?.stepName || '—',
      actorRole: normalizeRole(user.role),
      actorName: user.name,
      action,
      comment: comment || null,
    },
  });
}

app.post('/api/applications/:id/submit', authMiddleware, async (req, res) => {
  const app = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!app) return res.status(404).json({ error: '申报不存在' });
  if (!isSubmitter(req.user, app)) return res.status(403).json({ error: '仅填报人可提交' });
  if (!['draft', 'rejected'].includes(app.status)) return res.status(400).json({ error: '当前状态不可提交' });
  const flowDef = getApprovalFlow(app.channelId);
  const steps = flowDef.steps;
  let startStep = steps.findIndex((s) => s.key !== 'contact');
  if (startStep < 0) startStep = 0;
  const updated = await prisma.application.update({
    where: { id: app.id },
    data: { status: 'pending', currentStep: startStep, rejectReason: null },
  });
  await recordApproval(app.id, { index: 0, label: '提交申报' }, req.user, 'submit', '提交审签');
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '立项审签提交', detail: `${app.channelName} · ${parsePayload(app).name || ''}`, source: 'human' },
  });
  res.json({ ...updated, approval: buildApprovalState(updated, flowDef) });
});

app.post('/api/applications/:id/approve', authMiddleware, async (req, res) => {
  const app = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!app) return res.status(404).json({ error: '申报不存在' });
  if (app.status !== 'pending') return res.status(400).json({ error: '非待审状态' });
  const flowDef = getApprovalFlow(app.channelId);
  const steps = flowDef.steps;
  const step = steps[app.currentStep];
  const payload = parsePayload(app);
  if (!canUserApproveStep(req.user, step, app, payload)) {
    return res.status(403).json({ error: `当前节点需由【${step?.label}】角色审批` });
  }
  const comment = req.body?.comment || '';
  const nextStep = app.currentStep + 1;
  const isLast = nextStep >= steps.length || steps[nextStep]?.role === 'offline';
  let status = 'pending';
  if (isLast) {
    status = flowDef.type === 'filing' ? 'archived' : 'approved';
  }
  const updated = await prisma.application.update({
    where: { id: app.id },
    data: {
      status,
      currentStep: isLast ? app.currentStep : nextStep,
      projectCode: payload.code || app.projectCode,
    },
  });
  await recordApproval(app.id, { index: app.currentStep, label: step.label }, req.user, 'approve', comment);
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '审签通过', detail: `${step.label} → ${isLast ? status : steps[nextStep]?.label}`, source: 'human' },
  });
  res.json({ ...updated, approval: buildApprovalState(updated, flowDef) });
});

app.post('/api/applications/:id/reject', authMiddleware, async (req, res) => {
  const { comment } = req.body || {};
  if (!comment?.trim()) return res.status(400).json({ error: '请填写驳回意见' });
  const app = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!app || app.status !== 'pending') return res.status(400).json({ error: '无法驳回' });
  const flowDef = getApprovalFlow(app.channelId);
  const step = flowDef.steps[app.currentStep];
  const payload = parsePayload(app);
  if (!canUserApproveStep(req.user, step, app, payload)) return res.status(403).json({ error: '无权驳回' });
  const updated = await prisma.application.update({
    where: { id: app.id },
    data: { status: 'rejected', currentStep: 0, rejectReason: comment.trim() },
  });
  await recordApproval(app.id, { index: app.currentStep, label: step.label }, req.user, 'reject', comment.trim());
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '审签驳回', detail: comment.trim(), source: 'human' },
  });
  res.json({ ...updated, approval: buildApprovalState(updated, flowDef) });
});

app.post('/api/applications/:id/revoke', authMiddleware, async (req, res) => {
  const app = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!app) return res.status(404).json({ error: '申报不存在' });
  if (!isSubmitter(req.user, app)) return res.status(403).json({ error: '仅填报人可撤销' });
  const flowDef = getApprovalFlow(app.channelId);
  const updated = await prisma.application.update({
    where: { id: app.id },
    data: { status: 'draft', currentStep: 0, revokedAt: new Date(), rejectReason: null },
  });
  await recordApproval(app.id, { index: app.currentStep, label: '撤销' }, req.user, 'revoke', req.body?.comment || '填报人撤销');
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '审签撤销', detail: '回归草稿状态', source: 'human' },
  });
  res.json({ ...updated, approval: buildApprovalState(updated, flowDef) });
});

app.get('/api/lifecycle/framework', authMiddleware, (_req, res) => {
  res.json(LIFECYCLE_FRAMEWORK);
});

app.get('/api/board', authMiddleware, async (req, res) => {
  const role = normalizeRole(req.user.role);
  if (!canAccessBoard(role)) {
    return res.status(403).json({ error: '当前角色无权查看可视化看板' });
  }
  const scope = projectScope(req.user);
  const allProjects = await prisma.project.findMany({
    where: role === 'finance' ? {} : scope.OR ? { OR: scope.OR } : scope,
    include: {
      milestones: true,
      deliverables: true,
      outcomes: true,
    },
  });
  const filterOptions = buildBoardFilters(allProjects);
  const projects = filterProjects(allProjects, req.query);
  const projectIds = projects.map((p) => p.id);
  const milestones = projects.flatMap((p) => p.milestones);
  const deliverables = projects.flatMap((p) => p.deliverables);
  const outcomes = projects.flatMap((p) => p.outcomes);
  const todos = await prisma.todo.findMany({ where: { status: 'pending', projectId: { in: projectIds } } });

  const analytics = buildBoardAnalytics(projects, { milestones, deliverables, outcomes, todos });
  res.json({
    filters: filterOptions,
    applied: req.query,
    ...analytics,
    note: '看板基于台账底层数据自动运算渲染 · 经费为汇总观察口径',
  });
});

function buildProjectWhere(user, extra = {}) {
  const scope = projectScope(user);
  if (scope.id === '__none__') return { id: '__none__', ...extra };
  const parts = scope.OR ? [{ OR: scope.OR }] : [scope];
  if (Object.keys(extra).length) parts.push(extra);
  return parts.length === 1 ? parts[0] : { AND: parts };
}

function todoRoleAllowed(todoRoles, userRole) {
  const allowed = String(todoRoles || '')
    .split(',')
    .map((role) => normalizeRole(role.trim()))
    .filter(Boolean);
  return allowed.includes(normalizeRole(userRole));
}

function todoOrgAllowed(todo, user) {
  if (!todo.orgs) return true;
  const role = normalizeRole(user.role);
  if (['mgmt_unit', 'finance'].includes(role)) {
    return Boolean(user.org && todo.orgs.includes(user.org));
  }
  if (role === 'project_team') {
    return Boolean(
      (user.org && todo.orgs.includes(user.org)) ||
      (todo.project?.org && todo.project.org === user.org),
    );
  }
  return true;
}

app.get('/api/projects', authMiddleware, async (req, res) => {
  const { level, channel, risk, phase, search } = req.query;
  const filters = {};
  if (level) filters.level = level;
  if (channel) filters.channelId = channel;
  if (risk) filters.risk = risk;
  if (phase) filters.phase = phase;
  if (search) {
    filters.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
      { org: { contains: search } },
      { owner: { contains: search } },
    ];
  }
  const where = buildProjectWhere(req.user, filters);
  const projects = await prisma.project.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { milestones: true, partners: true, outcomes: true } } },
  });
  res.json({ items: projects, canExport: canExport(req.user.role) });
});

app.get('/api/projects/:id', authMiddleware, async (req, res) => {
  const where = buildProjectWhere(req.user, { id: req.params.id });
  const project = await prisma.project.findFirst({
    where,
    include: {
      milestones: true,
      partners: true,
      outcomes: true,
      deliverables: true,
      files: { orderBy: { relativePath: 'asc' } },
      audits: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!project) return res.status(404).json({ error: '项目不存在或无权查看' });
  const channelDef = getChannelFlow(project.channelId);
  const channelFlow = channelDef ? buildChannelFlowPayload(project, channelDef) : null;
  res.json({
    ...project,
    canEdit: canEditProject(req.user, project),
    channelFlow,
  });
});

app.patch('/api/projects/:id/flow-step', authMiddleware, async (req, res) => {
  const step = Number(req.body?.step);
  if (Number.isNaN(step) || step < 0) return res.status(400).json({ error: '无效的流程节点' });
  const where = buildProjectWhere(req.user, { id: req.params.id });
  const project = await prisma.project.findFirst({ where });
  if (!project) return res.status(404).json({ error: '项目不存在或无权操作' });
  if (!canEditProject(req.user, project)) return res.status(403).json({ error: '无权更新流程节点' });
  const def = getChannelFlow(project.channelId);
  const max = (def?.steps?.length || 1) - 1;
  const flowStep = Math.min(step, max);
  const updated = await prisma.project.update({
    where: { id: project.id },
    data: { flowStep },
  });
  await prisma.auditLog.create({
    data: {
      projectId: project.id,
      actor: req.user.name || req.user.username,
      action: '更新流程节点',
      detail: `节点 ${flowStep + 1}/${max + 1}：${def?.steps?.[flowStep] || ''}`,
    },
  });
  const channelFlow = def ? buildChannelFlowPayload(updated, def) : null;
  res.json({ ...updated, channelFlow });
});

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  const where = buildProjectWhere(req.user);
  const projects = await prisma.project.findMany({ where });
  const stats = {
    total: projects.length,
    byRisk: { red: 0, yellow: 0, blue: 0, green: 0 },
    byLevel: {},
    byPhase: {},
    budgetTotal: 0,
    budgetSpent: 0,
    redProjects: [],
  };
  for (const p of projects) {
    stats.byRisk[p.risk] = (stats.byRisk[p.risk] || 0) + 1;
    stats.byLevel[p.level] = (stats.byLevel[p.level] || 0) + 1;
    stats.byPhase[p.phase] = (stats.byPhase[p.phase] || 0) + 1;
    stats.budgetTotal += p.budgetTotal;
    stats.budgetSpent += p.budgetSpent;
    if (p.risk === 'red') stats.redProjects.push({ id: p.id, name: p.name, org: p.org, owner: p.owner });
  }
  const todos = await prisma.todo.findMany({
    where: { status: 'pending' },
    include: { project: { select: { id: true, name: true, code: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  const filteredTodos = todos.filter((t) => {
    if (!todoRoleAllowed(t.roles, req.user.role)) return false;
    return todoOrgAllowed(t, req.user);
  });

  let charts = null;
  if (['mgmt_hq', 'admin'].includes(req.user.role)) {
    const basePersonnel = await prisma.personnel.findMany({ orderBy: { name: 'asc' } });
    const personnel = derivePersonnelFromProjects(projects, basePersonnel);
    charts = {
      projectByField: buildProjectFieldChart(projects),
      personnelByField: buildPersonnelFieldChart(personnel),
    };
  }

  res.json({ role: req.user.role, stats, todos: filteredTodos, charts });
});

app.get('/api/todos', authMiddleware, async (req, res) => {
  const todos = await prisma.todo.findMany({
    include: { project: { select: { id: true, name: true, code: true, org: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const filtered = todos.filter((t) => {
    if (!todoRoleAllowed(t.roles, req.user.role)) return false;
    return todoOrgAllowed(t, req.user);
  });
  res.json(filtered);
});

app.patch('/api/todos/:id', authMiddleware, async (req, res) => {
  const { status } = req.body;
  const todo = await prisma.todo.update({ where: { id: req.params.id }, data: { status } });
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '待办处理', detail: `${todo.title} → ${status}`, source: 'human' },
  });
  res.json(todo);
});

app.get('/api/partners', authMiddleware, async (req, res) => {
  const where = buildProjectWhere(req.user);
  const projectIds = (await prisma.project.findMany({ where, select: { id: true } })).map((p) => p.id);
  const partners = await prisma.partner.findMany({
    where: { projectId: { in: projectIds } },
    include: { project: { select: { id: true, name: true, code: true, org: true } } },
  });
  res.json(partners);
});

app.get('/api/outcomes', authMiddleware, async (req, res) => {
  const where = buildProjectWhere(req.user);
  const projectIds = (await prisma.project.findMany({ where, select: { id: true } })).map((p) => p.id);
  const outcomes = await prisma.outcome.findMany({
    where: { projectId: { in: projectIds } },
    include: { project: { select: { id: true, name: true, code: true } } },
  });
  res.json(outcomes);
});

app.get('/api/risks', authMiddleware, async (req, res) => {
  const where = buildProjectWhere(req.user, { risk: { in: ['red', 'yellow'] } });
  const projects = await prisma.project.findMany({ where, orderBy: { risk: 'asc' } });
  res.json(projects);
});

app.get('/api/projects/next-code', authMiddleware, async (_req, res) => {
  const code = await generateProjectCode(prisma);
  res.json({ code });
});

async function persistProjectNestedData(projectId, projectCode, body) {
  const year = new Date().getFullYear();
  for (const plan of body.annualPlans || []) {
    if (!plan.yearGoal && !plan.planContent) continue;
    const risk = calcPlanRisk(plan.dueDate, plan.completion);
    await prisma.milestone.create({
      data: {
        projectId,
        year,
        title: plan.planContent || plan.yearGoal || '年度计划',
        yearGoal: plan.yearGoal || null,
        planContent: plan.planContent || null,
        dueDate: plan.dueDate || null,
        completion: plan.completion || null,
        planStatus: { green: '绿', yellow: '黄', blue: '蓝', red: '红' }[risk],
        status: plan.completion || '进行中',
        risk,
      },
    });
  }
  for (const d of body.deliverables || []) {
    if (!d.name) continue;
    const ownership = Array.isArray(d.ownership) ? d.ownership.join('、') : d.ownership;
    await prisma.deliverable.create({
      data: {
        projectId,
        name: d.name,
        type: d.type || '其他',
        status: d.status || '待交付',
        ownership: ownership || null,
        outcomeCode: d.outcomeCode || null,
        risk: d.status === '已交付' ? 'green' : 'blue',
      },
    });
  }
  for (const p of body.partners || []) {
    if (!p.name) continue;
    const level = calcPartnerLevel(p.score);
    await prisma.partner.create({
      data: {
        projectId,
        name: p.name,
        type: p.type || '参研',
        evaluator: p.evaluator || null,
        score: p.score != null ? Number(p.score) : null,
        level: level || p.level || null,
        evalDate: p.evalDate || null,
        evalStatus: p.score != null ? '已评价' : '待评价',
      },
    });
  }
  const deliverableCountByCode = {};
  for (const d of body.deliverables || []) {
    if (d.outcomeCode) deliverableCountByCode[d.outcomeCode] = (deliverableCountByCode[d.outcomeCode] || 0) + 1;
  }
  for (const o of body.outcomes || []) {
    if (!o.name) continue;
    const code = o.code || (await generateOutcomeCode(prisma));
    await prisma.outcome.create({
      data: {
        projectId,
        code,
        name: o.name,
        summary: o.summary || null,
        method: o.method || null,
        form: o.form || null,
        planDate: o.planDate || null,
        actualDate: o.actualDate || null,
        status: o.status || '已启动',
        transformBrief: o.transformBrief || null,
        responsibleUnit: o.responsibleUnit || null,
        deliverableCount: deliverableCountByCode[code] || deliverableCountByCode[o.code] || 0,
      },
    });
  }
}

async function persistFolderFiles({ projectId, applicationId, body, uploadedBy }) {
  const files = body.folderFiles || [];
  if (!files.length) return 0;
  const records = await saveProjectFiles({
    projectId,
    applicationId,
    folderName: body.folderName,
    files,
    uploadedBy,
  });
  for (const r of records) {
    await prisma.projectFile.create({ data: r });
  }
  return records.length;
}

app.post('/api/applications', authMiddleware, async (req, res) => {
  if (!canApply(req.user.role)) return res.status(403).json({ error: '当前角色无权立项申报' });
  const body = req.body?.payload || req.body || {};
  const missing = validateProjectUpload(body);
  if (missing.length) {
    return res.status(400).json({ error: `请填写必填表头：${missing.join('、')}` });
  }
  const channel = await prisma.channel.findUnique({ where: { id: body.channelId } });
  const channelName = req.body.channelName || channel?.name || body.channelName;
  const initDept = channel?.dept || body.initDept;
  const code = body.code?.trim() || (await generateProjectCode(prisma));
  const flowDef = getApprovalFlow(body.channelId);
  const app = await prisma.application.create({
    data: {
      level: body.level,
      channelId: body.channelId,
      channelName,
      org: body.org || req.user.org || '',
      applicant: req.user.name,
      applicantId: req.user.id,
      status: 'draft',
      flowType: flowDef.type,
      currentStep: 0,
      payload: JSON.stringify({ ...body, code, channelName, initDept }),
    },
  });
  const fileCount = await persistFolderFiles({
    applicationId: app.id,
    body,
    uploadedBy: req.user.name,
  });
  await prisma.auditLog.create({
    data: {
      actor: req.user.name,
      action: '立项申报保存',
      detail: `${code} ${body.name}${fileCount ? ` · 附件${fileCount}个` : ''}`,
      source: 'human',
    },
  });
  res.status(201).json({ ...app, code, fileCount, approval: buildApprovalState(app, flowDef) });
});

app.patch('/api/applications/:id', authMiddleware, async (req, res) => {
  const app = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!app) return res.status(404).json({ error: '申报不存在' });
  if (!isSubmitter(req.user, app)) return res.status(403).json({ error: '仅填报人可修改' });
  if (!['draft', 'rejected'].includes(app.status)) return res.status(400).json({ error: '当前状态不可修改' });
  const body = req.body?.payload || req.body || {};
  const channel = await prisma.channel.findUnique({ where: { id: body.channelId || app.channelId } });
  const channelName = body.channelName || channel?.name || app.channelName;
  const code = body.code?.trim() || parsePayload(app).code || app.projectCode;
  const updated = await prisma.application.update({
    where: { id: app.id },
    data: {
      level: body.level || app.level,
      channelId: body.channelId || app.channelId,
      channelName,
      org: body.org || app.org,
      payload: JSON.stringify({ ...parsePayload(app), ...body, code, channelName }),
      rejectReason: null,
    },
  });
  if (req.body?.folderFiles?.length) {
    await persistFolderFiles({
      applicationId: app.id,
      body: req.body,
      uploadedBy: req.user.name,
    });
  }
  const flowDef = getApprovalFlow(updated.channelId);
  res.json({ ...updated, payload: parsePayload(updated), approval: buildApprovalState(updated, flowDef) });
});

app.post('/api/projects/upload', authMiddleware, async (req, res) => {
  if (!canApply(req.user.role) && !canManageUsers(req.user.role)) {
    return res.status(403).json({ error: '当前角色无权上传项目' });
  }
  const body = req.body || {};
  const missing = validateProjectUpload(body);
  if (missing.length) {
    return res.status(400).json({ error: `请填写必填表头：${missing.join('、')}` });
  }
  const code = body.code?.trim() || (await generateProjectCode(prisma));
  const exists = await prisma.project.findUnique({ where: { code } });
  if (exists) return res.status(409).json({ error: '项目编号已存在' });

  const channel = await prisma.channel.findUnique({ where: { id: body.channelId } });
  const channelName = channel?.name || body.channelName;
  const initDept = channel?.dept || body.initDept;
  const id = `p_${Date.now()}`;
  const data = pickProjectFields(body, channelName, initDept, code);

  const project = await prisma.project.create({ data: { id, ...data } });
  await persistProjectNestedData(id, code, body);
  const fileCount = await persistFolderFiles({ projectId: id, body, uploadedBy: req.user.name });

  await prisma.auditLog.create({
    data: {
      projectId: id,
      actor: req.user.name,
      action: '项目信息上传',
      detail: `${data.code} ${data.name}${fileCount ? ` · 附件${fileCount}个` : ''}`,
      source: 'human',
    },
  });
  res.status(201).json({ ...project, fileCount });
});

app.get('/api/applications/channel-materials/:channelId', authMiddleware, (req, res) => {
  const map = {
    mjky: ['项目指南', '建议书', '可行性研究报告', '单位评审意见'],
    yy3n: ['建议书', '预算书', '单位评审纪要'],
    zdcx: ['建议书', '技术路线说明', '经费预算表'],
    shjb: ['揭榜申请书', '技术方案', '团队资质证明'],
    default: ['申报书', '预算书', '佐证材料'],
  };
  res.json({ materials: map[req.params.channelId] || map.default });
});

app.post('/api/ai/extract', authMiddleware, (req, res) => {
  const { text } = req.body || {};
  res.json({
    extracted: {
      code: `KY-${new Date().getFullYear()}-NEW`,
      name: '基于材料自动识别的项目名称（演示）',
      goal: '从上传材料中抽取的项目目标摘要',
      mainWork: '主要工作内容摘要（演示）',
      budgetTotal: 1200,
      budgetSpent: 0,
      budgetYear: 400,
      budgetYearSpent: 0,
      startDate: '2025-01-01',
      endDate: '2027-12-31',
      org: req.user.org,
      owner: req.user.name,
      techOwner: '',
      pmName: '',
      chiefL1: '张总师',
      chiefL2: '王总师',
      status: '进行中',
      outcomeStatus: '技术储备待应用',
      risk: 'green',
      deliverables: [{ name: '专利2项', type: '专利', status: '待交付', ownership: '牵头单位', outcomeCode: '' }],
    },
    source: text ? '材料解析' : '模拟抽取',
    note: 'AI 仅提议不执行，请人工核对后提交',
  });
});

app.post('/api/ai/chat', authMiddleware, async (req, res) => {
  const { question } = req.body || {};
  const where = buildProjectWhere(req.user);
  const projects = await prisma.project.findMany({ where });
  const red = projects.filter((p) => p.risk === 'red');
  const yellow = projects.filter((p) => p.risk === 'yellow');
  let answer = '暂无匹配数据。';
  const q = (question || '').toLowerCase();
  if (q.includes('红') || q.includes('逾期') || q.includes('超期')) {
    answer = red.length
      ? `当前有 ${red.length} 个红色预警项目：${red.map((p) => p.name).join('；')}。依据：全局四色规则，节点超期未完成。`
      : '当前范围内无红色预警项目。';
  } else if (q.includes('黄') || q.includes('临期')) {
    answer = yellow.length
      ? `临期项目 ${yellow.length} 个：${yellow.map((p) => p.name).join('；')}。依据：距到期≤30天。`
      : '当前范围内无黄色临期项目。';
  } else if (q.includes('经费') || q.includes('预算')) {
    const total = projects.reduce((s, p) => s + p.budgetTotal, 0);
    const spent = projects.reduce((s, p) => s + p.budgetSpent, 0);
    answer = `范围内项目总经费 ${total.toFixed(0)} 万元，已支出 ${spent.toFixed(0)} 万元，执行率 ${total ? ((spent / total) * 100).toFixed(1) : 0}%。依据：项目台账经费汇总观察口径（两套经费体系独立存储）。`;
  } else {
    answer = `在管项目 ${projects.length} 个。可询问：红色预警、临期项目、经费执行等情况。`;
  }
  res.json({ answer, citations: ['项目台账', '四色预警规则 V18', '经费汇总观察口径'] });
});

function adminOnly(req, res, next) {
  if (!canManageUsers(req.user.role)) {
    return res.status(403).json({ error: '仅超级管理员可操作' });
  }
  next();
}

function omitPassword(user) {
  const { password: _, ...safe } = user;
  return safe;
}

app.get('/api/admin/users', authMiddleware, adminOnly, async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: [{ role: 'asc' }, { username: 'asc' }] });
  res.json(users.map(omitPassword));
});

app.post('/api/admin/users', authMiddleware, adminOnly, async (req, res) => {
  const { username, password, name, role, org, title, teamRole } = req.body || {};
  if (!username?.trim() || !password || !name?.trim() || !role) {
    return res.status(400).json({ error: '用户名、密码、姓名、角色为必填' });
  }
  if (!ROLES[normalizeRole(role)]) {
    return res.status(400).json({ error: '无效角色' });
  }
  const exists = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (exists) return res.status(409).json({ error: '用户名已存在' });
  const user = await prisma.user.create({
    data: {
      username: username.trim(),
      password: await bcrypt.hash(password, 10),
      name: name.trim(),
      role: normalizeRole(role),
      org: org || null,
      title: title || null,
      teamRole: teamRole || null,
    },
  });
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '创建账号', detail: `${user.username} (${user.role})`, source: 'human' },
  });
  res.status(201).json(omitPassword(user));
});

app.put('/api/admin/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const { password, name, role, org, title, teamRole } = req.body || {};
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: '用户不存在' });
  const data = {};
  if (name?.trim()) data.name = name.trim();
  if (role) data.role = normalizeRole(role);
  if (org !== undefined) data.org = org || null;
  if (title !== undefined) data.title = title || null;
  if (teamRole !== undefined) data.teamRole = teamRole || null;
  if (password) data.password = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({ where: { id: req.params.id }, data });
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '更新账号', detail: `${user.username}`, source: 'human' },
  });
  res.json(omitPassword(user));
});

app.delete('/api/admin/users/:id', authMiddleware, adminOnly, async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: '不能删除当前登录账号' });
  }
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: '用户不存在' });
  await prisma.user.delete({ where: { id: req.params.id } });
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '删除账号', detail: `${existing.username}`, source: 'human' },
  });
  res.json({ ok: true });
});

app.post('/api/admin/sync-demo-users', authMiddleware, adminOnly, async (req, res) => {
  const count = await syncDemoUsers();
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '同步演示账号', detail: `${count} 个账号`, source: 'human' },
  });
  res.json({ ok: true, count, message: `已同步 ${count} 个演示账号，密码 Keyan@2026` });
});

app.get('/api/admin/personnel', authMiddleware, adminOnly, async (_req, res) => {
  const items = await prisma.personnel.findMany({ orderBy: { name: 'asc' } });
  res.json(items);
});

app.post('/api/admin/personnel', authMiddleware, adminOnly, async (req, res) => {
  const { name, specialty, org } = req.body || {};
  if (!name?.trim() || !specialty?.trim()) {
    return res.status(400).json({ error: '姓名和专业为必填' });
  }
  const item = await prisma.personnel.create({
    data: { name: name.trim(), specialty: specialty.trim(), org: org?.trim() || null },
  });
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '新增人员', detail: item.name, source: 'human' },
  });
  res.status(201).json(item);
});

app.put('/api/admin/personnel/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, specialty, org } = req.body || {};
  const existing = await prisma.personnel.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: '人员不存在' });
  const data = {};
  if (name?.trim()) data.name = name.trim();
  if (specialty?.trim()) data.specialty = specialty.trim();
  if (org !== undefined) data.org = org?.trim() || null;
  const item = await prisma.personnel.update({ where: { id: req.params.id }, data });
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '更新人员', detail: item.name, source: 'human' },
  });
  res.json(item);
});

app.delete('/api/admin/personnel/:id', authMiddleware, adminOnly, async (req, res) => {
  const existing = await prisma.personnel.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: '人员不存在' });
  await prisma.personnel.delete({ where: { id: req.params.id } });
  await prisma.auditLog.create({
    data: { actor: req.user.name, action: '删除人员', detail: existing.name, source: 'human' },
  });
  res.json({ ok: true });
});

app.get('/api/audit', authMiddleware, async (req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  res.json(logs);
});

async function start() {
  if (process.env.SEED_ON_START === 'true') {
    await seedDatabase();
  }
  app.listen(PORT, () => console.log(`[keyan-api] listening on ${PORT}`));
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
