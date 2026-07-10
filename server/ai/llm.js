const https = require('https');
const http = require('http');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
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
      timeout: 60000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM 请求超时')); });
    if (body) req.write(body);
    req.end();
  });
}

async function chat(messages, opts = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const base = (process.env.OPENAI_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const model = opts.model || DEFAULT_MODEL;
  const payload = {
    model,
    messages,
    temperature: opts.temperature ?? 0.7,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  };

  try {
    const res = await fetchJSON(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }, JSON.stringify(payload));

    if (res.status !== 200) {
      console.error('LLM error:', res.status, res.body);
      return null;
    }
    return res.body.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error('LLM fetch failed:', err.message);
    return null;
  }
}

async function smartSplitRequirement(text) {
  const prompt = `你是敏捷项目管理 AI 专家。将以下需求拆分为 Epic、用户故事(Story)和任务(Task)。
返回严格 JSON 格式：
{
  "epic": { "title": "...", "description": "..." },
  "stories": [{ "title": "...", "description": "...", "story_points": 3, "acceptance_criteria": "Given...When...Then..." }],
  "summary": "拆分说明"
}
每个 Story 的 story_points 使用斐波那契数列(1,2,3,5,8)。需求内容：
${text}`;

  const result = await chat([
    { role: 'system', content: '你是专业的敏捷教练，擅长 INVEST 原则拆分用户故事。只返回 JSON。' },
    { role: 'user', content: prompt },
  ], { json: true, temperature: 0.4 });

  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    if (parsed.stories?.length) {
      parsed.stories = parsed.stories.map(s => ({
        type: 'story', ai_generated: true,
        story_points: s.story_points || 3,
        priority: 2,
        ...s,
      }));
      parsed.epic = { type: 'epic', ai_generated: true, story_points: parsed.stories.reduce((a, s) => a + (s.story_points || 0), 0), ...parsed.epic };
      parsed.tasks = parsed.stories.flatMap(s => [
        { type: 'task', title: `[开发] ${s.title}`, parent_title: s.title },
        { type: 'task', title: `[测试] ${s.title}`, parent_title: s.title },
      ]);
      return parsed;
    }
  } catch { /* fallback */ }
  return null;
}

async function smartAnalyze(context, task) {
  const prompts = {
    standup: `根据以下项目数据生成今日站会摘要（Markdown格式，中文）：\n${context}`,
    risks: `分析以下项目数据的风险（Markdown格式，中文），给出等级和建议：\n${context}`,
    retro: `根据 Sprint 数据生成回顾报告（Markdown格式，中文）：\n${context}`,
    copilot: `你是 AgileAI 智能协作者。基于项目和用户上下文回答问题，给出具体可执行建议。使用 Markdown。\n\n上下文：\n${context}\n\n用户问题：${task}`,
    assign: `根据团队成员和待分配任务，推荐最佳执行人。返回 JSON: {"assignee":"姓名","reason":"原因"}\n\n${context}`,
  };

  const result = await chat([
    { role: 'system', content: '你是 AI 赋能敏捷项目管理专家，回答简洁专业。' },
    { role: 'user', content: prompts[task] || task },
  ], { temperature: task === 'assign' ? 0.3 : 0.6, json: task === 'assign' });

  return result;
}

module.exports = { isConfigured, chat, smartSplitRequirement, smartAnalyze };
