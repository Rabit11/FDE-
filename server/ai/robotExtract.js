/**
 * 工作日报抽取：优先 LLM JSON，失败回退本地规则
 */
const llm = require('./llm');
const { extractLocal, refineTaskTitle, extractAssigner, normalizeProjectRef } = require('./localExtract');

const CONFIDENCE_AUTO = 0.7;
/** 匹配分数：≥AUTO 自动挂靠；CANDIDATE~AUTO 出候选确认；<CANDIDATE 视为新建或弱匹配 */
const MATCH_AUTO = 85;
const MATCH_CANDIDATE = 55;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeExtract(raw, today) {
  const base = {
    is_leave: false,
    leave: null,
    trip: null,
    intent: ['report'],
    question_text: null,
    entries: [],
  };
  if (!raw || typeof raw !== 'object') return base;

  const intent = Array.isArray(raw.intent)
    ? raw.intent.filter(i => ['report', 'leave', 'trip', 'question', 'chitchat'].includes(i))
    : base.intent;

  const entries = Array.isArray(raw.entries) ? raw.entries.map(e => {
    const status = ['doing', 'done', 'blocked'].includes(e.status) ? e.status : 'doing';
    const category = ['tech', 'admin', 'other'].includes(e.category) ? e.category : 'other';
    const work_dates = Array.isArray(e.work_dates) && e.work_dates.length
      ? e.work_dates.map(String)
      : [today];
    const confidence = typeof e.confidence === 'number'
      ? Math.max(0, Math.min(1, e.confidence))
      : 0.55;
    const rawTitle = e.task_title ? String(e.task_title) : '';
    const rawText = String(e.task_text || e.task_title || '').slice(0, 200) || '工作进展';
    const assigner = e.assigner || extractAssigner(`${rawTitle} ${rawText}`) || null;
    // 强制短标题：禁止把整句口语当 title；已是干净短标题则少动
    let task_title = refineTaskTitle(rawTitle || rawText, { fallback: null });
    if (!task_title || task_title.length > 36 || /给了?我|今天|让我|来源：/.test(task_title)) {
      task_title = refineTaskTitle(rawText, { fallback: (rawTitle && !/来源：/.test(rawTitle) ? rawTitle.slice(0, 28) : null) || '工作进展' });
    }
    if (task_title && /来源：|^（|）$/.test(task_title)) {
      task_title = refineTaskTitle(rawTitle, { fallback: '工作进展' }) || '工作进展';
    }
    let task_text = rawText;
    if (task_title && rawText.length > task_title.length + 8 && /给了?我|让我|今天/.test(rawText)) {
      task_text = assigner ? `${task_title}（来源：${assigner}安排）` : task_title;
    }
    return {
      project_ref: e.project_ref
        ? normalizeProjectRef(String(e.project_ref).slice(0, 40))
        : null,
      task_text,
      task_title: task_title ? String(task_title).slice(0, 36) : null,
      category,
      status,
      blocker_text: e.blocker_text ? String(e.blocker_text).slice(0, 120) : null,
      work_dates,
      date_basis: e.date_basis === 'explicit' ? 'explicit' : 'inferred',
      confidence,
      assigner,
      action_hint: ['progress', 'create', 'archive', 'blocked'].includes(e.action_hint)
        ? e.action_hint
        : null,
    };
  }).filter(e => e.task_text) : [];

  let leave = null;
  if (raw.is_leave && raw.leave) {
    leave = {
      start_date: raw.leave.start_date || today,
      end_date: raw.leave.end_date || raw.leave.start_date || today,
      period: ['am', 'pm', 'full'].includes(raw.leave.period) ? raw.leave.period : 'full',
    };
  }

  let trip = null;
  if (raw.trip && typeof raw.trip === 'object') {
    trip = {
      start_date: raw.trip.start_date || today,
      end_date: raw.trip.end_date || raw.trip.start_date || today,
      location: raw.trip.location || null,
      purpose: raw.trip.purpose || null,
    };
  }

  return {
    is_leave: !!raw.is_leave || intent.includes('leave'),
    leave,
    trip,
    intent: intent.length ? intent : (entries.length ? ['report'] : ['chitchat']),
    question_text: raw.question_text ? String(raw.question_text) : null,
    entries,
  };
}

function buildPrompt({ today, person, message, knownProjects, knownTasks }) {
  const projectsBlock = (knownProjects || []).length
    ? knownProjects.map(p => `- ${p}`).join('\n')
    : '- （暂无）';
  const tasksBlock = (knownTasks || []).length
    ? knownTasks.map(t => `- ${t}`).join('\n')
    : '- （暂无）';

  return `你是部门工作日报的信息抽取器。把员工发来的一条私信，按规则抽取成结构化 JSON。

# 上下文
- 今天日期：${today}
- 员工：${person}
- 已知项目：
${projectsBlock}
- 该员工进行中任务（匹配时 task_title 必须原样复用）：
${tasksBlock}

# 规则（关键）
- **intent 可多选**：report / leave / trip / question / chitchat；若在汇报已有任务进展可在 entries 里标 action_hint。
- **task_title 必须是短任务名（≤20字）**，只保留「做什么」的动宾短语。
  - 禁止整句口语当标题。禁止「今天」「给了我新任务」「让我」等叙事词。
  - 若匹配「进行中任务」列表中的某一项，**task_title 必须原样复用该任务名**。
  - 例：「今天林宇飞给了我新任务，让我搭建电动飞机智能优化平台」
    → task_title="搭建电动飞机智能优化平台"，assigner="林宇飞"，action_hint="create"
  - 例：「FDE平台我今天注入了机器人功能」（若已有任务「注入机器人功能」）
    → task_title="注入机器人功能"，project_ref="FDE"，action_hint="progress"，status=doing
  - 例：「注入机器人功能已完成」→ task_title="注入机器人功能"，action_hint="archive"，status=done
  - 例：「端到端开发，今天我进行了研磨咖啡豆」→ 只保留工作条目；忽略咖啡闲聊。
- project_ref 只填项目简称（FDE平台→FDE）；没有则 null。
- category: tech/admin/other；status: doing/done/blocked；卡点写 blocker_text。
- 可选：assigner、action_hint（progress|create|archive|blocked）。
- 日期未说则 work_dates=[今天]，date_basis=inferred。
- confidence 0~1，不确定给低分。

# 输出
严格 JSON：is_leave, leave, trip, intent, question_text, entries（含 assigner、action_hint 可选）。
不要 markdown。

# 待抽取消息
${message}`;
}

async function extractWithLlm(text, user, context = {}) {
  const today = context.today || todayStr();
  const person = user?.name || '用户';
  const prompt = buildPrompt({
    today,
    person,
    message: text,
    knownProjects: context.knownProjects || [],
    knownTasks: context.knownTasks || [],
  });

  const raw = await llm.chat(
    [
      { role: 'system', content: '你只输出合法 JSON，不解释。' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.2, max_tokens: 2048, json: true }
  );

  if (!raw) return null;
  try {
    const cleaned = String(raw).replace(/```json\n?|\n?```/g, '').trim();
    return normalizeExtract(JSON.parse(cleaned), today);
  } catch (e) {
    console.warn('[robotExtract] LLM JSON parse failed:', e.message);
    return null;
  }
}

async function extractWorkMessage(text, user, context = {}) {
  const today = context.today || todayStr();
  const person = user?.name || '用户';
  const knownProjects = context.knownProjects || [];
  const local = normalizeExtract(extractLocal(person, today, text, knownProjects), today);

  if (llm.isConfigured()) {
    const llmResult = await extractWithLlm(text, user, { ...context, today });
    if (llmResult) {
      // 本地规则对请假/出差更稳：LLM 漏检时补上
      if (!llmResult.is_leave && local.is_leave) {
        llmResult.is_leave = true;
        llmResult.leave = local.leave;
        if (!llmResult.intent.includes('leave')) llmResult.intent = ['leave', ...llmResult.intent];
      }
      if (!llmResult.trip && local.trip) {
        llmResult.trip = local.trip;
        if (!llmResult.intent.includes('trip')) llmResult.intent = ['trip', ...llmResult.intent];
      }
      if (!(llmResult.entries || []).length && (local.entries || []).length && local.intent.includes('report')) {
        llmResult.entries = local.entries;
        if (!llmResult.intent.includes('report')) llmResult.intent = ['report', ...llmResult.intent];
      }
      // LLM 标题若退化成项目名，用本地精炼结果替换
      if ((llmResult.entries || []).length && (local.entries || []).length) {
        llmResult.entries = llmResult.entries.map((e, i) => {
          const loc = local.entries[i] || local.entries[0];
          const badTitle = !e.task_title
            || /(?:管理)?平台$/u.test(e.task_title)
            || (e.project_ref && e.task_title === e.project_ref)
            || (e.project_ref && e.task_title === `${e.project_ref}平台`);
          if (badTitle && loc?.task_title) {
            return {
              ...e,
              task_title: loc.task_title,
              task_text: loc.task_text || e.task_text,
              project_ref: normalizeProjectRef(e.project_ref || loc.project_ref) || e.project_ref,
              confidence: Math.max(e.confidence || 0, loc.confidence || 0),
            };
          }
          return {
            ...e,
            project_ref: normalizeProjectRef(e.project_ref) || e.project_ref,
          };
        });
      }
      return { ...llmResult, _engine: 'llm' };
    }
  }

  return { ...local, _engine: 'local' };
}

module.exports = {
  extractWorkMessage,
  normalizeExtract,
  CONFIDENCE_AUTO,
  MATCH_AUTO,
  MATCH_CANDIDATE,
  todayStr,
};
