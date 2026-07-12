const fs = require('fs');
const path = require('path');

let pdfParse, mammoth;
try { pdfParse = require('pdf-parse'); } catch { /* optional */ }
try { mammoth = require('mammoth'); } catch { /* optional */ }

const SUPPORTED = {
  '.txt': 'text', '.md': 'text', '.markdown': 'text', '.csv': 'text',
  '.pdf': 'pdf', '.docx': 'docx', '.doc': 'docx',
};

function detectStructure(text) {
  const lines = text.split('\n');
  const sections = [];
  let current = { title: '概述', level: 1, content: [] };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const h1 = trimmed.match(/^#{1,3}\s+(.+)/);
    const h2 = trimmed.match(/^([一二三四五六七八九十]+[、.．]\s*.+)$/);
    const h3 = trimmed.match(/^(\d+[\.\、]\s*.+)$/);
    const h4 = trimmed.match(/^【(.+)】$/);

    if (h1 || h2 || h3 || h4) {
      if (current.content.length) sections.push({ ...current, content: current.content.join('\n') });
      current = {
        title: (h1?.[1] || h2?.[1] || h3?.[1] || h4?.[1] || trimmed).slice(0, 100),
        level: h1 ? (trimmed.match(/^#+/)[0].length) : 2,
        content: [],
      };
    } else {
      current.content.push(trimmed);
    }
  });
  if (current.content.length) sections.push({ ...current, content: current.content.join('\n') });
  return sections.length ? sections : [{ title: '全文', level: 1, content: text }];
}

function chunkSections(sections, maxChars = 6000) {
  const chunks = [];
  let buf = { title: '', content: '', sections: [] };

  sections.forEach(sec => {
    const block = `## ${sec.title}\n${sec.content}\n\n`;
    if ((buf.content + block).length > maxChars && buf.content) {
      chunks.push({ ...buf });
      buf = { title: sec.title, content: block, sections: [sec.title] };
    } else {
      buf.content += block;
      buf.sections.push(sec.title);
      if (!buf.title) buf.title = sec.title;
    }
  });
  if (buf.content) chunks.push(buf);
  return chunks.length ? chunks : [{ title: '全文', content: sections.map(s => s.content).join('\n'), sections: ['全文'] }];
}

async function parsePdf(filePath) {
  if (!pdfParse) throw new Error('PDF 解析模块未安装');
  const buffer = fs.readFileSync(filePath);
  const PDFParse = pdfParse.PDFParse || pdfParse;
  const parser = new PDFParse({ data: buffer });
  const data = await parser.getText();
  const info = await parser.getInfo?.().catch(() => null);
  return {
    text: (data.text || '').trim(),
    meta: { pages: info?.totalPages || data.totalPages || 0, type: 'pdf' },
  };
}

async function parseDocx(filePath) {
  if (!mammoth) throw new Error('DOCX 解析模块未安装');
  const result = await mammoth.extractRawText({ path: filePath });
  return {
    text: result.value.trim(),
    meta: { type: 'docx', warnings: result.messages?.length || 0 },
  };
}

function parseText(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
    throw new Error('文件编码异常，请使用 UTF-8 编码保存');
  }
  return { text: text.trim(), meta: { type: 'text' } };
}

async function parseDocument(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const type = SUPPORTED[ext];
  if (!type) throw new Error(`不支持的文件格式: ${ext}。支持 TXT/MD/CSV/PDF/DOCX`);

  let parsed;
  if (type === 'pdf') parsed = await parsePdf(filePath);
  else if (type === 'docx') parsed = await parseDocx(filePath);
  else parsed = parseText(filePath);

  if (!parsed.text.trim()) throw new Error('文档内容为空或无法提取文字');

  const sections = detectStructure(parsed.text);
  const chunks = chunkSections(sections);
  const wordCount = parsed.text.replace(/\s/g, '').length;

  return {
    text: parsed.text,
    sections,
    chunks,
    meta: {
      ...parsed.meta,
      filename: originalName,
      ext,
      wordCount,
      sectionCount: sections.length,
      chunkCount: chunks.length,
      estimatedReadingMin: Math.ceil(wordCount / 400),
    },
  };
}

function getSupportedFormats() {
  return Object.keys(SUPPORTED);
}

module.exports = { parseDocument, detectStructure, chunkSections, getSupportedFormats, SUPPORTED };
