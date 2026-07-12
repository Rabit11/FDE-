const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const asr = require('./asr');
const llm = require('./llm');
const { splitRequirement } = require('./engine');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

async function processVoiceFile(filePath, originalName, mimeType, user, queries, options = {}) {
  ensureUploadDir();
  const startTime = Date.now();
  const steps = [];

  // Step 1: 语音转文字
  let transcript, asrProvider;
  try {
    if (asr.isAsrConfigured()) {
      const result = await asr.transcribeFile(filePath, originalName, mimeType);
      transcript = result.text;
      asrProvider = `${result.provider} (${result.model})`;
      steps.push({ step: 'transcribe', status: 'ok', provider: asrProvider, model: result.model, mode: result.mode, segments: result.segments?.length || 0 });
    } else {
      throw new Error('未配置 DASHSCOPE_API_KEY');
    }
  } catch (err) {
    steps.push({ step: 'transcribe', status: 'error', error: err.message });
    throw err;
  }

  // Step 2: 大模型分析梳理 + 拆解任务
  let analysis, llmProvider;
  const cfg = llm.getConfig();
  if (cfg && llm.isConfigured()) {
    analysis = await llm.analyzeVoiceTranscript(transcript, user.name);
    if (analysis) {
      llmProvider = cfg.provider;
      steps.push({ step: 'analyze', status: 'ok', provider: llmProvider, model: cfg.model });
    }
  }

  if (!analysis) {
    const fallback = splitRequirement(transcript);
    analysis = {
      document: `# 语音需求文档\n\n## 转写原文\n\n${transcript}\n\n## AI 梳理\n\n${fallback.summary}`,
      epic: fallback.epic,
      stories: fallback.stories,
      tasks: fallback.tasks,
      summary: fallback.summary + ' [本地规则引擎]',
      keywords: [],
      priority: 'medium',
      risks: [],
      action_items: [],
    };
    steps.push({ step: 'analyze', status: 'fallback', provider: '本地规则引擎' });
  }

  // Step 3: 保存语音文档记录
  const docId = uuid();
  const voiceDoc = {
    id: docId,
    user_id: user.id,
    user_name: user.name,
    filename: originalName,
    transcript,
    document: analysis.document,
    summary: analysis.summary,
    keywords: analysis.keywords || [],
    priority: analysis.priority || 'medium',
    risks: analysis.risks || [],
    action_items: analysis.action_items || [],
    asr_provider: asrProvider,
    llm_provider: llmProvider || '本地规则引擎',
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
  };
  queries.saveVoiceDoc(voiceDoc);

  // Step 4: 自动创建任务（可选）
  let createdItems = { epic: null, stories: [], tasks: [] };
  if (options.autoCreate !== false) {
    const status = user.role === 'executor' ? 'submitted' : 'in_progress';

    createdItems.epic = queries.createItem({
      ...analysis.epic, status, created_by: user.name,
      description: analysis.document?.slice(0, 500) || analysis.epic.description,
    });

    createdItems.stories = (analysis.stories || []).map(s =>
      queries.createItem({
        ...s, parent_id: createdItems.epic.id,
        status, created_by: user.name,
      })
    );

    (analysis.tasks || []).forEach(t => {
      const parent = createdItems.stories.find(s => s.title === t.parent_title);
      createdItems.tasks.push(queries.createItem({
        type: 'task', title: t.title, parent_id: parent?.id,
        status: 'in_progress', priority: 3, created_by: user.name,
      }));
    });

    steps.push({ step: 'create_tasks', status: 'ok', count: createdItems.stories.length });
    queries.saveInsight('voice', `语音需求: ${analysis.epic.title}`, analysis.summary, 'info');
  }

  return {
    docId,
    transcript,
    document: analysis.document,
    summary: analysis.summary,
    keywords: analysis.keywords,
    priority: analysis.priority,
    risks: analysis.risks,
    action_items: analysis.action_items,
    epic: analysis.epic,
    stories: analysis.stories,
    createdItems,
    steps,
    duration_ms: Date.now() - startTime,
    engines: { asr: asrProvider, llm: llmProvider || '本地规则引擎' },
  };
}

module.exports = { processVoiceFile, UPLOAD_DIR };
