import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockJira, DEFAULT_FIELDS } from './helpers/mock-jira.js';
import { makeGitWorkspace } from './helpers/git-fixture.js';
import { Worker } from '../src/worker.js';
import { Logger } from '../src/logger.js';
import { LocalGitHost } from '../src/git-host.js';

function makeCfg(baseUrl, repoPath, tmp) {
  return {
    command: 'run',
    verbose: false,
    jira: { baseUrl, email: 'b@x', token: 't', project: 'FLT', fields: DEFAULT_FIELDS },
    repo: { path: repoPath, remote: null, baseBranch: 'main' },
    worker: { id: 'worker-test', adapter: 'script', adapterPath: null, once: true, pollMinMs: 1, pollMaxMs: 2 },
    timings: { leaseRefreshMs: 60_000, leaseStaleMs: 60_000, runTimeoutMs: 30_000 },
    retryBudget: 1,
    gitHost: { kind: 'local' },
    logFile: path.join(tmp, 'worker.log'),
  };
}

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fleet-${tag}-`));
}

test('a full run claims, builds, opens a PR and lands In Review', async () => {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  const ws = makeGitWorkspace();
  const tmp = tmpdir('run');
  process.env.FLEET_SCRIPT_FILE = 'FLEET_OUTPUT.md';
  try {
    mock.addTicket({
      key: 'FLT-101',
      summary: 'Add CSV export to the usage report',
      status: 'Ready for Build',
      description: 'Customers need their usage data out.\n\nAcceptance criteria:\n- CSV button\n- 50k rows fast',
    });
    const cfg = makeCfg(baseUrl, ws.workspace, tmp);
    const host = new LocalGitHost();
    const logger = new Logger({ file: cfg.logFile });
    const worker = new Worker({ cfg, logger, gitHost: host });

    const summary = await worker.pollOnce();
    await logger.close();

    assert.equal(summary.completed, 1);
    const t = mock.plain('FLT-101');
    assert.equal(t.status, 'In Review');
    assert.equal(t.worker, 'worker-test');
    assert.match(t.branch, /^FLT-101-add-csv-export-to-the-usage-report$/);
    assert.equal(t.pr, host.pulls[0].url);
    assert.equal(host.pulls.length, 1);
    assert.match(host.pulls[0].title, /^FLT-101: Add CSV export/);
    assert.match(host.pulls[0].description, /Acceptance criteria/);
    assert.match(host.pulls[0].description, /- \[x\] CSV button/);
  } finally {
    delete process.env.FLEET_SCRIPT_FILE;
    await mock.stop();
    ws.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a failing harness requeues once, then moves the ticket to Failed', async () => {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  const ws = makeGitWorkspace();
  const tmp = tmpdir('fail');
  process.env.FLEET_SCRIPT_MODE = 'fail';
  try {
    mock.addTicket({ key: 'FLT-9', summary: 'Will fail', status: 'Ready for Build' });
    const cfg = makeCfg(baseUrl, ws.workspace, tmp);
    const worker = new Worker({ cfg, logger: new Logger({ file: cfg.logFile }) });

    const first = await worker.pollOnce();
    assert.equal(first.requeued, 1);
    assert.equal(mock.plain('FLT-9').status, 'Ready for Build');
    assert.equal(mock.plain('FLT-9').retry, 1);

    const second = await worker.pollOnce();
    assert.equal(second.failed, 1);
    assert.equal(mock.plain('FLT-9').status, 'Failed');
  } finally {
    delete process.env.FLEET_SCRIPT_MODE;
    await mock.stop();
    ws.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('losing the claim race is a clean skip, not an error', async () => {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  const ws = makeGitWorkspace();
  const tmp = tmpdir('race');
  try {
    mock.addTicket({ key: 'FLT-3', status: 'Ready for Build' });
    const cfg = makeCfg(baseUrl, ws.workspace, tmp);
    const worker = new Worker({ cfg, logger: new Logger({ file: cfg.logFile }) });

    const [ticket] = await worker.jira.findClaimable('project = FLT AND status = "Ready for Build"');
    await worker.jira.claim('FLT-3', { workerId: 'other' });

    const outcome = await worker.runTicket(ticket);
    assert.equal(outcome.status, 'lost');
    assert.equal(mock.plain('FLT-3').worker, 'other');
    assert.equal(mock.plain('FLT-3').status, 'In Build');
  } finally {
    await mock.stop();
    ws.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
