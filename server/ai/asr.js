const fs = require('fs');
const path = require('path');
const https = require('https');

const ASR_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const ASR_MODEL = 'paraformer-v2';

function getAsrKey() {
  return process.env.DASHSCOPE_API_KEY || null;
}

function isAsrConfigured() {
  return Boolean(getAsrKey());
}

function buildMultipart(fields, fileField, filePath, filename, mimeType) {
  const boundary = '----FormBoundary' + Date.now().toString(16);
  const parts = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
  }

  const fileData = fs.readFileSync(filePath);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const tail = `\r\n--${boundary}--\r\n`;

  const buffers = [
    Buffer.from(parts.join('')),
    fileData,
    Buffer.from(tail),
  ];
  return { body: Buffer.concat(buffers), boundary };
}

async function transcribeFile(filePath, filename, mimeType) {
  const apiKey = getAsrKey();
  if (!apiKey) throw new Error('请配置 DASHSCOPE_API_KEY 启用语音转写（阿里云 Paraformer）');

  const { body, boundary } = buildMultipart(
    { model: ASR_MODEL, language: 'zh' },
    'file', filePath, filename, mimeType || 'audio/wav',
  );

  return new Promise((resolve, reject) => {
    const url = new URL(`${ASR_BASE}/audio/transcriptions`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 180000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(json.error?.message || json.message || `ASR 错误 ${res.statusCode}`));
            return;
          }
          const text = json.text || json.result?.text || json.output?.text || '';
          if (!text) reject(new Error('转写结果为空，请检查音频格式或 API 配置'));
          else resolve({ text, model: ASR_MODEL, provider: '阿里云 Paraformer' });
        } catch {
          reject(new Error(`ASR 响应解析失败: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('语音转写超时')); });
    req.write(body);
    req.end();
  });
}

module.exports = { isAsrConfigured, transcribeFile, ASR_MODEL };
