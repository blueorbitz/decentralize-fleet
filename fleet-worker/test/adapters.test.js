import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdapter, resolveAdapter, parseAdapterOutput } from '../src/adapter-runner.js';
import { parseOpencodeStream } from '../adapters/opencode.mjs';

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

test('opencode stream keeps the last assistant text and edited files', () => {
  const stream = [
    { type: 'step_start', sessionID: 'ses_1', part: { type: 'step-start' } },
    { type: 'tool_use', sessionID: 'ses_1', part: { tool: 'write', state: { input: { path: 'a.txt', content: 'x' } } } },
    { type: 'tool_use', sessionID: 'ses_1', part: { tool: 'edit', state: { input: { path: 'b.txt', oldString: 'x', newString: 'y' } } } },
    { type: 'tool_use', sessionID: 'ses_1', part: { tool: 'read', state: { input: { path: 'c.txt' } } } },
    { type: 'tool_use', sessionID: 'ses_1', part: { tool: 'shell', state: { input: { command: 'true' } } } },
    { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'first draft' } },
    { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'final answer' } },
    { type: 'step_finish', sessionID: 'ses_1', part: { reason: 'stop', cost: 0 } },
  ].map((o) => JSON.stringify(o)).join('\n');
  const parsed = parseOpencodeStream(`noise\n${stream}\n`);
  assert.equal(parsed.finalText, 'final answer');
  assert.equal(parsed.stopReason, 'stop');
  assert.equal(parsed.sessionId, 'ses_1');
  assert.equal(parsed.steps, 1);
  assert.deepEqual(parsed.editedFiles.sort(), ['a.txt', 'b.txt']);
  assert.deepEqual(parsed.errors, []);
});

test('opencode stream surfaces error events', () => {
  const stream = [
    { type: 'error', error: { type: 'provider.no-route', message: 'Model unavailable: opencode/nope' } },
  ].map((o) => JSON.stringify(o)).join('\n');
  const parsed = parseOpencodeStream(stream);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /Model unavailable/);
  assert.equal(parsed.finalText, '');
});

test('opencode stream tolerates partial lines', () => {
  const parsed = parseOpencodeStream('{"type":"text","part":{"type":"text","text":"half\n');
  assert.equal(parsed.finalText, '');
  assert.deepEqual(parsed.editedFiles, []);
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
