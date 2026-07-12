const https = require('https');
const http = require('http');
const fs = require('fs');

// 默认使用 DeepSeek（国产顶尖大模型，OpenAI 兼容）
const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
  dashscope: {
    name: '通义千问',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    keyEnv: 'DASHSCOPE_API_KEY',
  },
};

function getActiveProvider() {
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  if (process.env.DASHSCOPE_API_KEY) return { ...PROVIDERS.dashscope, useDashScope: true };
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function getConfig() {
  const p = getActiveProvider();
  if (p === 'deepseek') {
    return {
      provider: 'DeepSeek',
      apiKey: process.env.DEEPSEEK_API_KEY,
      base: (process.env.DEEPSEEK_BASE_URL || PROVIDERS.deepseek.base).replace(/\/$/, ''),
      model: process.env.DEEPSEEK_MODEL || PROVIDERS.deepseek.model,
    };
  }
  if (p && p.useDashScope) {
    return {
      provider: '通义千问 Qwen',
      apiKey: process.env.DASHSCOPE_API_KEY,
      base: (process.env.DASHSCOPE_BASE_URL || PROVIDERS.dashscope.base).replace(/\/$/, ''),
      model: process.env.DASHSCOPE_MODEL || PROVIDERS.dashscope.model,
    };
  }
  if (p === 'openai') {
    return {
      provider: 'OpenAI',
      apiKey: process.env.OPENAI_API_KEY,
      base: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }
  return null;
}

function isConfigured() { return Boolean(getConfig()); }

function getProviderInfo() {
  const cfg = getConfig();
  const asrKey = process.env.DASHSCOPE_API_KEY;
  const asr = require('./asr');
  return {
    llm: cfg ? { provider: cfg.provider, model: cfg.model, reasoner: process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-reasoner' } : null,
    asr: asrKey ? { provider: '阿里云 DashScope 多引擎', model: asr.MODELS?.primary || 'paraformer-v2', ...asr.getAsrInfo() } : null,
    docparse: { formats: require('./docparse').getSupportedFormats(), mode: 'multi-pass' },
    agent: { mode: 'RAG + 多轮对话', intents: ['split', 'assign', 'risk', 'standup', 'mywork', 'team'] },
    ready: Boolean(cfg && asrKey),
  };
}

function fetchJSON(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 120000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    if (body) req.write(body);
    req.end();
  });
}

async function chat(messages, opts = {}) {
  const cfg = getConfig();
  if (!cfg) return null;

  const payload = {
    model: opts.model || cfg.model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens || 8192,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  };

  try {
    const res = await fetchJSON(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    }, JSON.stringify(payload));

    if (res.status !== 200) {
      console.error(`[LLM ${cfg.provider}]`, res.status, JSON.stringify(res.body).slice(0, 300));
      return null;
    }
    return res.body.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error(`[LLM ${cfg.provider}]`, err.message);
    return null;
  }
}

function parseJsonSafe(raw) {
  if (!raw) return null;
  try {
    const clean = raw.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('JSON parse error:', e.message);
    return null;
  }
}

async function analyzeChunk(chunk, userName, chunkIndex, totalChunks) {
  const prompt = `你是资深需求分析师。分析文档片段 (${chunkIndex + 1}/${totalChunks})，提取结构化信息。

提交人：${userName}
文档片段标题：${chunk.title}

返回 JSON：
{
  "section_summary": "本段摘要",
  "requirements": ["功能需求1", "功能需求2"],
  "constraints": ["约束1"],
  "acceptance_hints": ["验收要点1"],
  "keywords": ["关键词"],
  "open_questions": ["待确认问题"]
}

文档内容：
${chunk.content.slice(0, 8000)}`;

  const result = await chat([
    { role: 'system', content: '你是专业需求分析师，只返回合法 JSON。' },
    { role: 'user', content: prompt },
  ], { json: true, temperature: 0.2 });
  return parseJsonSafe(result) || { section_summary: chunk.content.slice(0, 200), requirements: [], keywords: [] };
}

async function synthesizeDocumentAnalysis(chunkResults, meta, userName) {
  const merged = {
    sections: chunkResults.map(c => c.section_summary).filter(Boolean),
    requirements: chunkResults.flatMap(c => c.requirements || []),
    constraints: chunkResults.flatMap(c => c.constraints || []),
    acceptance_hints: chunkResults.flatMap(c => c.acceptance_hints || []),
    keywords: [...new Set(chunkResults.flatMap(c => c.keywords || []))],
    open_questions: chunkResults.flatMap(c => c.open_questions || []),
  };

  const prompt = `你是 AI 赋能敏捷项目管理首席专家。基于多段文档分析结果，完成：

1. 输出完整 Markdown 需求规格书（背景/目标/功能清单/非功能需求/验收标准/里程碑）
2. 拆分为 Epic → Story → Task（INVEST 原则，斐波那契 SP）
3. 标注优先级、风险、待确认事项

文档元信息：${JSON.stringify(meta)}
提交人：${userName}

分析汇总：
${JSON.stringify(merged, null, 0)}

返回严格 JSON：
{
  "document": "完整 Markdown 需求规格书",
  "epic": { "title": "...", "description": "..." },
  "stories": [{ "title": "...", "description": "...", "story_points": 3, "acceptance_criteria": "Given...When...Then...", "priority": 1, "tasks": ["任务1","任务2"] }],
  "summary": "200字摘要",
  "keywords": ["关键词"],
  "priority": "high|medium|low",
  "risks": ["风险1"],
  "action_items": ["行动项1"],
  "confidence": 0.85
}`;

  const result = await chat([
    { role: 'system', content: '你是敏捷需求工程专家。深度分析文档，输出高质量需求规格和任务拆分。只返回合法 JSON。' },
    { role: 'user', content: prompt },
  ], { json: true, temperature: 0.25, max_tokens: 12000 });

  const parsed = parseJsonSafe(result);
  if (!parsed) return null;
  return normalizeAnalysis(parsed);
}

function normalizeAnalysis(parsed) {
  parsed.stories = (parsed.stories || []).map(s => ({
    type: 'story', ai_generated: true, story_points: s.story_points || 3,
    priority: s.priority || 2, ...s,
  }));
  parsed.tasks = parsed.stories.flatMap(s => (s.tasks || []).map(t => ({
    type: 'task', title: t, parent_title: s.title,
  })));
  parsed.epic = {
    type: 'epic', ai_generated: true,
    title: parsed.epic?.title || '文档需求',
    description: parsed.epic?.description || parsed.summary || '',
    story_points: parsed.stories.reduce((a, s) => a + (s.story_points || 0), 0),
  };
  return parsed;
}

async function analyzeDocument(parsed, userName) {
  const { chunks, meta, text } = parsed;
  const cfg = getConfig();
  if (!cfg) return null;

  const chunkResults = [];
  for (let i = 0; i < chunks.length; i++) {
    chunkResults.push(await analyzeChunk(chunks[i], userName, i, chunks.length));
  }

  let analysis = await synthesizeDocumentAnalysis(chunkResults, meta, userName);

  if (!analysis && text.length < 12000) {
    analysis = await analyzeVoiceTranscript(text, userName);
  }

  if (analysis) {
    analysis.meta = meta;
    analysis.analysis_mode = chunks.length > 1 ? 'multi-pass' : 'single-pass';
    analysis.chunk_count = chunks.length;
  }
  return analysis;
}

async function parseMeetingToRequirement(content, userName) {
  const prompt = `你是敏捷需求分析专家。根据以下会议记录/语音转写/文档内容，提取并结构化需求信息，用于填写需求提交表单。

提交人：${userName}

返回严格 JSON（不要 markdown 代码块）：
{
  "title": "需求标题（简洁，≤50字）",
  "scene": "应用场景与业务目标（详细描述背景、用户、痛点）",
  "acceptance": "验收目标与验收标准（Given-When-Then 或条目列表）",
  "deadline": "期望完成时间（YYYY-MM-DD 格式，无法推断则留空字符串）",
  "summary": "100字以内需求摘要",
  "priority": "high|medium|low",
  "keywords": ["关键词1", "关键词2"]
}

会议记录内容：
${content.slice(0, 12000)}`;

  const result = await chat([
    { role: 'system', content: '你擅长从会议讨论中提取可执行的需求信息。只返回合法 JSON。' },
    { role: 'user', content: prompt },
  ], { json: true, temperature: 0.2 });

  const parsed = parseJsonSafe(result);
  if (parsed?.title) {
    parsed.engine = 'llm';
    return parsed;
  }
  return null;
}

async function smartSplitRequirement(text) {
  const prompt = `你是敏捷项目管理 AI 专家。将以下需求拆分为 Epic、用户故事(Story)和任务(Task)。
返回严格 JSON：
{
  "epic": { "title": "...", "description": "..." },
  "stories": [{ "title": "...", "description": "...", "story_points": 3, "acceptance_criteria": "Given...When...Then...", "tasks": ["任务1","任务2"] }],
  "summary": "拆分说明"
}
Story Points 使用斐波那契(1,2,3,5,8)。需求：
${text}`;

  const result = await chat([
    { role: 'system', content: '你是专业敏捷教练，只返回合法 JSON，不要 markdown 代码块。' },
    { role: 'user', content: prompt },
  ], { json: true, temperature: 0.3 });

  if (!result) return null;
  try {
    const clean = result.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (parsed.stories?.length) {
      parsed.stories = parsed.stories.map(s => ({
        type: 'story', ai_generated: true, story_points: s.story_points || 3, priority: 2, ...s,
      }));
      parsed.epic = { type: 'epic', ai_generated: true, story_points: parsed.stories.reduce((a, s) => a + (s.story_points || 0), 0), ...parsed.epic };
      parsed.tasks = parsed.stories.flatMap(s => (s.tasks || [`[开发] ${s.title}`, `[测试] ${s.title}`]).map((t, i) => ({
        type: 'task', title: t.startsWith('[') ? t : `[任务] ${t}`, parent_title: s.title,
      })));
      return parsed;
    }
  } catch (e) { console.error('JSON parse error:', e.message); }
  return null;
}

async function analyzeVoiceTranscript(transcript, userName) {
  const prompt = `你是 AI 赋能敏捷项目管理专家。根据以下语音会议/需求录音转写内容，完成三件事：

1. **梳理为结构化需求文档**（Markdown，含背景、目标、功能点、验收标准、时间要求）
2. **拆分为可执行的敏捷任务**（Epic → Story → Task）
3. **提取关键信息**（优先级、风险、待确认事项）

提交人：${userName}

返回严格 JSON（不要 markdown 代码块包裹）：
{
  "document": "完整 Markdown 需求文档",
  "epic": { "title": "Epic标题", "description": "Epic描述" },
  "stories": [
    {
      "title": "用户故事标题",
      "description": "描述",
      "story_points": 3,
      "acceptance_criteria": "Given...When...Then...",
      "priority": 1,
      "tasks": ["具体开发任务1", "具体开发任务2", "测试任务"]
    }
  ],
  "summary": "200字以内的梳理摘要",
  "keywords": ["关键词1", "关键词2"],
  "priority": "high",
  "risks": ["风险或待确认1"],
  "action_items": ["会后立即行动1"]
}

语音转写原文：
${transcript}`;

  const result = await chat([
    { role: 'system', content: '你擅长将口语化会议录音整理为专业需求文档和敏捷任务。只返回合法 JSON。' },
    { role: 'user', content: prompt },
  ], { json: true, temperature: 0.3 });

  if (!result) return null;
  try {
    const parsed = parseJsonSafe(result);
    if (!parsed) return null;
    return normalizeAnalysis(parsed);
  } catch (e) { console.error('Voice analysis parse error:', e.message); }
  return null;
}

async function smartAnalyze(context, task) {
  const prompts = {
    standup: `根据以下项目数据生成今日站会摘要（Markdown，中文）：\n${context}`,
    risks: `分析以下项目风险（Markdown，中文）：\n${context}`,
    retro: `根据项目流动数据生成回顾报告（Markdown，中文）：\n${context}`,
    copilot: `你是 FDE管理平台 智能协作者（国产大模型驱动）。基于上下文回答，Markdown 格式。\n\n上下文：\n${context}\n\n问题：${task}`,
    assign: `根据任务需求和成员项目背景、技能、工作负载，推荐主执行人和1-3名协助执行人。返回 JSON: {"assignee":"主执行人","assistants":["协助人1","协助人2"],"reason":"理由"}\n\n${context}`,
  };
  return chat([
    { role: 'system', content: '你是 AI 赋能敏捷项目管理专家，回答简洁专业。' },
    { role: 'user', content: prompts[task] || task },
  ], { temperature: task === 'assign' ? 0.3 : 0.6, json: task === 'assign' });
}

module.exports = { isConfigured, getConfig, getProviderInfo, chat, smartSplitRequirement, smartAnalyze, analyzeVoiceTranscript, analyzeDocument, parseMeetingToRequirement, parseJsonSafe, normalizeAnalysis };
