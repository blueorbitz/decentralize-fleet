// Capture the panel mid-run: requeue the ticket, start a worker, record the
// panel while it is In Build, then let the worker finish.
//
// This is the only take that must be filmed concurrently with a real worker run,
// so it lives in its own script instead of the sequential capture pass.
//
//   node scripts/capture-live.mjs FLT-2
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_ROOT, VIEWPORT, launchBrowser, loadSession, recordTake } from './capture-lib.mjs';
import { sessionClient } from './jira-session.mjs';
import { loadEnvFile } from '../../fleet-worker/src/operator-config.js';

const REPO_ROOT = path.resolve(DEMO_ROOT, '..');
const site = 'https://captain-sage.atlassian.net';
const MARKERS = ['retry budget', 'acceptance criteria', 'run log'];

function looksLikePanel(body) {
  const lower = body.toLowerCase();
  return MARKERS.filter((m) => lower.includes(m)).length >= 2;
}

async function panelWithData(page, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const body = await frame.locator('body').innerText().catch(() => '');
      if (!looksLikePanel(body)) continue;
      // Wait for the resolver to answer: the grid starts as dashes.
      const status = /STATUS\s*\n+\s*([^\n]+)/i.exec(body)?.[1]?.trim();
      if (status && status !== '—') return { frame, body };
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function main() {
  const key = process.argv[2];
  if (!key) throw new Error('usage: capture-live.mjs <KEY>');

  const jira = sessionClient();
  const totals = await jira.transitions(key);
  if (totals.some((t) => /requeue/i.test(t.name))) {
    await jira.transition(key, totals.find((t) => /requeue/i.test(t.name)).name);
  }
  // Get it back to Ready for Build so the worker can claim it.
  let st = await jira.status(key);
  while (st.status !== 'Ready for Build') {
    const list = await jira.transitions(key);
    const next = list.find((t) => t.to?.name === 'Ready for Build');
    if (!next) throw new Error(`${key} cannot reach Ready for Build from ${st.status}`);
    await jira.transition(key, next.name);
    st = await jira.status(key);
  }
  console.log(`${key} is ${st.status}`);

  // Start the worker first, so the claim happens while we are watching.
  const { values } = loadEnvFile(REPO_ROOT);
  const child = spawn(
    process.execPath,
    [path.join(REPO_ROOT, 'fleet-worker', 'bin', 'fleet-run.js'), '--once'],
    {
      cwd: path.join(REPO_ROOT, 'fleet-worker'),
      env: { ...process.env, ...values, FLEET_WORKER_ID: 'worker-04' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const redact = (s) => String(s).replaceAll(values.JIRA_EMAIL || 'x', 'fleet-bot@acme.com');
  const lines = [];
  child.stdout.on('data', (d) => lines.push(...redact(d.toString()).split('\n').filter(Boolean)));
  child.stderr.on('data', (d) => lines.push(...redact(d.toString()).split('\n').filter(Boolean)));

  const browser = await launchBrowser();
  const events = await recordTake(browser, {
    name: 'panel-live',
    run: async (page, { log }) => {
      await page.goto(`${site}/browse/${key}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);

      const found = await panelWithData(page);
      if (!found) {
        log('warn', { message: 'panel never showed data' });
        return;
      }
      const { frame, body } = found;
      const status = /STATUS\s*\n+\s*([^\n]+)/i.exec(body)?.[1]?.trim();
      const worker = /WORKER\s*\n+\s*([^\n]+)/i.exec(body)?.[1]?.trim();
      log('state', { status, worker });

      // Frame the grid and then the run log.
      await frame.locator('text=WORKER').first().scrollIntoViewIfNeeded().catch(() => {});
      const box = await frame.locator('text=WORKER').first().boundingBox().catch(() => null);
      if (box) log('hover', { x: Math.round(box.x + 30), y: Math.round(box.y + 10) });
      await page.waitForTimeout(4000);

      const runLog = frame.locator('text=/Run log/i').first();
      if (await runLog.count()) {
        await runLog.scrollIntoViewIfNeeded().catch(() => {});
        const rb = await runLog.boundingBox();
        if (rb) log('hover', { x: Math.round(rb.x + 40), y: Math.round(rb.y + 14) });
        await page.waitForTimeout(5000);
      }
    },
  });
  console.log(`captured ${events.length} events`);

  await browser.close();

  const code = await new Promise((r) => child.on('close', r));
  fs.mkdirSync(path.join(DEMO_ROOT, 'public', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(DEMO_ROOT, 'public', 'logs', 'worker-04.log'), lines.join('\n'));
  console.log(`worker exited ${code}`);

  const after = await jira.status(key);
  console.log(`${key} ended ${after.status}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
