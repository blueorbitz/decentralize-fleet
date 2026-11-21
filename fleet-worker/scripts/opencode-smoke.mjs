#!/usr/bin/env node
// Gated end-to-end smoke test for the opencode adapter.
//
// It drives the *actual* opencode CLI through the whole worker protocol: a
// scratch repo with a failing test is handed to opencode as the fleet adapter,
// the agent fixes the bug, and the worker lands the ticket In Review with a PR.
//
// Run it with:  npm run smoke:opencode
// Override the model with OPENCODE_MODEL (default opencode/beam-free, the free
// model used for testing). Skip it by leaving it uninvoked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MockJira, DEFAULT_FIELDS } from '../test/helpers/mock-jira.js';
import { makeGitWorkspace } from '../test/helpers/git-fixture.js';
import { Worker } from '../src/worker.js';
import { Logger } from '../src/logger.js';
import { LocalGitHost } from '../src/git-host.js';

function opencodeAvailable() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(finder, ['opencode'], { encoding: 'utf8' }).status === 0;
}

// A tiny repo with a deliberate bug and a test that fails because of it.
function seedBuggyRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'scratch-app', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2),
  );
  fs.writeFileSync(path.join(dir, 'sum.js'), 'export function sum(a, b) {\n  return a - b; // BUG: should be a + b\n}\n');
  fs.writeFileSync(
    path.join(dir, 'sum.test.js'),
    ["import test from 'node:test';", "import assert from 'node:assert/strict';", "import { sum } from './sum.js';", '', "test('sum adds two numbers', () => {", '  assert.equal(sum(2, 3), 5);', '});', ''].join('\n'),
  );
}

async function main() {
  if (!opencodeAvailable()) {
    console.error('SKIP: opencode not found on PATH — cannot run the opencode smoke test.');
    process.exit(0);
  }

  const mock = new MockJira();
  const baseUrl = await mock.start();
  const ws = makeGitWorkspace({ seed: seedBuggyRepo });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-opencode-smoke-'));
  const runLog = path.join(tmp, 'run.log');

  const cfg = {
    command: 'run',
    verbose: false,
    jira: { baseUrl, email: 'bot@x', token: 't', project: 'FLT', fields: DEFAULT_FIELDS },
    repo: { path: ws.workspace, remote: null, baseBranch: 'main' },
    worker: { id: 'worker-smoke', adapter: 'opencode', adapterPath: null, once: true, pollMinMs: 1, pollMaxMs: 2 },
    timings: { leaseRefreshMs: 60_000, leaseStaleMs: 60_000, runTimeoutMs: 900_000 },
    retryBudget: 1,
    gitHost: { kind: 'local' },
    logFile: runLog,
  };

  let failed = false;
  const check = (label, cond, extra = '') => {
    if (cond) {
      console.log(`  PASS  ${label}`);
    } else {
      failed = true;
      console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
    }
  };

  try {
    mock.addTicket({
      key: 'FLT-101',
      summary: 'Fix sum() so it adds instead of subtracts',
      status: 'Ready for Build',
      description: 'The sum(a, b) helper returns the wrong result.\n\nAcceptance criteria:\n- sum(2, 3) === 5\n- the test suite passes',
    });

    const host = new LocalGitHost();
    const logger = new Logger({ verbose: true, file: runLog });
    const worker = new Worker({ cfg, logger, gitHost: host });

    console.log(`Running the full worker protocol with the opencode adapter (model=${process.env.OPENCODE_MODEL || 'opencode/beam-free'})…\n`);
    const summary = await worker.pollOnce();
    await logger.close();

    const ticket = mock.plain('FLT-101');
    const fixed = fs.readFileSync(path.join(ws.workspace, 'sum.js'), 'utf8');
    const tests = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test', '--silent'], {
      cwd: ws.workspace,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });

    console.log('\nResults:');
    check('worker completed the run', summary.completed === 1, JSON.stringify(summary));
    check('ticket reached In Review', ticket.status === 'In Review', ticket.status);
    check('claim recorded the worker id', ticket.worker === 'worker-smoke', String(ticket.worker));
    check('a pull request was opened', host.pulls.length === 1 && Boolean(ticket.pr));
    check('opencode changed sum() to add', /a\s*\+\s*b/.test(fixed), fixed.trim());
    check('repo tests pass after the run', tests.status === 0, (tests.stdout || tests.stderr || '').slice(-400));
    console.log(`\nRun log: ${runLog}`);
  } finally {
    await mock.stop();
    ws.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`smoke crashed: ${err?.stack || err}`);
  process.exit(1);
});
