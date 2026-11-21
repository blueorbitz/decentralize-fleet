#!/usr/bin/env node
// Offline end-to-end demo: the whole fleet loop, no Jira tenant, no harness.
//
// It starts an in-process Jira (the same mock the tests use, with real
// transition-precondition semantics), runs the real worker with the
// deterministic `script` adapter, and prints the board after each phase:
//
//   1. happy path   claim -> build -> push -> PR -> In Review
//   2. crash        a stale lease is requeued by the reaper
//   3. failure      the retry budget requeues once, then moves the ticket to Failed
//
// Run it with:  npm run demo
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockJira, DEFAULT_FIELDS } from '../test/helpers/mock-jira.js';
import { makeGitWorkspace } from '../test/helpers/git-fixture.js';
import { Worker, reap } from '../src/worker.js';
import { JiraClient } from '../src/jira.js';
import { Logger } from '../src/logger.js';

const RULE = '='.repeat(74);

function printBoard(mock, label) {
  console.log(`\n${label}`);
  console.log(RULE);
  const rows = [...mock.issues.keys()].sort().map((key) => mock.plain(key));
  for (const t of rows) {
    const worker = t.worker ? `worker=${t.worker}` : 'unclaimed';
    const pr = t.pr ? `  pr=${t.pr}` : '';
    const retry = t.retry ? `  retry=${t.retry}` : '';
    console.log(`  ${t.key.padEnd(8)} ${t.status.padEnd(16)} ${worker.padEnd(22)}${pr}${retry}`);
    if (t.branch) console.log(`           branch=${t.branch}`);
  }
  console.log(RULE);
}

// Each phase gets its own board and workspace so one phase cannot leak into the
// next; a demo that needs prior phases explained is not a demo.
async function withFleet(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  const ws = makeGitWorkspace();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-demo-'));
  const cfg = {
    command: 'run',
    verbose: false,
    jira: { baseUrl, email: 'bot@demo', token: 'demo', project: 'FLT', fields: DEFAULT_FIELDS },
    repo: { path: ws.workspace, remote: null, baseBranch: 'main' },
    worker: { id: 'worker-demo', adapter: 'script', adapterPath: null, once: true, pollMinMs: 1, pollMaxMs: 2 },
    timings: { leaseRefreshMs: 60_000, leaseStaleMs: 60_000, runTimeoutMs: 120_000 },
    retryBudget: 1,
    gitHost: { kind: 'local' },
    logFile: path.join(tmp, 'demo.log'),
  };
  const jira = new JiraClient({
    baseUrl,
    email: cfg.jira.email,
    token: cfg.jira.token,
    project: 'FLT',
    fields: DEFAULT_FIELDS,
  });
  const logger = new Logger({ file: cfg.logFile });
  const savedScriptEnv = Object.fromEntries(
    Object.keys(process.env)
      .filter((k) => k.startsWith('FLEET_SCRIPT_'))
      .map((k) => [k, process.env[k]]),
  );
  // Quieten the phase-independent chatter; the board prints are the story.
  const quiet = { info() {}, debug() {}, warn() {}, error() {}, close: () => logger.close() };

  try {
    return await fn({ mock, cfg, jira, ws, logger: quiet });
  } finally {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('FLEET_SCRIPT_')) delete process.env[key];
    }
    Object.assign(process.env, savedScriptEnv);
    await logger.close();
    await mock.stop();
    ws.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function phase1HappyPath() {
  console.log('\nPhase 1 — a worker polls, claims, builds, and opens a PR\n');
  await withFleet(async ({ mock, cfg, ws }) => {
    mock.addTicket({
      key: 'FLT-101',
      summary: 'Add CSV export to the usage report',
      status: 'Ready for Build',
      description: 'Customers need their usage data out.\n\nAcceptance criteria\n- CSV button\n- 50k rows fast',
    });
    mock.addTicket({ key: 'FLT-103', summary: 'Dark mode for the settings screen', status: 'Backlog' });
    printBoard(mock, 'Board — before any worker runs');

    process.env.FLEET_SCRIPT_FILE = 'FLEET_OUTPUT.md';
    process.env.FLEET_SCRIPT_CONTENT = '# done by the fleet\n';
    const worker = new Worker({ cfg, logger: { info() {}, debug() {}, warn() {}, error() {} } });
    const summary = await worker.pollOnce();

    printBoard(mock, `After one poll cycle — ${JSON.stringify(summary)}`);
    console.log(`\n  The harness wrote ${path.join(ws.workspace, 'FLEET_OUTPUT.md')}`);
    console.log('  A human reviews the PR and merges. The fleet never merges.');
  });
}

async function phase2Crash() {
  console.log('\nPhase 2 — a worker dies mid-run and the reaper self-heals the board\n');
  await withFleet(async ({ mock, cfg, jira }) => {
    mock.addTicket({ key: 'FLT-102', summary: 'Rate-limit the /export API', status: 'Ready for Build' });
    // Claim it as a worker that will never heartbeat again.
    await jira.claim('FLT-102', { workerId: 'worker-crashed', now: new Date(Date.now() - 30 * 60_000) });
    printBoard(mock, 'FLT-102 claimed 30 minutes ago — past the 15 minute staleness window');

    const summary = await reap({ cfg, jira, logger: { info() {}, warn() {} } });
    printBoard(mock, `After the scheduled reaper ran — ${JSON.stringify(summary)}`);

    const ticket = mock.plain('FLT-102');
    const comment = ticket.comments.at(-1);
    console.log(`\n  The reaper left a comment on FLT-102:\n    ${comment.split('\n')[0]}`);
  });
}

async function phase3Failure() {
  console.log('\nPhase 3 — the harness fails: one requeue, then Failed\n');
  await withFleet(async ({ mock, cfg }) => {
    mock.addTicket({ key: 'FLT-104', summary: 'A ticket the harness cannot solve', status: 'Ready for Build' });
    mock.addTicket({ key: 'FLT-105', summary: 'A ticket that works fine', status: 'Backlog' });
    printBoard(mock, 'Board — before the failing run');

    process.env.FLEET_SCRIPT_MODE = 'fail';
    const runOnce = async (label) => {
      const summary = await new Worker({ cfg, logger: { info() {}, debug() {}, warn() {}, error() {} } }).pollOnce();
      printBoard(mock, `${label} — ${JSON.stringify(summary)}`);
    };

    await runOnce('First failure: the retry budget is spent and the ticket is requeued');
    const ticket = mock.plain('FLT-104');
    console.log(`\n  Comment: ${ticket.comments.at(-1).split('\n')[0]}`);

    await runOnce('Second failure: the retry budget is exhausted, a human must decide');
    console.log('\n  Failed tickets are requeued from the Fleet panel or by hand — never automatically.');
  });
}

async function main() {
  await phase1HappyPath();
  await phase2Crash();
  await phase3Failure();
  console.log('\nDemo complete. This is the same protocol a real tenant runs, offline.');
}

main().catch((err) => {
  console.error(`demo crashed: ${err?.stack || err}`);
  process.exit(1);
});
