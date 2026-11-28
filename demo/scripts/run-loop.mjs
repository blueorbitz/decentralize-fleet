// Drive the demo ticket through the whole fleet protocol with real workers, then
// record the panel takes at each state.
//
// This is the happy path the video shows:
//   Triaged -> (dispatch in the panel) -> Ready for Build
//           -> (a worker claims it)     -> In Build
//           -> (the worker opens a PR)  -> In Review
//
// Each transition is recorded. The workers are the real CLI against the real
// tenant, so the branch and pull request are real.
//
//   node scripts/run-loop.mjs FLT-2
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_ROOT, VIEWPORT, launchBrowser, loadSession, recordTake } from './capture-lib.mjs';
import { loadEnvFile } from '../../fleet-worker/src/operator-config.js';

const REPO_ROOT = path.resolve(DEMO_ROOT, '..');
const WORKER = path.join(REPO_ROOT, 'fleet-worker', 'bin', 'fleet-worker.js');

const { values } = loadEnvFile(REPO_ROOT);
const env = { ...values, ...process.env };
const site = (env.JIRA_URL || 'https://captain-sage.atlassian.net').replace(/\/+$/, '');
const auth = `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_TOKEN}`).toString('base64')}`;

// Redaction: whatever address and site the operator configured must never reach
// a rendered log. Read from env rather than written literally, so this file
// carries no tenant-specific value.
const REDACT = [
  [new RegExp(env.JIRA_EMAIL || '\\bnever\\b', 'g'), 'fleet-bot@acme.com'],
  [site.replace('https://', ''), 'acme.atlassian.net'],
];

export function redact(text) {
  let out = String(text);
  for (const [from, to] of REDACT) out = out.replace(from, to);
  return out;
}

async function api(method, endpoint, body) {
  const res = await fetch(`${site}${endpoint}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function status(key) {
  const i = await api('GET', `/rest/api/3/issue/${key}?fields=status,labels,customfield_10215,customfield_10216`);
  return {
    status: i.fields.status.name,
    branch: i.fields.customfield_10215,
    pr: i.fields.customfield_10216,
  };
}

async function waitFor(key, wanted, { timeoutMs = 15 * 60_000, label = '' } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const now = await status(key);
    if (now.status !== last) {
      console.log(`  [${label}] ${key} is ${now.status}`);
      last = now.status;
    }
    if (now.status === wanted) return now;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`${key} never reached ${wanted} within ${Math.round(timeoutMs / 1000)}s`);
}

// A worker run, with its stdout captured and redacted to public/logs/.
function startWorker(name, extraEnv) {
  const args = [
    WORKER,
    'run',
    '--once',
    '--jira', env.JIRA_URL,
    '--email', env.JIRA_EMAIL,
    '--token', env.JIRA_TOKEN,
    '--project', env.FLEET_PROJECT || 'FLT',
    '--repo', env.FLEET_REPO,
    '--adapter', env.FLEET_ADAPTER || 'opencode',
    '--worker-id', name,
  ];
  if (env.FLEET_REMOTE) args.push('--remote', env.FLEET_REMOTE);
  if (env.FLEET_BB_WORKSPACE) args.push('--bb-workspace', env.FLEET_BB_WORKSPACE);
  if (env.FLEET_BB_REPO) args.push('--bb-repo', env.FLEET_BB_REPO);
  if (env.FLEET_BB_APP_PASSWORD) args.push('--bb-app-password', env.FLEET_BB_APP_PASSWORD);

  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...values, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  const collect = (d) => {
    for (const line of d.toString().split(/\r?\n/)) {
      if (line.trim()) lines.push(redact(line));
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  return { name, child, lines, done: new Promise((r) => child.on('close', r)) };
}

async function recordPanelStates(key, browser) {
  const steps = [];
  for (const [take, expect] of [
    ['panel-live', 'In Build'],
    ['panel-review', 'In Review'],
  ]) {
    process.stdout.write(`  recording ${take}… `);
    try {
      const events = await recordTake(browser, {
        name: take,
        run: async (page, { log }) => {
          await page.goto(`${site}/browse/${key}`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(7000);

          let frame = null;
          for (let i = 0; i < 25 && !frame; i += 1) {
            for (const f of page.frames()) {
              if (f === page.mainFrame()) continue;
              const body = await f.locator('body').innerText().catch(() => '');
              const lower = body.toLowerCase();
              if (lower.includes('retry budget') && lower.includes('acceptance criteria')) frame = f;
            }
            if (!frame) await page.waitForTimeout(500);
          }
          if (!frame) {
            log('warn', { message: 'panel not found' });
            return;
          }

          const text = await frame.locator('body').innerText();
          const lineAfter = (label) => {
            const lines = text.split('\n').map((l) => l.trim());
            const at = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
            return at === -1 ? null : lines.slice(at + 1).find((l) => l && l !== lines[at]) || null;
          };
          log('state', { expect, status: lineAfter('STATUS'), worker: lineAfter('WORKER') });

          // Move down the panel: grid, then the run log.
          const heading = frame.locator('text=Fleet').first();
          if (await heading.count()) {
            const b = await heading.boundingBox();
            if (b) log('hover', { x: Math.round(b.x + 20), y: Math.round(b.y + 10) });
          }
          await page.waitForTimeout(3500);
          const runLog = frame.locator('text=/Run log/i').first();
          if (await runLog.count()) {
            await runLog.scrollIntoViewIfNeeded().catch(() => {});
            const b = await runLog.boundingBox();
            if (b) log('hover', { x: Math.round(b.x + 30), y: Math.round(b.y + 8) });
            await page.waitForTimeout(3500);
          }
        },
      });
      console.log(`${events.length} events`);
      steps.push({ take, expect });
    } catch (err) {
      console.log(`FAILED: ${err.message.split('\n')[0]}`);
    }
  }
  return steps;
}

async function main() {
  const key = process.argv[2];
  if (!key) throw new Error('usage: run-loop.mjs <KEY>');

  fs.mkdirSync(path.join(DEMO_ROOT, 'public', 'logs'), { recursive: true });

  const start = await status(key);
  console.log(`${key} starts at ${start.status}`);
  if (start.status !== 'Ready for Build') {
    throw new Error(`${key} must be Ready for Build to start; it is ${start.status}`);
  }

  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, storageState: loadSession() });
  void context;

  console.log('\nstarting worker…');
  const worker = startWorker('worker-04', {});
  worker.child.on('close', () => {});

  // Record the panel while the worker is running.
  const inBuild = waitFor(key, 'In Build', { label: 'worker' }).catch((e) => {
    console.log(`  ${e.message}`);
    return null;
  });
  await inBuild;
  await recordPanelStates(key, browser);

  console.log('\nwaiting for the run to report…');
  const finished = await waitFor(key, 'In Review', { label: 'worker' });
  console.log(`  ${key} -> In Review`);
  console.log(`  branch: ${finished.branch || '(none)'}`);
  console.log(`  pr:     ${finished.pr || '(none)'}`);

  const code = await worker.done;
  fs.writeFileSync(path.join(DEMO_ROOT, 'public', 'logs', 'worker-04.log'), worker.lines.join('\n'));
  console.log(`\nworker exited ${code}; ${worker.lines.length} log lines captured (redacted)`);

  if (finished.pr) {
    const cfg = JSON.parse(fs.readFileSync(path.join(DEMO_ROOT, 'src', 'capture.json'), 'utf8'));
    cfg.takes = { ...cfg.takes, prUrl: finished.pr };
    fs.writeFileSync(path.join(DEMO_ROOT, 'src', 'capture.json'), `${JSON.stringify(cfg, null, 2)}\n`);
    console.log(`saved prUrl: ${finished.pr}`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
