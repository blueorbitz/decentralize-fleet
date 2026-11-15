import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdapter, resolveAdapter, parseAdapterOutput } from '../src/adapter-runner.js';

const baseInput = { ticket_key: 'FLT-1', repo_path: process.cwd(), base_branch: 'main' };

test('parseAdapterOutput picks the last JSON line', () => {
  assert.deepEqual(parseAdapterOutput('noise\n{"a":1}\n{"status":"ok"}\n'), { status: 'ok' });
  assert.equal(parseAdapterOutput('no json here'), null);
});

test('resolveAdapter throws for an unknown adapter', () => {
  assert.throws(() => resolveAdapter('does-not-exist'), /unknown adapter/);
});

test('script adapter returns an ok result', async () => {
  const res = await runAdapter({ adapter: 'script', input: baseInput, timeoutMs: 5000 });
  assert.equal(res.status, 'ok');
  assert.equal(res.adapter, 'script');
  assert.equal(res.exit_code, 0);
});

test('script adapter fail mode returns failed', async () => {
  process.env.FLEET_SCRIPT_MODE = 'fail';
  try {
    const res = await runAdapter({ adapter: 'script', input: baseInput, timeoutMs: 5000 });
    assert.equal(res.status, 'failed');
  } finally {
    delete process.env.FLEET_SCRIPT_MODE;
  }
});

test('kiro adapter reports not implemented', async () => {
  const res = await runAdapter({ adapter: 'kiro', input: baseInput, timeoutMs: 5000 });
  assert.equal(res.status, 'failed');
  assert.match(res.summary, /not implemented/);
});

test('adapter timeout is enforced', async () => {
  process.env.FLEET_SCRIPT_MODE = 'hang';
  process.env.FLEET_SCRIPT_HANG_MS = '5000';
  try {
    const res = await runAdapter({ adapter: 'script', input: baseInput, timeoutMs: 400 });
    assert.equal(res.status, 'failed');
    assert.equal(res.timed_out, true);
  } finally {
    delete process.env.FLEET_SCRIPT_MODE;
    delete process.env.FLEET_SCRIPT_HANG_MS;
  }
});
