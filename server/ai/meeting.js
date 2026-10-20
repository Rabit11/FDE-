const { v4: uuid } = require('uuid');
const asr = require('./asr');
const docparse = require('./docparse');
const llm = require('./llm');
const { normalizeTaskTitle } = require('../db');

/** 从会议正文自动识别简短名称，并带上时间便于区分 */
function inferMeetingTitle(text, { source = 'text', filename = '' } = {}) {
  const raw = String(text || '').replace(/\r/g, '').trim();
  const time = new Date().toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const labeled = raw.match(/(?:主题|议题|标题|会议名称|需求名称|项目名称|任务名称)[：:]\s*(.+)/);
  let candidate = labeled ? labeled[1].trim() : '';
  if (!candidate) {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const skip = /^(#{1,6}\s*)?(会议记录|来源|时间|转写内容|字数|章节|期望|验收|场景)/;
    const hit = lines.find(l => !skip.test(l) && l.replace(/^[-*•\d.、）)\s#`]+/, '').length >= 4);
    candidate = (hit || '').replace(/^[-*•\d.、）)\s#`]+/, '').replace(/[*_`]/g, '').trim();
  }
  candidate = candidate.replace(/\s+/g, ' ').slice(0, 36);
  if (candidate.length >= 36) candidate = `${candidate.slice(0, 35)}…`;
  if (!candidate) {
    if (source === 'voice') return `语音会议 · ${time}`;
    if (source === 'document') {
      const base = String(filename || '').replace(/\.[^.]+$/, '').slice(0, 24);
      return base ? `${base} · ${time}` : `文档会议 · ${time}`;
    }
    return `文字记录 · ${time}`;
  }
  return `${candidate} · ${time}`;
}

function saveMeetingRecord(queries, user, data) {
  const doc = {
    id: uuid(),
    doc_type: 'meeting_record',
    status: 'saved',
    user_id: user.id,
    user_name: user.name,
    title: data.title || `会议记录 ${new Date().toLocaleString('zh-CN')}`,
    filename: data.filename || '',
    source_type: data.source_type || 'text',
    transcript: data.transcript || data.text || '',
    document: data.document || data.transcript || data.text || '',
    summary: data.summary || '',
    asr_provider: data.asr_provider || '',
    llm_provider: data.llm_provider || '',
    created_at: new Date().toISOString(),
  };
  queries.saveVoiceDoc(doc);
  return doc;
}

async function transcribeAndSave(filePath, originalName, mimeType, user, queries) {
  const result = await asr.transcribeFile(filePath, originalName, mimeType);
  return saveMeetingRecord(queries, user, {
    title: inferMeetingTitle(result.text, { source: 'voice', filename: originalName }),
    filename: originalName,
    source_type: 'voice',
    transcript: result.text,
    document: `# 会议记录\n\n> 来源：语音转写 · ${result.provider} (${result.model})\n> 时间：${new Date().toLocaleString('zh-CN')}\n\n## 转写内容\n\n${result.text}`,
    summary: result.text.slice(0, 120) + (result.text.length > 120 ? '...' : ''),
    asr_provider: `${result.provider} (${result.model})`,
  });
}

async function parseDocumentAndSave(filePath, originalName, user, queries) {
  const parsed = await docparse.parseDocument(filePath, originalName);
  return saveMeetingRecord(queries, user, {
    title: inferMeetingTitle(parsed.text, { source: 'document', filename: originalName }),
    filename: originalName,
    source_type: 'document',
    transcript: parsed.text,
    document: `# 会议记录\n\n> 来源：文档上传 · ${originalName}\n> 字数：${parsed.meta.wordCount} · 章节：${parsed.meta.sectionCount}\n\n${parsed.text}`,
    summary: parsed.text.slice(0, 120) + '...',
  });
}

async function saveTextRecord(text, user, queries, title) {
  if (!text?.trim()) throw new Error('会议记录内容不能为空');
  const autoTitle = title?.trim() || inferMeetingTitle(text, { source: 'text' });
  return saveMeetingRecord(queries, user, {
    title: autoTitle,
    source_type: 'text',
    transcript: text.trim(),
    document: `# 会议记录\n\n> 来源：手动输入\n> 时间：${new Date().toLocaleString('zh-CN')}\n\n${text.trim()}`,
    summary: text.trim().slice(0, 120) + (text.length > 120 ? '...' : ''),
  });
}

async function parseToRequirement(docId, user, queries) {
  const doc = queries.getVoiceDoc(docId);
  if (!doc) throw new Error('会议记录不存在');
  const content = doc.transcript || doc.document || '';
  if (!content.trim()) throw new Error('会议记录内容为空');

  const cfg = llm.getConfig();
  let parsed = null;

  if (cfg && llm.isConfigured()) {
    parsed = await llm.parseMeetingToRequirement(content, user.name);
  }

  if (!parsed) {
    const lines = content.split('\n').filter(l => l.trim());
    parsed = {
      title: normalizeTaskTitle(lines[0]?.slice(0, 80) || '新需求'),
      scene: content.slice(0, 500),
      acceptance: '待补充验收标准',
      deadline: '',
      summary: content.slice(0, 200),
      engine: 'local',
    };
  }

  doc.status = 'parsed';
  doc.parsed_requirement = parsed;
  doc.llm_provider = cfg?.provider || '本地规则';
  queries.updateVoiceDoc(docId, { status: doc.status, parsed_requirement: parsed, llm_provider: doc.llm_provider });

  return { doc, requirement: parsed };
}

module.exports = {
  saveMeetingRecord,
  transcribeAndSave,
  parseDocumentAndSave,
  saveTextRecord,
  parseToRequirement,
  inferMeetingTitle,
};
