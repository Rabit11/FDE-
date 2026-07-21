/**
 * Smoke test FDE flow on 10.90.111.114:8084
 * Submit → progress → complete → reviewer terminate/reassign checks
 */
const BASE = process.env.FDE_BASE || 'http://10.90.111.114:8084';

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function login(emp_id, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_id, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `login ${res.status}`);
  return data;
}

async function api(token, path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { res, data };
}

async function main() {
  console.log(`Smoke against ${BASE}\n`);

  // 0) Public pages
  for (const p of ['/login.html', '/']) {
    const r = await fetch(`${BASE}${p}`);
    ok(`HTTP ${p}`, r.status === 200, `status=${r.status}`);
  }

  // 1) Login roles
  let leader, executor, otherLeader;
  try {
    leader = await login('600412', '600412'); // 曾锐
    ok('登录审核人(曾锐)', !!leader.token, leader.user?.name);
  } catch (e) {
    ok('登录审核人(曾锐)', false, e.message);
    printSummary();
    process.exit(1);
  }
  try {
    executor = await login('600785', '600785'); // 赵立泽
    ok('登录执行人(赵立泽)', !!executor.token, executor.user?.name);
  } catch (e) {
    ok('登录执行人(赵立泽)', false, e.message);
  }
  try {
    otherLeader = await login('600764', '600764'); // 张弛
    ok('登录另一审核人(张弛)', !!otherLeader.token, otherLeader.user?.name);
  } catch (e) {
    ok('登录另一审核人(张弛)', false, e.message);
  }

  // 2) List APIs
  {
    const { res, data } = await api(leader.token, '/items');
    ok('GET /items', res.ok && Array.isArray(data), `count=${Array.isArray(data) ? data.length : res.status}`);
  }
  {
    const { res, data } = await api(leader.token, '/metrics');
    ok('GET /metrics', res.ok && data && typeof data === 'object', JSON.stringify(data).slice(0, 80));
  }
  {
    const { res, data } = await api(leader.token, '/notifications');
    ok('GET /notifications', res.ok, `unread=${data?.unread ?? '?'}`);
  }
  {
    const { res, data } = await api(executor.token, '/items/my-work');
    ok('GET /items/my-work (执行人)', res.ok && Array.isArray(data), `count=${Array.isArray(data) ? data.length : res.status}`);
  }

  // 3) Submit requirement as proposer/executor
  const title = `冒烟流转-${Date.now()}`;
  let created;
  {
    const body = {
      title,
      description: '114 冒烟测试：提交→进展→完成',
      priority: 2,
      reviewer: '曾锐',
      assignee: '赵立泽',
      assistants: [],
      type: 'story',
    };
    const { res, data } = await api(executor.token, '/items', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    created = data;
    ok('POST 提交需求', res.ok && data?.id, data?.id || data?.error || res.status);
  }

  if (!created?.id) {
    printSummary();
    process.exit(1);
  }
  const id = created.id;

  // 4) Executor add progress
  {
    const { res, data } = await api(executor.token, `/items/${id}/progress`, {
      method: 'POST',
      body: JSON.stringify({ description: '冒烟：今日进展已提交', percent: 50 }),
    });
    ok('执行人提交进展', res.ok, data?.error || `status=${res.status}`);
  }

  // 5) Executor complete
  {
    const { res, data } = await api(executor.token, `/items/${id}/complete`, { method: 'POST', body: '{}' });
    ok('执行人标记完成→归档', res.ok && data?.status === 'done', data?.status || data?.error || res.status);
  }

  // 6) Own reviewer can revoke back to in_progress
  {
    const { res, data } = await api(leader.token, `/items/${id}/reviewer-revoke`, {
      method: 'POST',
      body: JSON.stringify({ comment: '冒烟退回' }),
    });
    // endpoint may be named differently — detect
    if (res.status === 404) {
      // try patch
      const p = await api(leader.token, `/items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress' }),
      });
      ok('审核人退回执行中(PATCH)', p.res.ok && p.data?.status === 'in_progress', p.data?.status || p.data?.error);
    } else {
      ok('审核人退回执行中', res.ok && (data?.status === 'in_progress' || data?.item?.status === 'in_progress'), data?.status || data?.error || res.status);
    }
  }

  // 7) Cross-reviewer terminate should be forbidden on dedicated route
  {
    const { res, data } = await api(otherLeader.token, `/items/${id}/reviewer-terminate`, {
      method: 'POST',
      body: JSON.stringify({ reason: '冒烟跨审测试' }),
    });
    if (res.status === 404) {
      ok('跨审核人终止(专用接口)', true, '接口不存在，跳过专用校验');
    } else {
      ok('跨审核人终止应拒绝', res.status === 403, `status=${res.status} ${data?.error || ''}`);
    }
  }

  // 8) Cross-reviewer PATCH status — known bug if allowed
  {
    const { res, data } = await api(otherLeader.token, `/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'terminated' }),
    });
    const blocked = res.status === 403;
    ok('跨审核人 PATCH 终止应拒绝', blocked, blocked ? '已正确拒绝' : `漏洞：status=${res.status} → ${data?.status}`);
  }

  // 9) Own reviewer reassign
  {
    // ensure in_progress first
    await api(leader.token, `/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'in_progress' }),
    });
    const { res, data } = await api(leader.token, `/items/${id}/reviewer-reassign`, {
      method: 'POST',
      body: JSON.stringify({ assignee: '王诗瑶', assistants: ['万贤书'] }),
    });
    if (res.status === 404) {
      ok('二次分配接口', false, '接口 404');
    } else {
      ok('本任务审核人二次分配', res.ok && data?.assignee === '王诗瑶', data?.assignee || data?.error || res.status);
    }
  }

  // 10) Cleanup — terminate own task
  {
    const { res, data } = await api(leader.token, `/items/${id}/reviewer-terminate`, {
      method: 'POST',
      body: JSON.stringify({ reason: '冒烟清理' }),
    });
    if (res.status === 404) {
      const p = await api(leader.token, `/items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'terminated' }),
      });
      ok('清理：终止冒烟任务', p.res.ok, p.data?.status || p.data?.error);
    } else {
      ok('清理：终止冒烟任务', res.ok, data?.status || data?.error || res.status);
    }
  }

  // 11) AI status (authenticated)
  {
    const { res, data } = await api(leader.token, '/ai/status');
    ok('GET /ai/status', res.ok, data?.llm ? `${data.llm.provider}` : `ok=${res.ok}`);
  }

  printSummary();
}

function printSummary() {
  const failed = results.filter((r) => !r.pass);
  console.log('\n======== SUMMARY ========');
  console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach((f) => console.log(` - ${f.name}: ${f.detail}`));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
