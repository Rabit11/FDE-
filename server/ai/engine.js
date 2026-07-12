const { queries } = require('../db');
const llm = require('./llm');
const agent = require('./agent');

const STORY_TEMPLATES = [
  { pattern: /用户|登录|注册|账号/i, stories: ['用户注册与登录', '权限与会话管理', '用户信息维护'] },
  { pattern: /看板|kanban|任务|拖拽/i, stories: ['看板列配置与 WIP 限制', '任务卡片拖拽流转', '看板状态变更通知'] },
  { pattern: /AI|智能|自动/i, stories: ['AI 需求分析与拆分', 'AI 站会摘要生成', 'AI 风险预警与建议'] },
  { pattern: /报表|度量|仪表盘|统计/i, stories: ['核心指标数据采集', '可视化仪表盘', '趋势分析与告警'] },
  { pattern: /验收|测试|demo/i, stories: ['在线验收流程', '反馈收集与任务回流', '验收标准自动核对'] },
  { pattern: /API|接口|后端/i, stories: ['RESTful API 设计', '数据持久化层', 'API 文档与测试'] },
  { pattern: /部署|CI|CD|发布/i, stories: ['CI/CD 流水线配置', '自动化部署', '环境管理与回滚'] },
];

function splitRequirement(text) {
  const stories = [];
  let matched = false;

  for (const tpl of STORY_TEMPLATES) {
    if (tpl.pattern.test(text)) {
      matched = true;
      tpl.stories.forEach((title, i) => {
        stories.push({
          type: 'story',
          title,
          description: `从需求「${text.slice(0, 60)}${text.length > 60 ? '...' : ''}」拆分`,
          story_points: [2, 3, 5, 3, 2][i % 5],
          priority: i + 1,
          acceptance_criteria: `Given ${title}\nWhen 开发完成并部署\nThen 满足 INVEST 原则且可通过验收`,
          ai_generated: true,
        });
      });
      break;
    }
  }

  if (!matched) {
    const sentences = text.split(/[。；;，,\n]/).filter(s => s.trim().length > 4);
    const parts = sentences.length >= 2 ? sentences.slice(0, 5) : [
      `${text.slice(0, 30)} - 核心功能实现`,
      `${text.slice(0, 30)} - 界面与交互`,
      `${text.slice(0, 30)} - 测试与验收`,
    ];
    parts.forEach((part, i) => {
      stories.push({
        type: 'story',
        title: part.trim().slice(0, 80),
        description: `AI 从需求自动拆分 (第 ${i + 1} 部分)`,
        story_points: [3, 5, 2][i % 3],
        priority: i + 1,
        acceptance_criteria: `Given ${part.trim().slice(0, 40)}\nWhen 功能交付\nThen 通过验收测试`,
        ai_generated: true,
      });
    });
  }

  const tasks = stories.flatMap(story => [
    { type: 'task', title: `[开发] ${story.title}`, story_points: 0, parent_title: story.title },
    { type: 'task', title: `[测试] ${story.title}`, story_points: 0, parent_title: story.title },
  ]);

  return {
    epic: {
      type: 'epic',
      title: text.slice(0, 100),
      description: text,
      story_points: stories.reduce((s, x) => s + x.story_points, 0),
      ai_generated: true,
    },
    stories,
    tasks,
    summary: `AI 已将需求拆分为 1 个 Epic、${stories.length} 个用户故事、${tasks.length} 个任务，预估 ${stories.reduce((s, x) => s + x.story_points, 0)} Story Points。`,
  };
}

async function splitRequirementSmart(text) {
  const llmResult = await llm.smartSplitRequirement(text);
  if (llmResult) {
    llmResult.summary = (llmResult.summary || '') + ' [LLM 智能引擎]';
    return llmResult;
  }
  return splitRequirement(text);
}

function buildContext(user) {
  const items = queries.getItems();
  const metrics = queries.getMetrics();
  const users = queries.getUsers();
  const inProgress = items.filter(i => !['done', 'blocked', 'terminated'].includes(i.status)).length;
  return JSON.stringify({ metrics, flow: { in_progress: inProgress, blocked: metrics.blocked, archived: items.filter(i => i.status === 'done').length, terminated: items.filter(i => i.status === 'terminated').length }, items: items.slice(0, 30), team: users.map(u => ({ name: u.name, role: u.role, dept: u.dept })), user }, null, 0);
}

async function copilotChat(question, user, options = {}) {
  const history = queries.getChatHistory(user.id);
  const result = await agent.agentChat(question, user, { history, deep: options.deep });
  return { answer: result.answer, engine: result.engine, intent: result.intent };
}

function generateLocalCopilotAnswer(question, user) {
  const items = user.role === 'executor'
    ? queries.getItems({ assignee: user.name })
    : queries.getItems();
  const mine = items.filter(i => i.assignee === user.name);
  const blocked = items.filter(i => i.status === 'blocked');
  if (/任务|工作|我的/.test(question)) {
    return `## 你的任务概览\n\n当前共有 **${mine.length}** 项任务分配给你：\n${mine.map(i => `- [${i.status}] ${i.title} (${i.story_points || 0} SP)`).join('\n') || '- 暂无分配任务'}`;
  }
  if (/风险|阻塞|卡点/.test(question)) {
    return `## 风险速览\n\n当前阻塞 **${blocked.length}** 项：\n${blocked.map(i => `- ⚠️ ${i.title}: ${i.blocked_reason || '未说明'}`).join('\n') || '- 无阻塞 🎉'}`;
  }
  return `## FDE管理平台 协作者\n\n你好 ${user.name}！我可以帮你：\n- 查看任务和进度\n- 分析风险和阻塞\n- 拆分需求\n- 生成站会摘要\n\n请具体描述你的问题。`;
}

async function suggestAssignee(itemId) {
  const item = queries.getItem(itemId);
  if (!item) return null;
  const executors = queries.getUsers().filter(u => u.role === 'executor');
  const workloads = executors.map(u => ({
    name: u.name,
    count: queries.getItems({ assignee: u.name }).filter(i => !['done', 'terminated'].includes(i.status)).length,
  }));
  const context = `任务: ${item.title}\n描述: ${item.description}\n团队负载: ${JSON.stringify(workloads)}`;
  const llmResult = await llm.smartAnalyze(context, 'assign');
  if (llmResult) {
    try { return JSON.parse(llmResult); } catch { /* fallthrough */ }
  }
  const best = workloads.sort((a, b) => a.count - b.count)[0];
  return { assignee: best?.name || executors[0]?.name, reason: `当前任务负载最低 (${best?.count || 0} 项进行中)` };
}

async function generateStandupSummary(user) {
  const items = queries.getItems();
  const active = items.filter(i => ['in_progress', 'blocked', 'review'].includes(i.status));
  const done = items.filter(i => i.status === 'done');
  const blocked = items.filter(i => i.status === 'blocked');
  const recent = queries.getActivity(30);

  const yesterday = recent.filter(a => a.action === 'status_change').slice(0, 5);
  const today = active.map(i => `• ${i.title} (${i.status}${i.assignee ? ', ' + i.assignee : ''})`).join('\n');
  const blockers = blocked.map(i => `⚠ ${i.title}: ${i.blocked_reason || '未说明原因'}`).join('\n');

  const content = `## AI 站会摘要 · ${new Date().toLocaleDateString('zh-CN')}

### 📊 概览
- 进行中: ${active.length} 项 | 已完成: ${done.length} 项 | 阻塞: ${blocked.length} 项

### ✅ 昨日进展
${yesterday.length ? yesterday.map(a => `• ${a.item_title}: ${a.detail}`).join('\n') : '• 暂无状态变更记录'}

### 🎯 今日计划
${today || '• 暂无进行中任务'}

### 🚧 阻塞与风险
${blockers || '• 当前无阻塞项 🎉'}

### 💡 AI 建议
${blocked.length > 0 ? '• 优先解决阻塞项，建议召开 15 分钟攻关会议' : '• 团队流动顺畅，可适度增加 WIP'}
${active.length > 5 ? '• WIP 过高（' + active.length + '），建议限制在制品数量' : ''}`;

  queries.saveInsight('standup', '每日站会摘要', content, blocked.length > 0 ? 'warning' : 'info');
  const llmContent = await llm.smartAnalyze(content, 'standup');
  if (llmContent) return { content: llmContent, stats: { active: active.length, done: done.length, blocked: blocked.length }, engine: 'llm' };
  return { content, stats: { active: active.length, done: done.length, blocked: blocked.length }, engine: 'local' };
}

async function analyzeRisks() {
  const items = queries.getItems();
  const risks = [];
  const now = new Date();

  items.forEach(item => {
    if (item.status === 'blocked') {
      risks.push({ level: 'high', item: item.title, reason: item.blocked_reason || '任务被阻塞', suggestion: '立即分配资源解除阻塞' });
    }
    if (item.status === 'in_progress') {
      const age = (now - new Date(item.updated_at)) / 86400000;
      if (age > 5) {
        risks.push({ level: 'medium', item: item.title, reason: `已 ${Math.round(age)} 天无更新`, suggestion: '检查是否需要拆分或重新分配' });
      }
    }
    if (item.status === 'review' && item.acceptance_status === 'pending') {
      const age = (now - new Date(item.updated_at)) / 86400000;
      if (age > 2) {
        risks.push({ level: 'medium', item: item.title, reason: '验收等待超过 2 天', suggestion: '催促需求方在线验收' });
      }
    }
  });

  const content = risks.length
    ? risks.map(r => `[${r.level.toUpperCase()}] ${r.item}\n  原因: ${r.reason}\n  建议: ${r.suggestion}`).join('\n\n')
    : '当前无显著风险，团队运行健康。';

  queries.saveInsight('risk', '风险分析报告', content, risks.some(r => r.level === 'high') ? 'danger' : risks.length ? 'warning' : 'info');
  const llmContent = await llm.smartAnalyze(content, 'risks');
  if (llmContent) return { risks, content: llmContent, count: risks.length, engine: 'llm' };
  return { risks, content, count: risks.length, engine: 'local' };
}

async function generateReviewReport() {
  const metrics = queries.getMetrics();
  const activity = queries.getActivity(100);
  const statusChanges = activity.filter(a => a.action === 'status_change');
  const items = queries.getItems();
  const inProgress = items.filter(i => !['done', 'blocked', 'terminated'].includes(i.status)).length;
  const archived = items.filter(i => i.status === 'done').length;
  const terminated = items.filter(i => i.status === 'terminated').length;

  const content = `## 项目回顾 · AI 洞察报告

### 📈 数据回顾
- 执行中: ${inProgress} 项 | 已归档: ${archived} 项 | 已终止: ${terminated} 项
- 近 14 天吞吐量: ${metrics.throughput} 项
- 平均 Lead Time: ${metrics.avgLeadTime} 天
- 当前阻塞: ${metrics.blocked} 项

### 🟢 做得好的
${metrics.throughput >= 3 ? '• 交付节奏稳定，吞吐量达标' : '• 团队积极投入项目'}
${metrics.blocked === 0 ? '• 无阻塞项，流动顺畅' : ''}

### 🔴 需改进的
${metrics.blocked > 0 ? `• 存在 ${metrics.blocked} 个阻塞项，需建立阻塞升级机制` : ''}
${metrics.avgLeadTime > 7 ? `• Lead Time 偏高 (${metrics.avgLeadTime}天)，建议减小批量` : ''}
${statusChanges.length < 5 ? '• 状态更新频率偏低，建议每日站会同步' : ''}

### 🎯 下一步行动项
1. ${metrics.blocked > 0 ? '建立阻塞 24h 升级 SLA' : '保持当前流动效率'}
2. 每个 Story 拆分为 ≤3 天可完成的小任务
3. 验收反馈 48h 内必须回流到执行中`;

  queries.saveInsight('review', '项目回顾报告', content, 'info');
  const llmContent = await llm.smartAnalyze(content, 'retro');
  if (llmContent) return { content: llmContent, engine: 'llm' };
  return { content, engine: 'local' };
}

module.exports = { splitRequirement, splitRequirementSmart, generateStandupSummary, analyzeRisks, generateReviewReport, copilotChat, suggestAssignee, buildContext };
