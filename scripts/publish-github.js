const { execSync, spawnSync } = require('child_process');
const https = require('https');
const path = require('path');

const REPO = 'FDE-';
const DESC = 'FDE管理平台 - 流动看板 / AI 协作者 / 四态任务流转';

function getCredential() {
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n',
    encoding: 'utf8',
  });
  const user = r.stdout.match(/username=(.+)/)?.[1]?.trim();
  const token = r.stdout.match(/password=(.+)/)?.[1]?.trim();
  if (!user || !token) throw new Error('No GitHub credentials found. Run: gh auth login');
  return { user, token };
}

function api(method, p, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: p, method,
      headers: {
        'User-Agent': 'agile-ai-platform',
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : {} }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const { user, token } = getCredential();
  console.log(`Authenticated as ${user}`);

  let res = await api('GET', `/repos/${user}/${REPO}`, token);
  if (res.status === 404) {
    console.log(`Creating repository ${user}/${REPO}...`);
    res = await api('POST', '/user/repos', token, { name: REPO, description: DESC, private: false, auto_init: false });
    if (res.status !== 201) throw new Error(`Create repo failed: ${res.status} ${JSON.stringify(res.body)}`);
    console.log('Repository created.');
  } else if (res.status === 200) {
    console.log('Repository already exists.');
  } else {
    throw new Error(`Check repo failed: ${res.status}`);
  }

  const root = path.join(__dirname, '..');
  const remote = `https://${user}:${token}@github.com/${user}/${REPO}.git`;

  try { execSync('git remote remove origin', { cwd: root, stdio: 'pipe' }); } catch {}
  execSync(`git remote add origin https://github.com/${user}/${REPO}.git`, { cwd: root, stdio: 'inherit' });
  execSync(`git remote set-url origin ${remote}`, { cwd: root, stdio: 'pipe' });

  execSync('git branch -M main', { cwd: root, stdio: 'inherit' });
  execSync('git push -u origin main', { cwd: root, stdio: 'inherit' });

  console.log(`\n✅ Published: https://github.com/${user}/${REPO}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
