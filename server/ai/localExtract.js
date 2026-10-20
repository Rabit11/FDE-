/**
 * 无大模型时的本地规则抽取（对齐 aiicrobot local_extract.py）
 * 强化：口语叙事 → 短标题；过滤闲聊琐事；识别「谁给的新任务」
 */

function emptyResult(intent = ['chitchat']) {
  return {
    is_leave: false,
    leave: null,
    trip: null,
    intent,
    question_text: null,
    entries: [],
  };
}

function pickDates(text, today) {
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (dates.length >= 2) return [dates[0], dates[1]];
  if (dates.length === 1) return [dates[0], dates[0]];
  return [today, today];
}

function matchProject(chunk, known = []) {
  const bracket = chunk.match(/[【\[]([^】\]]{1,30})[】\]]/);
  if (bracket) return normalizeProjectRef(bracket[1].trim(), known);
  const labeled = chunk.match(/(?:项目|型号)\s*[：:]?\s*([A-Za-z0-9_\-\u4e00-\u9fff]{1,20})/);
  if (labeled) return normalizeProjectRef(labeled[1].trim(), known);
  // 「FDE平台…」「FDE 管理平台…」
  const prefixed = chunk.match(/\b([A-Za-z][A-Za-z0-9_-]{1,15})\s*(?:管理)?平台/);
  if (prefixed) return normalizeProjectRef(prefixed[1], known);
  const cnPrefixed = chunk.match(/([A-Za-z][A-Za-z0-9_-]{1,15}|[\u4e00-\u9fff]{2,12})(?:管理)?平台/);
  if (cnPrefixed && !/注入|搭建|开发|功能/.test(cnPrefixed[1])) {
    return normalizeProjectRef(cnPrefixed[0].replace(/(?:管理)?平台$/, '') || cnPrefixed[1], known);
  }
  for (const p of known) {
    if (p && chunk.includes(p)) return normalizeProjectRef(p, known);
  }
  return null;
}

/** 统一项目别名：FDE平台 / FDE管理平台 → FDE */
function normalizeProjectRef(ref, known = []) {
  if (!ref) return null;
  let r = String(ref).trim().replace(/[【\]]/g, '');
  r = r.replace(/(?:管理)?平台$/u, '').trim() || r;
  const knownList = [...(known || []), 'FDE', 'MJKY', 'DTP'];
  const lower = r.toLowerCase();
  for (const k of knownList) {
    if (!k) continue;
    if (k === r || k.toLowerCase() === lower) return k;
    if (r.includes(k) || k.includes(r)) return k.length <= r.length ? k : r;
  }
  // 纯字母代号优先大写
  if (/^[A-Za-z][A-Za-z0-9_-]{1,15}$/.test(r)) return r.toUpperCase();
  return r;
}

function projectKnown(ref, knownProjects = []) {
  if (!ref) return true;
  const n = normalizeProjectRef(ref, knownProjects);
  const aliases = new Set(
    (knownProjects || []).flatMap(p => {
      const x = normalizeProjectRef(p, knownProjects);
      return [p, x, `${x}平台`, `${x}管理平台`].filter(Boolean);
    }).concat(['FDE', 'FDE平台', 'FDE管理平台'])
  );
  return aliases.has(ref) || aliases.has(n) || [...aliases].some(a => normalizeProjectRef(a) === n);
}

function statusOf(chunk) {
  if (/卡点|阻塞|堵住|卡住|卡在|blocked/i.test(chunk)) {
    const bm = chunk.match(/(?:卡点|阻塞|堵住|卡住|卡在)[：:：]?\s*(.+)$/);
    return { status: 'blocked', blocker_text: (bm ? bm[1].trim() : chunk).slice(0, 80) };
  }
  if (/已完成|完成了|搞定|做完|已上线|已提交|done/i.test(chunk)) {
    return { status: 'done', blocker_text: null };
  }
  return { status: 'doing', blocker_text: null };
}

function categoryOf(chunk) {
  if (/开会|报销|汇报|周会|邮件|行政|采购/.test(chunk)) return 'admin';
  if (/开发|调试|联调|接口|算法|代码|测试|部署|排障|设计|方案|筛选|权限|平台|搭建|优化/.test(chunk)) return 'tech';
  return 'other';
}

/** 从口语里抽出发给人，如「林宇飞给了我新任务」 */
function extractAssigner(text) {
  const cleaned = String(text || '').replace(/今日|今天|本日|昨日|昨天|刚才|刚刚/g, '');
  const m = cleaned.match(/([\u4e00-\u9fff]{2,4}|[A-Za-z][\w.-]{1,20})\s*(?:给了?我|交给我|安排我|让我做|布置)/);
  if (!m) return null;
  const name = m[1];
  if (/领导|老板|同事|有人|老师|任务|需求|工作|平台/.test(name)) return null;
  return name;
}

/**
 * 把整句口语压成短任务名（标题用）
 * 「今天林宇飞给了我新任务，让我搭建电动飞机智能优化平台」→「搭建电动飞机智能优化平台」
 */
function refineTaskTitle(raw, opts = {}) {
  let t = String(raw || '').trim();
  if (!t) return null;

  t = t.replace(/[【\[][^】\]]+[】\]]/g, '').trim();
  t = t.replace(/^(项目|型号)\s*[：:]?\s*\S+\s*/, '').trim();
  // 去掉「FDE平台 / XX平台」项目前缀：仅当后面还有实质工作内容；「搭建XX平台」整句保留
  t = t.replace(/^[A-Za-z][A-Za-z0-9_-]{1,15}\s*(?:管理)?平台(?=\S)/u, '');
  {
    const m = t.match(/^([\u4e00-\u9fffA-Za-z0-9_-]{1,12})(?:管理)?平台(.*)$/u);
    if (m && String(m[2] || '').replace(/\s/g, '').length >= 2) {
      t = m[2].trim();
    }
  }

  // 去掉日期/叙事前缀
  t = t.replace(/^(?:我)?(?:今日|今天|本日|昨日|昨天|刚才|刚刚)[，,\s]*/u, '');
  t = t.replace(/^我\s*/, '');
  t = t.replace(/^(?:今日|今天|本日|昨日|昨天)[，,\s]*/u, '');
  t = t.replace(/^[\u4e00-\u9fffA-Za-z0-9._-]{2,12}\s*(?:给了?我|交给我|安排我|布置了?)(?:了)?(?:一个|一项|一条)?(?:新)?(?:的)?(?:任务|需求|工作)[，,：:\s]*/, '');
  t = t.replace(/^(?:让我|叫我|要我|希望我|请我|负责|需要我)\s*/, '');
  const didInject = /注入了?/.test(t);
  t = t.replace(/^(?:进行了?|做了?|完成了?|推进了?|开展了?|注入了?)\s*/, '');
  // 「注入了机器人功能」→ 去掉「注入了」后补回动词
  if (didInject && /^机器人功能/.test(t)) t = `注入${t}`;
  if (/^了/.test(t)) t = t.replace(/^了/, '');

  // 「端到端开发，今天我进行了…」→ 优先取专业段
  if (/[，,]/.test(t)) {
    const parts = t.split(/[，,]/).map(p => p.trim()).filter(Boolean);
    const workish = parts.find(p => looksLikeWork(p) && !isChitchat(p));
    if (workish) t = workish;
    else t = parts[0];
  }

  t = t.split(/[。；;！!？?]/)[0].trim();
  t = t.replace(/^(?:新任务|任务|需求)[：:\s]*/, '').trim();
  // 去掉来源尾巴 / 完成态尾巴，避免污染标题
  t = t.replace(/（来源：[^）]+）$/u, '').trim();
  t = t.replace(/(?:已完成|完成了|搞定|做完了?|已归档|已上线|已提交)$/u, '').trim();

  // 标题若只剩项目名，无效
  if (/^(?:[A-Za-z][A-Za-z0-9_-]{1,15}|FDE)(?:管理)?平台?$/i.test(t)) {
    return opts.fallback || null;
  }

  if (t.length > 28) {
    const verb = t.match(/(搭建|开发|设计|实现|优化|联调|调试|推进|完成|修复|撰写|评审|部署|梳理|建设|注入).{2,24}/);
    if (verb) t = verb[0];
    else t = t.slice(0, 28);
  }

  if (!t || isChitchat(t)) return opts.fallback || null;
  return t.slice(0, 36);
}

function isChitchat(p) {
  return /咖啡|午饭|晚饭|回家|睡觉|天气|打车|快递|闲聊|摸鱼|喝水/.test(p)
    || /^(你好|谢谢|收到|嗯|好的)[!！.。]*$/.test(p);
}

function looksLikeWork(p) {
  return /开发|调试|测试|修复|完成|卡点|对接|撰写|评审|部署|联调|推进|搭建|优化|平台|算法|接口|方案|注入|功能|【|项目|任务|需求/.test(p);
}

function looksLikeTask(p) {
  return looksLikeWork(p);
}

function progressNote(entry) {
  const title = entry.task_title || refineTaskTitle(entry.task_text) || '工作进展';
  if (entry.status === 'blocked') {
    return `推进「${title}」，卡点：${entry.blocker_text || '未说明'}`;
  }
  if (entry.status === 'done') {
    return `完成「${title}」`;
  }
  if (entry.assigner) {
    return `接到${entry.assigner}安排的新任务「${title}」，开始推进`;
  }
  const raw = String(entry.task_text || '').trim();
  // 避免进展=整段口语标题
  if (raw && refineTaskTitle(raw) && refineTaskTitle(raw) !== raw && raw.length > 20) {
    return `今日进展：${title}`;
  }
  return raw && raw.length <= 40 ? raw : `今日进展：${title}`;
}

function buildEntry(chunk, today, known, extra = {}) {
  const assigner = extra.assigner || extractAssigner(chunk);
  const cleaned = refineTaskTitle(chunk) || chunk.slice(0, 36);
  const proj = matchProject(chunk, known);
  const { status, blocker_text } = statusOf(chunk);
  let taskText = chunk.slice(0, 200);
  // 任务说明用「动作目标」句，而不是整段寒暄
  if (cleaned && cleaned !== chunk && chunk.length > cleaned.length + 6) {
    taskText = assigner
      ? `${cleaned}（来源：${assigner}安排）`
      : cleaned;
  }
  let action_hint = null;
  if (status === 'done' || /已完成|完成了|做完|搞定|已归档/.test(chunk)) action_hint = 'archive';
  else if (status === 'blocked' || /卡点|阻塞|卡住|卡在/.test(chunk)) action_hint = 'blocked';
  else if (assigner || /新任务|给了?我|让我(去)?(做|搭建|开发|负责)|安排我|布置/.test(chunk)) action_hint = 'create';
  else if (/进展|推进|注入|联调|调试|今天|继续|更新/.test(chunk)) action_hint = 'progress';
  return {
    project_ref: proj,
    task_text: taskText,
    task_title: cleaned,
    category: categoryOf(chunk),
    status,
    blocker_text,
    work_dates: [today],
    date_basis: 'inferred',
    confidence: proj || assigner ? 0.78 : 0.65,
    assigner: assigner || null,
    action_hint,
  };
}

function extractLocal(person, today, message, knownProjects = []) {
  const text = String(message || '').trim();
  const known = (knownProjects || []).filter(Boolean);

  if (/^(你好|您好|在吗|谢谢|早上好|中午好|晚上好|hi|hello|hey)[!！.。]*$/i.test(text)) {
    return emptyResult(['chitchat']);
  }

  if (/请假|休假|年假|病假|调休|不上班/.test(text)) {
    const period = text.includes('上午') ? 'am' : (text.includes('下午') ? 'pm' : 'full');
    const [start, end] = pickDates(text, today);
    const intents = ['leave'];
    const workPart = text.replace(/.*(请假|休假|年假|病假|调休).*/, '').trim();
    let entries = [];
    if (workPart && looksLikeTask(workPart) && !isChitchat(workPart)) {
      entries = [buildEntry(workPart, today, known)];
      intents.unshift('report');
    }
    return {
      is_leave: true,
      leave: { start_date: start, end_date: end, period },
      trip: null,
      intent: intents,
      question_text: null,
      entries,
    };
  }

  if (text.includes('出差')) {
    const [start, end] = pickDates(text, today);
    let location = null;
    const locM = text.match(/出差(?:去|到|至)?\s*([^\s，,。；;]{1,12})/);
    if (locM && !['今天', '明天', '后天', '本周', '下周'].includes(locM[1])) {
      location = locM[1];
    }
    let purpose = null;
    const pm = text.match(/(?:参加|处理|对接|培训|开会|拜访)([^\s，,。；;]{0,20})/);
    if (pm) purpose = pm[0];
    return {
      is_leave: false,
      leave: null,
      trip: { start_date: start, end_date: end, location, purpose },
      intent: ['trip'],
      question_text: null,
      entries: [],
    };
  }

  if (
    /[?？]$/.test(text)
    || /^(请问|问一下|帮我查)/.test(text)
    || /(谁|哪些|多少|怎么|如何|什么).{0,8}(吗|呢)?$/.test(text)
  ) {
    return {
      is_leave: false,
      leave: null,
      trip: null,
      intent: ['question'],
      question_text: text,
      entries: [],
    };
  }

  let chunks = text.split(/[\n;；]+/).map(c => c.trim()).filter(Boolean);
  if (chunks.length === 1 && /[，,]/.test(chunks[0])) {
    // 「新任务，让我…」不要拆；「端到端开发，研磨咖啡」可拆并丢弃闲聊
    if (!/给了?我|让我|卡点|阻塞|卡住|卡在/.test(chunks[0])) {
      const parts = chunks[0].split(/[，,]/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2 && parts.some(looksLikeTask)) {
        chunks = parts.filter(p => !isChitchat(p));
        if (!chunks.length) chunks = [parts[0]];
      }
    }
  }

  const assigner = extractAssigner(text);
  const entries = [];
  for (let chunk of chunks) {
    chunk = chunk.replace(/^(今日|今天|本日)?(工作)?(日报|汇报)?[：:\s]*/, '').trim();
    if (!chunk) continue;
    if (/^(你好|谢谢|收到)[!！.。]*$/.test(chunk)) continue;
    if (isChitchat(chunk) && !looksLikeWork(chunk)) continue;
    entries.push(buildEntry(chunk, today, known, { assigner }));
  }

  if (!entries.length && !isChitchat(text)) {
    entries.push(buildEntry(text, today, known, { assigner }));
  }

  if (!entries.length) {
    return emptyResult(['chitchat']);
  }

  return {
    is_leave: false,
    leave: null,
    trip: null,
    intent: ['report'],
    question_text: null,
    entries,
  };
}

module.exports = {
  extractLocal,
  refineTaskTitle,
  extractAssigner,
  progressNote,
  isChitchat,
  normalizeProjectRef,
  projectKnown,
};
