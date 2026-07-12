const fs = require('fs');
const https = require('https');
const path = require('path');

const ASR_COMPAT = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const ASR_ASYNC = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';

const MODELS = {
  primary: process.env.ASR_MODEL || 'paraformer-v2',
  fallback: 'sensevoice-v1',
  realtime: 'paraformer-realtime-v2',
};

const AGILE_HOTWORDS = [
  'Story', 'Epic', 'Kanban', 'WIP', '站会',
  '验收', '需求', '用户故事', '敏捷', '阻塞', '看板', '执行中', '已归档', '已终止',
];

function getAsrKey() {
  return process.env.DASHSCOPE_API_KEY || null;
}

function isAsrConfigured() {
  return Boolean(getAsrKey());
}

function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 300000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ASR 请求超时')); });
    if (body) req.write(body);
    req.end();
  });
}

function buildMultipart(fields, fileField, filePath, filename, mimeType) {
  const boundary = '----AsrBoundary' + Date.now().toString(16);
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
  }
  const fileData = fs.readFileSync(filePath);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const tail = `\r\n--${boundary}--\r\n`;
  return { body: Buffer.concat([Buffer.from(parts.join('')), fileData, Buffer.from(tail)]), boundary };
}

function postProcessTranscript(text, segments = []) {
  let result = text.trim();
  result = result
    .replace(/\s+/g, ' ')
    .replace(/([，。！？；：])\s*/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n');

  AGILE_HOTWORDS.forEach(word => {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(re, word);
  });

  if (segments.length) {
    const lines = segments.map(s => {
      const t = s.text || s.transcript || '';
      const start = s.start != null ? `[${formatTime(s.start)}] ` : '';
      return start + t.trim();
    }).filter(Boolean);
    if (lines.length > 1) result = lines.join('\n');
  }

  return result.trim();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function transcribeCompatible(filePath, filename, mimeType, model) {
  const apiKey = getAsrKey();
  const fields = {
    model,
    language: 'zh',
    response_format: 'verbose_json',
    prompt: `专业敏捷项目管理会议录音。关键词：${AGILE_HOTWORDS.join('、')}`,
  };
  const { body, boundary } = buildMultipart(fields, 'file', filePath, filename, mimeType || 'audio/wav');

  const res = await httpRequest(`${ASR_COMPAT}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
    timeout: 300000,
  }, body);

  if (res.status !== 200) {
    throw new Error(res.body?.error?.message || res.body?.message || `兼容模式 ASR 错误 ${res.status}`);
  }

  const text = res.body.text || res.body.result?.text || '';
  const segments = res.body.segments || res.body.words || [];
  if (!text && !segments.length) throw new Error('转写结果为空');
  return {
    text: postProcessTranscript(text || segments.map(s => s.text).join(' '), segments),
    segments,
    model,
    provider: '阿里云 DashScope',
    mode: 'compatible',
  };
}

async function transcribeAsync(fileUrl, model) {
  const apiKey = getAsrKey();
  const payload = {
    model,
    input: { file_urls: [fileUrl] },
    parameters: {
      language_hints: ['zh', 'en'],
      enable_words: true,
      enable_itn: true,
      enable_punctuation: true,
    },
  };

  const submit = await httpRequest(ASR_ASYNC, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
  }, JSON.stringify(payload));

  const taskId = submit.body?.output?.task_id;
  if (!taskId) throw new Error(submit.body?.message || '异步转写任务提交失败');

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await httpRequest(`${ASR_ASYNC}?task_id=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const st = status.body?.output?.task_status;
    if (st === 'SUCCEEDED') {
      const resultUrl = status.body?.output?.results?.[0]?.transcription_url
        || status.body?.output?.result?.transcription_url;
      if (!resultUrl) throw new Error('未获取到转写结果 URL');
      const result = await httpRequest(resultUrl, {});
      const transcripts = result.body?.transcripts || result.body?.results || [];
      const text = transcripts.map(t => t.text || t.transcript || '').join('\n')
        || result.body?.text || JSON.stringify(result.body).slice(0, 500);
      const segments = transcripts.flatMap(t => t.sentences || t.segments || []);
      return {
        text: postProcessTranscript(text, segments),
        segments,
        model,
        provider: '阿里云 DashScope',
        mode: 'async',
      };
    }
    if (st === 'FAILED') throw new Error(status.body?.output?.message || '异步转写失败');
  }
  throw new Error('异步转写超时（>4分钟）');
}

async function transcribeQwenAudio(filePath, filename) {
  const apiKey = getAsrKey();
  const stat = fs.statSync(filePath);
  if (stat.size > 10 * 1024 * 1024) throw new Error('Qwen-Audio 仅支持 10MB 以内文件');

  const audioB64 = fs.readFileSync(filePath).toString('base64');
  const ext = path.extname(filename).slice(1) || 'wav';
  const mime = ext === 'mp3' ? 'audio/mpeg' : `audio/${ext}`;

  const payload = {
    model: 'qwen-audio-turbo',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '请将这段会议录音完整转写为中文文字，保留专业术语，按语义分段，不要遗漏内容。' },
        { type: 'audio', audio: `data:${mime};base64,${audioB64}` },
      ],
    }],
  };

  const res = await httpRequest('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 300000,
  }, JSON.stringify(payload));

  const text = res.body?.output?.choices?.[0]?.message?.content?.[0]?.text
    || res.body?.output?.text || res.body?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Qwen-Audio 转写失败');
  return { text: postProcessTranscript(text), segments: [], model: 'qwen-audio-turbo', provider: '通义千问 Audio', mode: 'multimodal' };
}

async function transcribeFile(filePath, filename, mimeType, options = {}) {
  const apiKey = getAsrKey();
  if (!apiKey) throw new Error('请配置 DASHSCOPE_API_KEY 启用语音转写');

  const publicBase = process.env.ASR_PUBLIC_BASE_URL;
  const stat = fs.statSync(filePath);
  const errors = [];

  if (publicBase) {
    try {
      const token = path.basename(filePath);
      const fileUrl = `${publicBase.replace(/\/$/, '')}/api/ai/temp-audio/${token}`;
      return await transcribeAsync(fileUrl, MODELS.primary);
    } catch (e) { errors.push(`async: ${e.message}`); }
  }

  for (const model of [MODELS.primary, MODELS.fallback]) {
    try {
      return await transcribeCompatible(filePath, filename, mimeType, model);
    } catch (e) { errors.push(`${model}: ${e.message}`); }
  }

  if (stat.size <= 10 * 1024 * 1024) {
    try {
      return await transcribeQwenAudio(filePath, filename);
    } catch (e) { errors.push(`qwen-audio: ${e.message}`); }
  }

  throw new Error(`所有转写引擎均失败: ${errors.join('; ')}`);
}

function getAsrInfo() {
  return {
    primary: MODELS.primary,
    fallback: MODELS.fallback,
    features: ['多模型级联', '方言/多语', '智能标点', '敏捷热词', '时间戳分段'],
    asyncEnabled: Boolean(process.env.ASR_PUBLIC_BASE_URL),
  };
}

module.exports = { isAsrConfigured, transcribeFile, getAsrInfo, MODELS, postProcessTranscript };
