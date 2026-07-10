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
  return {
    llm: cfg ? { provider: cfg.provider, model: cfg.model } : null,
    asr: asrKey ? { provider: '阿里云 Paraformer', model: 'paraformer-v2' } : null,
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
    const clean = result.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(clean);
    parsed.stories = (parsed.stories || []).map(s => ({
      type: 'story', ai_generated: true, story_points: s.story_points || 3,
      priority: s.priority || 2, ...s,
    }));
    parsed.tasks = parsed.stories.flatMap(s => (s.tasks || []).map(t => ({
      type: 'task', title: t, parent_title: s.title,
    })));
    parsed.epic = { type: 'epic', ai_generated: true, title: parsed.epic?.title || '语音需求', description: parsed.epic?.description || transcript.slice(0, 200), story_points: parsed.stories.reduce((a, s) => a + (s.story_points || 0), 0) };
    return parsed;
  } catch (e) { console.error('Voice analysis parse error:', e.message); }
  return null;
}

async function smartAnalyze(context, task) {
  const prompts = {
    standup: `根据以下项目数据生成今日站会摘要（Markdown，中文）：\n${context}`,
    risks: `分析以下项目风险（Markdown，中文）：\n${context}`,
    retro: `根据 Sprint 数据生成回顾报告（Markdown，中文）：\n${context}`,
    copilot: `你是 AgileAI 智能协作者（国产大模型驱动）。基于上下文回答，Markdown 格式。\n\n上下文：\n${context}\n\n问题：${task}`,
    assign: `推荐最佳执行人。返回 JSON: {"assignee":"姓名","reason":"原因"}\n\n${context}`,
  };
  return chat([
    { role: 'system', content: '你是 AI 赋能敏捷项目管理专家，回答简洁专业。' },
    { role: 'user', content: prompts[task] || task },
  ], { temperature: task === 'assign' ? 0.3 : 0.6, json: task === 'assign' });
}

module.exports = { isConfigured, getConfig, getProviderInfo, chat, smartSplitRequirement, smartAnalyze, analyzeVoiceTranscript };
