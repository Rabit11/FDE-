const llm = require('./llm');
const { queries } = require('../db');

const SYSTEM_PROMPT = `你是 FDE管理平台 首席敏捷教练 & AI 项目管理专家，具备以下能力：
1. 精通 Kanban 流动管理方法论，能给出可执行建议
2. 深度理解团队任务、流动看板（执行中/阻塞/已归档/已终止）、个人技能画像
3. 能进行需求分析、任务拆分、风险评估、人员分配建议
4. 回答基于提供的实时项目数据，不编造不存在的信息
5. 使用 Markdown 格式，结构清晰，给出具体行动项
6. 对复杂问题分步骤推理，引用具体任务名和人员名`;

function buildRagContext(user) {
  const items = queries.getItems();
  const metrics = queries.getMetrics();
  const users = queries.getUsers();
  const recentActivity = queries.getActivity(20);

  const myItems = items.filter(i => i.assignee === user.name);
  const blocked = items.filter(i => i.status === 'blocked');
  const inReview = items.filter(i => i.status === 'review');
  const submitted = items.filter(i => i.status === 'submitted');
  const inProgress = items.filter(i => !['done', 'blocked', 'terminated'].includes(i.status));

  const teamProfiles = users.map(u => ({
    name: u.name,
    capabilities: u.capabilities,
    availability: u.profile?.availability,
    skills: (u.profile?.skills || []).slice(0, 8),
    projects: (u.profile?.project_history || []).slice(0, 3).map(p => p.name),
    workload: items.filter(i => i.assignee === u.name && !['done', 'terminated'].includes(i.status)).length,
  }));

  return {
    current_user: { name: user.name, role: user.roleLabel, capabilities: user.capabilities },
    flow: {
      in_progress: inProgress.length,
      blocked: blocked.length,
      archived: items.filter(i => i.status === 'done').length,
      terminated: items.filter(i => i.status === 'terminated').length,
    },
    metrics: {
      total: items.length,
      done: items.filter(i => i.status === 'done').length,
      blocked: metrics.blocked,
      throughput: metrics.throughput,
      avgLeadTime: metrics.avgLeadTime,
    },
    my_tasks: myItems.slice(0, 15).map(i => ({ title: i.title, status: i.status, sp: i.story_points, type: i.type })),
    blocked_items: blocked.map(i => ({ title: i.title, reason: i.blocked_reason, assignee: i.assignee })),
    pending_review: inReview.map(i => ({ title: i.title, assignee: i.assignee })),
    pending_assign: submitted.slice(0, 10).map(i => ({ title: i.title, creator: i.created_by, desc: (i.description || '').slice(0, 100) })),
    team: teamProfiles,
    recent_changes: recentActivity.slice(0, 10).map(a => `${a.item_title}: ${a.detail}`),
  };
}

function detectIntent(question) {
  const q = question.toLowerCase();
  if (/拆分|分解|story|epic|需求/.test(q)) return 'split';
  if (/分配|指派|谁来做|执行人|协助/.test(q)) return 'assign';
  if (/风险|阻塞|卡点|延期/.test(q)) return 'risk';
  if (/站会|今日|昨天|进展/.test(q)) return 'standup';
  if (/我的任务|我的工作|待办/.test(q)) return 'mywork';
  if (/团队|负载|谁最忙/.test(q)) return 'team';
  if (/验收|review|归档/.test(q)) return 'acceptance';
  return 'general';
}

function getIntentHint(intent, ctx) {
  const hints = {
    split: '用户想了解需求拆分。请基于敏捷 INVEST 原则给出 Epic→Story→Task 建议。',
    assign: `待分配需求 ${ctx.pending_assign.length} 项。结合团队技能(workload/skills)给出主执行人+协助人建议。`,
    risk: `当前阻塞 ${ctx.metrics.blocked} 项。请分析风险等级并给出 24h 内可执行行动。`,
    standup: `基于 recent_changes 和 my_tasks 生成站会三段式（昨日/今日/阻塞）。`,
    mywork: `用户有 ${ctx.my_tasks.length} 项任务。按优先级排序并建议今日 focus。`,
    team: '分析团队负载均衡，指出过载和空闲人员。',
    acceptance: `待验收 ${ctx.pending_review.length} 项，给出验收优先级建议。`,
    general: `综合项目数据给出专业敏捷管理建议。当前执行中 ${ctx.flow.in_progress} 项，阻塞 ${ctx.flow.blocked} 项，已归档 ${ctx.flow.archived} 项，已终止 ${ctx.flow.terminated} 项。`,
  };
  return hints[intent] || hints.general;
}

async function agentChat(question, user, options = {}) {
  const ctx = buildRagContext(user);
  const intent = detectIntent(question);
  const hint = getIntentHint(intent, ctx);

  const history = (options.history || queries.getChatHistory(user.id))
    .slice(-12)
    .map(h => ({ role: h.role, content: h.content }));

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `【实时项目数据】\n${JSON.stringify(ctx, null, 0)}\n\n【意图】${intent}\n【指引】${hint}` },
    ...history,
    { role: 'user', content: question },
  ];

  const useReasoner = options.deep && process.env.DEEPSEEK_API_KEY;
  const model = useReasoner ? (process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-reasoner') : undefined;

  let answer = await llm.chat(messages, { temperature: 0.5, model });
  let engine = 'llm';

  if (!answer) {
    answer = generateLocalAnswer(question, user, ctx, intent);
    engine = 'local';
  }

  queries.saveChat(user.id, 'user', question);
  queries.saveChat(user.id, 'assistant', answer);

  return { answer, engine, intent, context_summary: { blocked: ctx.metrics.blocked, my_tasks: ctx.my_tasks.length } };
}

function generateLocalAnswer(question, user, ctx, intent) {
  if (intent === 'mywork') {
    return `## 你的任务 (${ctx.my_tasks.length} 项)\n\n${ctx.my_tasks.map(t => `- [${t.status}] **${t.title}** (${t.sp || 0} SP)`).join('\n') || '暂无任务'}`;
  }
  if (intent === 'risk') {
    return `## 风险速览\n\n阻塞: **${ctx.metrics.blocked}** 项\n\n${ctx.blocked_items.map(b => `- ⚠️ ${b.title}: ${b.reason || '未说明'}`).join('\n') || '无阻塞 🎉'}`;
  }
  if (intent === 'team') {
    const sorted = [...ctx.team].sort((a, b) => b.workload - a.workload);
    return `## 团队负载\n\n${sorted.map(t => `- ${t.name}: ${t.workload} 项进行中 · ${t.availability || 'available'} · 技能: ${(t.skills || []).join(', ') || '未填写'}`).join('\n')}`;
  }
  return `你好 ${user.name}！当前执行中 ${ctx.flow.in_progress} 项，阻塞 ${ctx.metrics.blocked} 项，已归档 ${ctx.flow.archived} 项，已终止 ${ctx.flow.terminated} 项。请具体描述你的问题，我会结合项目数据回答。`;
}

module.exports = { agentChat, buildRagContext, detectIntent, SYSTEM_PROMPT };
