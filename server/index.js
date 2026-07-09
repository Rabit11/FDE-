const express = require('express');
const cors = require('cors');
const path = require('path');
const { queries } = require('./db');
const ai = require('./ai/engine');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Sprints ──
app.get('/api/sprints', (req, res) => res.json(queries.getSprints()));
app.post('/api/sprints', (req, res) => res.json(queries.createSprint(req.body)));

// ── Items (Backlog / Kanban) ──
app.get('/api/items', (req, res) => res.json(queries.getItems(req.query)));
app.get('/api/items/:id', (req, res) => {
  const item = queries.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});
app.post('/api/items', (req, res) => res.json(queries.createItem(req.body)));
app.patch('/api/items/:id', (req, res) => {
  const item = queries.updateItem(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});
app.delete('/api/items/:id', (req, res) => {
  queries.deleteItem(req.params.id);
  res.json({ ok: true });
});

// ── Acceptance ──
app.post('/api/items/:id/accept', (req, res) => {
  const { status, feedback } = req.body;
  const item = queries.updateItem(req.params.id, {
    acceptance_status: status,
    acceptance_feedback: feedback,
    status: status === 'accepted' ? 'done' : 'in_progress',
  });
  if (status === 'rejected' && feedback) {
    queries.createItem({
      type: 'story',
      title: `[返工] ${item.title}`,
      description: feedback,
      priority: 1,
      sprint_id: item.sprint_id,
      parent_id: item.id,
    });
  }
  res.json(item);
});

// ── Activity & Metrics ──
app.get('/api/activity', (req, res) => res.json(queries.getActivity(Number(req.query.limit) || 50)));
app.get('/api/metrics', (req, res) => res.json(queries.getMetrics()));

// ── AI Endpoints ──
app.post('/api/ai/split-requirement', (req, res) => {
  const { text, sprint_id } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: '请提供需求描述' });
  const result = ai.splitRequirement(text.trim());
  const epic = queries.createItem({ ...result.epic, sprint_id, status: 'backlog' });
  const createdStories = result.stories.map(s => {
    const story = queries.createItem({ ...s, sprint_id, parent_id: epic.id, status: 'backlog' });
    return story;
  });
  result.tasks.forEach(t => {
    const parent = createdStories.find(s => s.title === t.parent_title);
    queries.createItem({ type: 'task', title: t.title, parent_id: parent?.id, sprint_id, status: 'backlog', priority: 3 });
  });
  queries.saveInsight('split', 'AI 需求拆分', result.summary, 'info');
  res.json({ ...result, epic, stories: createdStories });
});

app.post('/api/ai/standup', (req, res) => res.json(ai.generateStandupSummary()));
app.post('/api/ai/risks', (req, res) => res.json(ai.analyzeRisks()));
app.post('/api/ai/retro', (req, res) => res.json(ai.generateRetro()));
app.get('/api/ai/insights', (req, res) => res.json(queries.getInsights()));

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🚀 AI 敏捷管理平台已启动`);
  console.log(`  📍 http://localhost:${PORT}\n`);
});
