/**
 * 工作机器人：三类自主能力
 * 1) 已有任务进展汇报 / 完成归档
 * 2) 新建任务识别入库
 * 3) 问题识别与回答
 */
const { queries, normalizeTaskTitle } = require('../db');
const { extractWorkMessage, CONFIDENCE_AUTO, MATCH_AUTO, MATCH_CANDIDATE, todayStr } = require('./robotExtract');
const { refineTaskTitle, progressNote, normalizeProjectRef, projectKnown } = require('./localExtract');
const agent = require('./agent');
const llm = require('./llm');

const STATUS_MAP = {
  doing: 'in_progress',
  done: 'done',
  blocked: 'blocked',
};

const STATUS_LABEL = {
  todo: '待办',
  in_progress: '执行中',
  blocked: '阻塞',
  review: '待验收',
  done: '已完成',
  terminated: '已终止',
  submitted: '待分配',
};

function periodLabel(period) {
  if (period === 'am') return '上午';
  if (period === 'pm') return '下午';
  return '全天';
}

function intentLabels(intents = []) {
  const map = {
    report: '工作汇报',
    leave: '请假',
    trip: '出差',
    question: '提问',
    chitchat: '闲聊',
    progress: '进展归档',
    new_task: '新建任务',
  };
  return intents.map(i => map[i] || i).join('、') || '未识别';
}

function isQuestionText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/[?？]$/.test(t)) return true;
  if (/^(请问|问一下|帮我查|帮我看|能否告诉|能不能说)/.test(t)) return true;
  if (/^(我的|有没有|有哪些|什么|怎么|如何|谁|多少)/.test(t)) return true;
  if (/(吗|呢)\s*$/.test(t) && t.length < 40) return true;
  if (/需求|验收|拆分|站会|风险|分配|完善|建议|分析/.test(t) && !/今天|推进|完成了|注入|搭建|卡在/.test(t)) {
    return /帮|怎么|如何|建议|完善|分析|拆分/.test(t);
  }
  return false;
}

function isNewTaskSignal(text) {
  return /新任务|给了?我|交给我|安排我|布置|接到.{0,6}(任务|需求)|让我(去)?(做|搭建|开发|负责)|新增任务|创建任务/.test(text);
}

function isProgressSignal(text) {
  return /进展|推进了?|更新了?|联调了?|调试了?|注入了?|完成了?|做完|搞定|今天(做|改|写|推|测|注)|继续|卡在|阻塞|已上线|已提交|日报/.test(text);
}

function isArchiveSignal(text, entry = {}) {
  if (entry.status === 'done' || entry.action_hint === 'archive') return true;
  const t = String(text || '');
  return /已完成|完成了|做完了?|搞定|已归档|已上线|已提交|收工|闭环/.test(t) && !/未完成|没完成|未搞定/.test(t);
}

function isBlockedSignal(text, entry = {}) {
  if (entry.status === 'blocked' || entry.action_hint === 'blocked') return true;
  return /卡点|阻塞|卡住|卡在|堵住/.test(String(text || ''));
}

function collectContext(user) {
  const allMine = queries.getItems({ involved: user.name });
  const myItems = allMine.filter(i =>
    ['todo', 'in_progress', 'blocked', 'review'].includes(i.status)
  );
  const knownTasks = myItems.map(i => i.title).filter(Boolean).slice(0, 50);
  const knownProjects = ['FDE'];
  const seen = new Set(['FDE']);
  myItems.forEach(i => {
    const m = (i.description || '').match(/\[项目:([^\]]+)\]/);
    if (m) {
      const n = normalizeProjectRef(m[1], knownProjects);
      if (n && !seen.has(n)) {
        seen.add(n);
        knownProjects.push(n);
      }
    }
  });
  (queries.getWorkLogs(user.id, 50) || []).forEach(log => {
    (log.extract?.entries || []).forEach(e => {
      if (e.project_ref) {
        const n = normalizeProjectRef(e.project_ref, knownProjects);
        if (n && !seen.has(n)) {
          seen.add(n);
          knownProjects.push(n);
        }
      }
    });
  });
  return { knownProjects, knownTasks, myItems, allMine };
}

/** 给单个任务打匹配分（0–100） */
function scoreOneTask(item, entry, sourceText) {
  const t = String(sourceText || '');
  const title = normalizeTaskTitle(item.title || '');
  const entryTitle = normalizeTaskTitle(entry.task_title || entry.task_text || '');
  if (!title) return 0;

  let score = 0;
  const req = t.match(/REQ-\d{4}-\d{3,}/i);
  if (req && (item.req_no || '').toUpperCase() === req[0].toUpperCase()) score = Math.max(score, 100);

  if (t.includes(title)) score = Math.max(score, 80 + Math.min(title.length, 15));
  if (entryTitle && entryTitle === title) score = Math.max(score, 95);
  if (entryTitle && (title.includes(entryTitle) || entryTitle.includes(title))) {
    score = Math.max(score, 78);
  }

  // 关键词分片：去掉状态/时间噪声后再比
  const noise = /今天|今日|推进|一些|了|的|进行|继续|更新|完成|已|做|我/g;
  const tokensOf = (s) => String(s || '')
    .replace(noise, ' ')
    .split(/[\s\-_/、，,（）()]+/)
    .flatMap(p => (p.length >= 4 ? [p, ...p.match(/.{2,6}/g) || []] : p.length >= 2 ? [p] : []))
    .filter(p => p.length >= 2 && !/^(一些|功能)$/.test(p));

  const titleTokens = [...new Set(tokensOf(title))];
  const entryTokens = [...new Set([...tokensOf(entryTitle), ...tokensOf(t)])];
  if (titleTokens.length && entryTokens.length) {
    const hits = titleTokens.filter(tok => entryTokens.some(e => e.includes(tok) || tok.includes(e)));
    if (hits.length) {
      const ratio = hits.length / titleTokens.length;
      score = Math.max(score, Math.round(40 + ratio * 50));
      // 核心名词命中（≥4字）加权
      if (hits.some(h => h.length >= 4)) score = Math.min(100, score + 8);
    }
  }

  const parts = title.split(/[\s\-_/、，,]/).filter(p => p.length >= 2);
  if (parts.length) {
    const hits = parts.filter(p => t.includes(p) || (entryTitle && entryTitle.includes(p)));
    if (hits.length) {
      score = Math.max(score, 35 + Math.round((hits.length / parts.length) * 45));
    }
  }

  if (entry.project_ref) {
    const proj = normalizeProjectRef(entry.project_ref);
    const m = (item.description || '').match(/\[项目:([^\]]+)\]/);
    if (m && normalizeProjectRef(m[1]) === proj) score = Math.min(100, score + 12);
  }

  // 完成/进展话术且标题关键词命中，略加分
  if (score >= 40 && (isArchiveSignal(t, entry) || isProgressSignal(t))) {
    score = Math.min(100, score + 5);
  }
  return score;
}

/** 返回最佳匹配 + 候选列表 */
function rankTaskMatches(user, entry, myItems, sourceText = '') {
  const active = myItems.filter(i =>
    (i.assignee === user.name || (i.assistants || []).includes(user.name))
    && ['todo', 'in_progress', 'blocked', 'review'].includes(i.status)
  );
  const ranked = active.map(item => ({
    item,
    score: scoreOneTask(item, entry, sourceText || `${entry.task_title || ''} ${entry.task_text || ''}`),
  })).filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  // 同项目仅一条活跃任务时给保底分
  if (entry.project_ref) {
    const proj = normalizeProjectRef(entry.project_ref);
    const sameProj = active.filter(i => {
      const m = (i.description || '').match(/\[项目:([^\]]+)\]/);
      return m && normalizeProjectRef(m[1]) === proj;
    });
    if (sameProj.length === 1) {
      const only = sameProj[0];
      const existing = ranked.find(r => r.item.id === only.id);
      if (existing) existing.score = Math.max(existing.score, 72);
      else ranked.push({ item: only, score: 72 });
      ranked.sort((a, b) => b.score - a.score);
    }
  }

  return {
    best: ranked[0] || null,
    candidates: ranked.slice(0, 5).map(r => ({
      id: r.item.id,
      title: r.item.title,
      req_no: r.item.req_no,
      status: r.item.status,
      score: r.score,
    })),
  };
}

function findTaskMentionedInText(text, myItems) {
  let best = null;
  for (const item of myItems) {
    const score = scoreOneTask(item, { task_title: '', task_text: text }, text);
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best && best.score >= MATCH_CANDIDATE ? best : null;
}

function findMatchingItem(user, entry, myItems, sourceText = '') {
  const { best } = rankTaskMatches(user, entry, myItems, sourceText);
  if (!best) return null;
  if (best.score >= MATCH_AUTO) return best.item;
  return null;
}

function resolveReviewer(assignerName) {
  if (!assignerName) return null;
  const users = queries.getUsers();
  const hit = users.find(u => u.name === assignerName || u.name.includes(assignerName));
  if (hit && (hit.capabilities || []).includes('reviewer')) return hit.name;
  if (hit) return hit.name;
  return null;
}

function mapEntryToItemFields(entry, user) {
  const title = normalizeTaskTitle(
    refineTaskTitle(entry.task_title || entry.task_text, { fallback: '工作进展' })
    || entry.task_title
    || '工作进展'
  );
  const projectPrefix = entry.project_ref ? `[项目:${entry.project_ref}] ` : '';
  const descLines = [];
  if (entry.project_ref) descLines.push(`${projectPrefix}${title}`);
  else descLines.push(`目标：${title}`);
  if (entry.assigner) descLines.push(`任务来源：${entry.assigner}安排`);
  if (entry.blocker_text) descLines.push(`卡点：${entry.blocker_text}`);
  if (entry.work_dates?.length) descLines.push(`工作日期：${entry.work_dates.join('、')}`);

  let status = STATUS_MAP[entry.status] || 'in_progress';
  if (entry.action_hint === 'archive') status = 'done';
  if (entry.action_hint === 'blocked') status = 'blocked';
  const reviewer = resolveReviewer(entry.assigner);
  return {
    type: 'task',
    title: title.slice(0, 48),
    description: descLines.join('\n'),
    status,
    priority: 3,
    assignee: user.name,
    created_by: user.name,
    reviewer: reviewer || null,
    ai_generated: true,
    generate_req_no: true,
    actor: user.name,
    blocked_reason: status === 'blocked' ? (entry.blocker_text || title) : null,
    blocker_type: status === 'blocked' ? 'other' : null,
  };
}

/**
 * 决定条目动作：progress | archive | create | candidate
 * candidate = 中分匹配，需用户选绑任务
 */
function decideEntryAction(user, entry, myItems, sourceText) {
  const { best, candidates } = rankTaskMatches(user, entry, myItems, sourceText);
  const newSignal = isNewTaskSignal(sourceText) || entry.action_hint === 'create' || !!entry.assigner;
  const progressSignal = isProgressSignal(sourceText) || entry.action_hint === 'progress'
    || ['doing', 'done', 'blocked'].includes(entry.status);
  const archive = isArchiveSignal(sourceText, entry);
  const blocked = isBlockedSignal(sourceText, entry);

  // 强制绑定（确认提案时传入）
  if (entry.bind_item_id) {
    const bound = myItems.find(i => i.id === entry.bind_item_id) || queries.getItem(entry.bind_item_id);
    if (bound) {
      if (archive) return { action: 'archive', existing: bound, score: 100, candidates };
      if (blocked) return { action: 'progress', existing: bound, score: 100, candidates, forceBlocked: true };
      return { action: 'progress', existing: bound, score: 100, candidates };
    }
  }

  if (best && best.score >= MATCH_AUTO) {
    if (archive) return { action: 'archive', existing: best.item, score: best.score, candidates };
    if (newSignal && !progressSignal && !archive) {
      const et = normalizeTaskTitle(best.item.title);
      const nt = normalizeTaskTitle(entry.task_title || entry.task_text || '');
      if (nt && et !== nt && !et.includes(nt) && !nt.includes(et) && best.score < 95) {
        return { action: 'create', existing: null, score: best.score, candidates };
      }
    }
    return {
      action: 'progress',
      existing: best.item,
      score: best.score,
      candidates,
      forceBlocked: blocked,
    };
  }

  // 中分：候选确认（进展/归档倾向）或新建确认
  if (best && best.score >= MATCH_CANDIDATE) {
    if (newSignal && !progressSignal && !archive) {
      return { action: 'create', existing: null, score: best.score, candidates, needConfirm: true };
    }
    return {
      action: 'candidate',
      existing: best.item,
      score: best.score,
      candidates,
      preferAction: archive ? 'archive' : (blocked ? 'blocked' : 'progress'),
    };
  }

  // 无匹配：仅 1 条在办且像进展 → 挂靠
  if (!newSignal && progressSignal && myItems.length === 1 && (entry.confidence || 0) >= 0.55) {
    return {
      action: archive ? 'archive' : 'progress',
      existing: myItems[0],
      score: 70,
      candidates: [{ id: myItems[0].id, title: myItems[0].title, req_no: myItems[0].req_no, status: myItems[0].status, score: 70 }],
      forceBlocked: blocked,
    };
  }

  return { action: 'create', existing: null, score: best?.score || 0, candidates, needConfirm: (entry.confidence || 0) < CONFIDENCE_AUTO };
}

function applyEntry(user, entry, myItems, sourceText = '', decisionOverride = null) {
  entry = {
    ...entry,
    task_title: refineTaskTitle(entry.task_title || entry.task_text, { fallback: entry.task_title }) || entry.task_title,
  };
  const decision = decisionOverride || decideEntryAction(user, entry, myItems, sourceText);
  if (decision.action === 'candidate') {
    return { action: 'candidate', entry, decision };
  }

  const fields = mapEntryToItemFields(entry, user);
  const workDate = (entry.work_dates && entry.work_dates[0]) || todayStr();
  const note = progressNote(entry);
  const archive = decision.action === 'archive' || isArchiveSignal(sourceText, entry);

  if (decision.action === 'progress' || decision.action === 'archive') {
    const existing = decision.existing;
    const updates = { actor: user.name };
    if (archive || decision.action === 'archive') {
      updates.status = 'done';
      updates.acceptance_status = 'accepted';
      updates.blocked_reason = null;
      updates.blocker_type = null;
    } else if (decision.forceBlocked || fields.status === 'blocked') {
      updates.status = 'blocked';
      updates.blocked_reason = fields.blocked_reason || entry.blocker_text || '存在卡点';
      updates.blocker_type = 'other';
    } else if (existing.status === 'blocked' && fields.status === 'in_progress') {
      updates.status = 'in_progress';
      updates.blocked_reason = null;
      updates.blocker_type = null;
    }
    if (existing.title && (/给了?我|让我|今天/.test(existing.title) || existing.title.length > 36)) {
      updates.title = fields.title;
      updates.description = fields.description;
    }
    if (fields.reviewer && !existing.reviewer) updates.reviewer = fields.reviewer;
    if (entry.project_ref && !(existing.description || '').includes(`[项目:${entry.project_ref}]`)) {
      updates.description = fields.description;
    }

    const updated = queries.updateItem(existing.id, updates) || existing;
    const didArchive = (archive || decision.action === 'archive');
    queries.addProgressUpdate(existing.id, {
      date: workDate,
      user: user.name,
      description: didArchive
        ? (note.startsWith('完成') ? note : `完成并归档：「${updated.title}」。${note}`)
        : note,
      blocker_type: updates.status === 'blocked' ? 'other' : 'none',
      blocker_desc: entry.blocker_text || '',
    });
    let finalItem = queries.getItem(existing.id) || updated;
    if (didArchive && finalItem.status !== 'done') {
      finalItem = queries.updateItem(existing.id, {
        status: 'done',
        acceptance_status: 'accepted',
        actor: user.name,
      }) || finalItem;
    }
    return { action: didArchive ? 'archive' : 'progress', item: finalItem, entry, score: decision.score };
  }

  // create — 禁止在「明显进展」且无标题时瞎建；需确认的走提案
  const item = queries.createItem(fields);
  if (fields.status === 'done' || archive) {
    queries.updateItem(item.id, {
      status: 'done',
      acceptance_status: 'accepted',
      actor: user.name,
    });
  } else {
    queries.addProgressUpdate(item.id, {
      date: workDate,
      user: user.name,
      description: note,
      blocker_type: fields.status === 'blocked' ? 'other' : 'none',
      blocker_desc: entry.blocker_text || '',
    });
  }
  const finalItem = queries.getItem(item.id) || item;
  myItems.push(finalItem);
  return { action: 'created', item: finalItem, entry, score: decision.score };
}

function formatTaskLine(i) {
  const no = i.req_no ? `${i.req_no} ` : '';
  const st = STATUS_LABEL[i.status] || i.status;
  const role = i._role === 'assist' ? '协助' : '主执行';
  const blocker = i.status === 'blocked' && i.blocked_reason
    ? ` · 卡点：${String(i.blocked_reason).slice(0, 40)}`
    : '';
  return `  · [${st}/${role}] ${no}${i.title}${blocker}`;
}

function listMyTasks(user) {
  const name = user.name;
  const active = ['todo', 'in_progress', 'blocked', 'review'];
  const items = queries.getItems({ involved: name })
    .filter(i => active.includes(i.status))
    .sort((a, b) => (a.priority || 3) - (b.priority || 3) || (b.updated_at || '').localeCompare(a.updated_at || ''));
  return items.map(i => ({
    ...i,
    _role: i.assignee === name ? 'primary' : 'assist',
  }));
}

function answerQuestionLocal(user, question) {
  const q = String(question || '');
  const mine = listMyTasks(user);
  const primary = mine.filter(i => i._role === 'primary');
  const assist = mine.filter(i => i._role === 'assist');
  const blocked = mine.filter(i => i.status === 'blocked');

  if (/阻塞|卡点|堵住/.test(q)) {
    if (!blocked.length) return '你当前没有阻塞任务 🎉';
    return `你有 ${blocked.length} 项阻塞任务：\n${blocked.map(formatTaskLine).join('\n')}`;
  }

  if (/完成|已归档|done/.test(q) && !/未完成|没完成/.test(q)) {
    const done = queries.getItems({ involved: user.name }).filter(i => i.status === 'done').slice(0, 10);
    if (!done.length) return '暂无已完成 / 已归档任务记录。';
    return `最近已归档 ${done.length} 项（最多展示 10 条）：\n${done.map(i => `  · ${i.req_no || ''} ${i.title}`).join('\n')}`;
  }

  if (!mine.length) {
    return '你当前没有进行中的任务。可以直接把今日工作发给我，我会帮你梳理入库。';
  }

  const lines = [
    `${user.name}，你当前共有 ${mine.length} 项在办任务（主执行 ${primary.length} · 协助 ${assist.length} · 阻塞 ${blocked.length}）：`,
  ];
  if (primary.length) {
    lines.push('【主执行】');
    primary.slice(0, 15).forEach(i => lines.push(formatTaskLine(i)));
  }
  if (assist.length) {
    lines.push('【协助】');
    assist.slice(0, 10).forEach(i => lines.push(formatTaskLine(i)));
  }
  if (mine.length > 25) lines.push(`……另有 ${mine.length - 25} 项未全部列出，可在「今日工作台 / 任务中心」查看。`);
  return lines.join('\n');
}

function isMyWorkQuestion(q) {
  const t = String(q || '').trim();
  if (!t) return false;
  if (/^(我的)?(任务|工作|待办|在办)/.test(t)) return true;
  if (/有哪些(任务|工作|阻塞|卡点)/.test(t)) return true;
  if (/任务有什么|工作有什么|待办有什么|在办有什么/.test(t)) return true;
  if (/我(还有|现在|当前).{0,8}(什么|哪些|几).{0,6}(任务|工作|待办)/.test(t)) return true;
  if ((/阻塞|卡点/.test(t) && t.length < 40) || /有没有阻塞|哪些阻塞/.test(t)) return true;
  return false;
}

async function answerQuestion(user, question) {
  const q = String(question || '').trim();
  // 任务清单类问题：强制查库作答，不走闲聊/通用助手
  if (isMyWorkQuestion(q)) {
    return { answer: answerQuestionLocal(user, q), engine: 'data', intent: 'mywork' };
  }
  const mine = listMyTasks(user).slice(0, 20).map(i => ({
    title: i.title, status: i.status, req_no: i.req_no, role: i._role,
    blocked_reason: i.blocked_reason,
  }));
  try {
    const history = queries.getRobotMessages(user.id, 12).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
    const result = await agent.agentChat(
      `${q}\n\n【系统注入的实时任务数据，请优先据此回答】\n${JSON.stringify(mine)}`,
      user,
      { history }
    );
    if (result?.answer) {
      return { answer: result.answer, engine: result.engine || 'llm', intent: result.intent || 'general' };
    }
  } catch (e) {
    console.warn('[robot] agentChat failed:', e.message);
  }
  if (llm.isConfigured()) {
    const raw = await llm.chat([
      { role: 'system', content: '你是 FDE 工作机器人兼 AI 助手：可查任务、完善需求描述与验收标准、拆分建议、风险分析。涉及「我的任务/在办/阻塞」必须严格依据给定任务数据，不得编造。用简洁中文。' },
      { role: 'user', content: `用户：${user.name}\n问题：${q}\n任务数据：${JSON.stringify(mine)}` },
    ], { temperature: 0.4, max_tokens: 2048 });
    if (raw) return { answer: String(raw).trim(), engine: 'llm', intent: 'general' };
  }
  return { answer: answerQuestionLocal(user, q), engine: 'data', intent: 'mywork' };
}

function actionLabel(action) {
  if (action === 'created') return '新建任务';
  if (action === 'archive') return '完成归档';
  if (action === 'progress') return '进展已记';
  if (action === 'candidate') return '待绑任务';
  return '更新';
}

function buildAck({ extract, applied, proposals, engine, qaAnswer, route }) {
  const lines = [];
  if (route === 'question' && qaAnswer) {
    lines.push(qaAnswer);
    return lines.join('\n');
  }

  const intents = [...(extract.intent || [])];
  if (applied.some(a => a.action === 'progress' || a.action === 'archive')) intents.unshift('progress');
  if (applied.some(a => a.action === 'created')) intents.unshift('new_task');
  lines.push(`已理解：${intentLabels([...new Set(intents)])}（引擎：${engine === 'llm' ? '大模型' : '本地规则'}）`);

  if (extract.is_leave && extract.leave) {
    const p = periodLabel(extract.leave.period);
    lines.push(`📅 请假：${extract.leave.start_date} ~ ${extract.leave.end_date}（${p}）`);
  }
  if (extract.trip) {
    const loc = extract.trip.location ? ` · ${extract.trip.location}` : '';
    const purpose = extract.trip.purpose ? ` · ${extract.trip.purpose}` : '';
    lines.push(`✈️ 出差：${extract.trip.start_date} ~ ${extract.trip.end_date}${loc}${purpose}`);
  }

  if (applied.length) {
    lines.push(`✅ 已处理 ${applied.length} 条：`);
    applied.forEach(a => {
      const proj = a.entry.project_ref ? `[${a.entry.project_ref}] ` : '';
      const no = a.item.req_no ? `${a.item.req_no} ` : '';
      const st = STATUS_LABEL[a.item.status] || a.item.status;
      const score = a.score != null ? ` · 匹配${a.score}` : '';
      lines.push(`  · ${actionLabel(a.action)} ${proj}${no}${a.item.title}（${st}${score}）`);
    });
  }

  if (proposals.length) {
    lines.push(`⏳ ${proposals.length} 条需确认（右侧可选择绑定任务或新建）：`);
    proposals.forEach(p => {
      const proj = p.entry.project_ref ? `[${p.entry.project_ref}] ` : '';
      const kind = p.prefer_action === 'archive' ? '归档'
        : p.prefer_action === 'progress' || p.prefer_action === 'blocked' ? '记进展'
        : '入库';
      const cand = (p.candidates && p.candidates[0])
        ? ` · 候选「${p.candidates[0].title}」(${p.candidates[0].score})`
        : '';
      lines.push(`  · ${kind} ${proj}${p.entry.task_title || p.entry.task_text}（置信度 ${Math.round((p.entry.confidence || 0) * 100)}%${cand}）`);
    });
  }

  if (qaAnswer) lines.push(qaAnswer);

  if (!applied.length && !proposals.length && !extract.is_leave && !extract.trip && !qaAnswer) {
    lines.push('未能识别。可以：① 汇报已有任务进展（会自动记进展/归档）② 描述新任务 ③ 直接提问如「我的任务有什么」。');
  }

  return lines.join('\n');
}

function needsConfirm(entry, knownProjects, decision) {
  if (!decision) return true;
  if (decision.action === 'candidate') return true;
  if (decision.action === 'progress' || decision.action === 'archive') return false;
  if (decision.needConfirm) return true;
  const conf = entry.confidence ?? 0;
  if (conf < CONFIDENCE_AUTO) return true;
  const title = entry.task_title || '';
  if (!title || /^(?:[A-Za-z][A-Za-z0-9_-]{1,15}|FDE)(?:管理)?平台?$/i.test(title)) return true;
  if (entry.project_ref && projectKnown(entry.project_ref, knownProjects)) return false;
  if (entry.project_ref && conf >= 0.75 && title.length >= 4) return false;
  if (entry.project_ref && !projectKnown(entry.project_ref, knownProjects) && conf < 0.75) return true;
  return false;
}

async function handleMessage(user, message) {
  const text = String(message || '').trim();
  if (!text) throw new Error('请输入内容');

  const today = todayStr();
  const ctx = collectContext(user);

  // 路线 A：问题优先（含「我的任务有什么」）→ 强制查库作答
  const progressMention = isProgressSignal(text) && findTaskMentionedInText(text, ctx.myItems);
  if ((isMyWorkQuestion(text) || isQuestionText(text)) && !isNewTaskSignal(text) && !progressMention) {
    const qa = await answerQuestion(user, text);
    const reply = buildAck({
      extract: { intent: ['question'], question_text: text, entries: [] },
      applied: [],
      proposals: [],
      engine: qa.engine,
      qaAnswer: qa.answer,
      route: 'question',
    });
    const userMsg = queries.saveRobotMessage({ user_id: user.id, role: 'user', content: text });
    const assistantMsg = queries.saveRobotMessage({
      user_id: user.id,
      role: 'assistant',
      content: reply,
      meta: { route: 'question', engine: qa.engine },
    });
    return {
      reply,
      extract: { intent: ['question'], question_text: text, entries: [] },
      engine: qa.engine,
      route: 'question',
      applied: [],
      proposals: [],
      messages: [userMsg, assistantMsg],
    };
  }

  // 路线 B：汇报 → 进展归档 / 候选确认 / 新建
  const extract = await extractWorkMessage(text, user, {
    today,
    knownProjects: ctx.knownProjects,
    knownTasks: ctx.knownTasks,
  });
  const engine = extract._engine || 'local';

  const applied = [];
  const proposals = [];
  const itemIds = [];

  for (const entry of extract.entries || []) {
    const decision = decideEntryAction(user, entry, ctx.myItems, text);
    if (needsConfirm(entry, ctx.knownProjects, decision)) {
      const proposal = queries.createRobotProposal({
        user_id: user.id,
        user_name: user.name,
        entry,
        source_message: text,
        candidates: decision.candidates || [],
        prefer_action: decision.preferAction
          || (decision.action === 'create' ? 'create' : null)
          || (isArchiveSignal(text, entry) ? 'archive' : 'progress'),
        match_score: decision.score || 0,
      });
      proposals.push({
        id: proposal.id,
        entry: proposal.entry,
        status: proposal.status,
        candidates: proposal.candidates || [],
        prefer_action: proposal.prefer_action,
        match_score: proposal.match_score,
      });
    } else {
      const result = applyEntry(user, entry, ctx.myItems, text, decision);
      if (result.item) {
        applied.push(result);
        itemIds.push(result.item.id);
      }
    }
  }

  let qaAnswer = null;
  if (isQuestionText(text) && applied.length) {
    const qa = await answerQuestion(user, text);
    qaAnswer = qa.answer;
  }

  const reply = buildAck({ extract, applied, proposals, engine, qaAnswer, route: 'report' });

  const userMsg = queries.saveRobotMessage({
    user_id: user.id,
    role: 'user',
    content: text,
  });
  const assistantMsg = queries.saveRobotMessage({
    user_id: user.id,
    role: 'assistant',
    content: reply,
    meta: {
      extract,
      applied: applied.map(a => ({ action: a.action, item_id: a.item.id, title: a.item.title, status: a.item.status, score: a.score })),
      proposals: proposals.map(p => p.id),
      engine,
      route: 'report',
    },
  });

  queries.createWorkLog({
    user_id: user.id,
    user_name: user.name,
    message: text,
    extract,
    item_ids: itemIds,
    proposal_ids: proposals.map(p => p.id),
    engine,
    work_date: today,
  });

  return {
    reply,
    extract,
    engine,
    route: 'report',
    applied: applied.map(a => ({
      action: a.action,
      item: { id: a.item.id, title: a.item.title, status: a.item.status, req_no: a.item.req_no },
      entry: a.entry,
      score: a.score,
    })),
    proposals,
    messages: [userMsg, assistantMsg],
  };
}

function confirmProposal(user, proposalId, action, patch = {}) {
  const proposal = queries.getRobotProposal(proposalId);
  if (!proposal) throw new Error('提案不存在');
  if (proposal.user_id !== user.id && user.role !== 'admin') throw new Error('无权操作该提案');
  if (proposal.status !== 'proposed') throw new Error('提案已处理');

  if (action === 'reject') {
    const updated = queries.decideRobotProposal(proposalId, 'rejected', user.name);
    const reply = `已拒绝提案：${proposal.entry.task_title || proposal.entry.task_text}`;
    queries.saveRobotMessage({ user_id: user.id, role: 'assistant', content: reply, meta: { proposal_id: proposalId, action: 'reject' } });
    return { ok: true, action: 'reject', proposal: updated, reply };
  }

  if (action !== 'accept' && action !== 'edit') {
    throw new Error('action 须为 accept / reject / edit');
  }

  const prefer = patch.prefer_action || proposal.prefer_action || null;
  let bindItemId = patch.bind_item_id || null;
  if (bindItemId === '' || bindItemId === 'new') bindItemId = null;
  // 中分候选：未选手动绑定时，默认挂靠最高分候选（除非明确选新建）
  if (!bindItemId && prefer !== 'create' && (proposal.candidates || []).length) {
    bindItemId = proposal.candidates[0].id;
  }

  const entry = {
    ...proposal.entry,
    ...(patch.project_ref !== undefined ? { project_ref: patch.project_ref } : {}),
    ...(patch.task_text !== undefined ? { task_text: patch.task_text } : {}),
    ...(patch.task_title !== undefined ? { task_title: patch.task_title } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.blocker_text !== undefined ? { blocker_text: patch.blocker_text } : {}),
    confidence: 1,
    bind_item_id: bindItemId || undefined,
  };
  if (prefer === 'archive' || entry.status === 'done') {
    entry.action_hint = 'archive';
    entry.status = 'done';
  } else if (prefer === 'blocked' || entry.status === 'blocked') {
    entry.action_hint = 'blocked';
    entry.status = 'blocked';
  } else if (prefer === 'progress') {
    entry.action_hint = 'progress';
  } else if (prefer === 'create' && !bindItemId) {
    entry.action_hint = 'create';
    entry.bind_item_id = undefined;
  }

  const ctx = collectContext(user);
  const decisionOverride = bindItemId
    ? decideEntryAction(user, entry, ctx.myItems, proposal.source_message || '')
    : (prefer === 'create' || !bindItemId
      ? { action: 'create', existing: null, score: 0, candidates: proposal.candidates || [] }
      : null);
  const result = applyEntry(user, entry, ctx.myItems, proposal.source_message || '', decisionOverride);
  if (!result.item) throw new Error('确认失败：未能写入任务');

  const updated = queries.decideRobotProposal(proposalId, 'accepted', user.name, {
    item_id: result.item.id,
    entry,
  });

  const reply = `✅ 已确认并${actionLabel(result.action)}：${result.item.title}`;
  queries.saveRobotMessage({
    user_id: user.id,
    role: 'assistant',
    content: reply,
    meta: { proposal_id: proposalId, action: 'accept', item_id: result.item.id },
  });
  queries.createWorkLog({
    user_id: user.id,
    user_name: user.name,
    message: `[确认提案] ${entry.task_text}`,
    extract: { intent: ['report'], entries: [entry] },
    item_ids: [result.item.id],
    proposal_ids: [proposalId],
    engine: 'confirm',
    work_date: todayStr(),
  });

  return {
    ok: true,
    action: 'accept',
    proposal: updated,
    item: { id: result.item.id, title: result.item.title, status: result.item.status, req_no: result.item.req_no },
    reply,
  };
}

function getHistory(user, limit = 40) {
  return {
    messages: queries.getRobotMessages(user.id, limit),
    proposals: queries.getRobotProposals(user.id, 'proposed'),
  };
}

function getLogs(user, limit = 30) {
  return queries.getWorkLogs(user.id, limit);
}

module.exports = {
  handleMessage,
  confirmProposal,
  getHistory,
  getLogs,
  CONFIDENCE_AUTO,
};
