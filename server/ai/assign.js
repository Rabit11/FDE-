const { queries } = require('../db');
const llm = require('./llm');

function getWorkload(name) {
  const items = queries.getItems({ assignee: name });
  const active = items.filter(i => !['done', 'terminated', 'submitted'].includes(i.status));
  const blocked = active.filter(i => i.status === 'blocked').length;
  const points = active.reduce((s, i) => s + (i.story_points || 0), 0);
  const asAssistant = queries.getItems().filter(i =>
    (i.assistants || []).includes(name) && !['done', 'terminated', 'submitted'].includes(i.status)
  );
  return { activeCount: active.length, storyPoints: points, assistantCount: asAssistant.length, blocked, total: active.length + asAssistant.length * 0.5 };
}

function getHistoryText(userName) {
  const projects = queries.getUserProjects(userName);
  return projects.map(p => `${p.task_name} ${p.status} ${(p.assistants || []).join(' ')}`).join(' ').toLowerCase();
}

function scoreExecutor(user, task) {
  const w = getWorkload(user.name);
  const profile = user.profile || {};
  const skills = (profile.skills || []).join(' ').toLowerCase();
  const history = getHistoryText(user.name);
  const taskText = `${task.title} ${task.description || ''}`.toLowerCase();

  let skillScore = 0;
  const keywords = taskText.split(/[\s,，、。；;]+/).filter(k => k.length > 1);
  keywords.forEach(k => {
    if (skills.includes(k) || history.includes(k)) skillScore += 2;
  });

  const availBonus = { available: 10, limited: 5, busy: 0 }[profile.availability] ?? 5;
  const maxWip = profile.max_wip || 4;
  const loadPenalty = Math.max(0, w.total - maxWip) * 5;
  const blockedPenalty = w.blocked * 3;
  const loadScore = Math.max(0, 20 - w.total * 3 - w.storyPoints);

  const total = skillScore + availBonus + loadScore - loadPenalty - blockedPenalty;
  return {
    name: user.name,
    score: Math.round(total * 10) / 10,
    workload: w,
    skillScore,
    loadScore,
    availability: profile.availability || 'available',
    reason: `负载 ${w.total} 项(${w.storyPoints}SP, 阻塞${w.blocked}) · 背景匹配 ${skillScore} · ${profile.availability || 'available'}`,
  };
}

async function intelligentAssign(taskId, teamSize = 2) {
  const task = queries.getItem(taskId);
  if (!task) return null;

  const assistantCount = Math.max(0, Math.min(5, (teamSize || 2) - 1));

  const executors = queries.getUsersRaw().filter(u =>
    u.active !== false &&
    (u.capabilities || []).includes('executor') &&
    !(u.capabilities || []).includes('reviewer')
  );

  const scored = executors.map(u => scoreExecutor(u, task)).sort((a, b) => b.score - a.score);
  if (!scored.length) return { primary: null, assistants: [], reason: '无可用执行人员', scores: [] };

  const primary = scored[0];
  const assistants = scored.slice(1, 1 + assistantCount).filter(s => s.score > 0);

  let llmReason = null;
  if (llm.isConfigured()) {
    const context = JSON.stringify({
      task: { title: task.title, description: task.description, req_no: task.req_no },
      team_size: teamSize,
      assistant_count: assistantCount,
      candidates: scored.slice(0, 10).map(s => ({
        name: s.name, score: s.score, workload: s.workload,
        projects: queries.getUserProjects(s.name).slice(0, 5),
      })),
    });
    const result = await llm.smartAnalyze(context, 'assign');
    if (result) {
      try {
        const parsed = JSON.parse(result.replace(/```json\n?|\n?```/g, '').trim());
        if (parsed.assignee) {
          return {
            primary: parsed.assignee,
            assistants: (parsed.assistants || []).slice(0, assistantCount),
            reason: parsed.reason || primary.reason,
            scores: scored,
            engine: 'llm',
            team_size: teamSize,
          };
        }
      } catch {
        llmReason = result;
      }
    }
  }

  return {
    primary: primary.name,
    assistants: assistants.map(a => a.name),
    reason: llmReason || `主执行 ${primary.name}，协助 ${assistants.map(a => a.name).join('、') || '无'}。${primary.reason}`,
    scores: scored,
    engine: 'algorithm',
    team_size: teamSize,
  };
}

module.exports = { intelligentAssign, getWorkload, scoreExecutor };
