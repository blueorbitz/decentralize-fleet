import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeartbeat } from '../src/heartbeat.js';

// The heartbeat is fire-and-forget by design: every assertion here is about
// what it sends, and that no failure ever reaches the run loop.

function recorder({ fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (fail) throw new Error('network down');
    return { status: 200 };
  };
  return { calls, fetchImpl };
}

function fakeTimers() {
  const state = { fn: null, cleared: null, unref: 0, interval: null };
  return {
    state,
    setIntervalImpl(fn, ms) {
      state.fn = fn;
      state.interval = ms;
      return { unref: () => { state.unref += 1; } };
    },
    clearIntervalImpl() {
      state.cleared = true;
    },
  };
}

const quiet = { debug() {}, warn() {}, error() {}, info() {} };

test('no URL means no heartbeat at all', () => {
  assert.equal(createHeartbeat({ workerId: 'w', token: 't' }), null);
});

test('a URL without an identity or token is refused', () => {
  assert.throws(() => createHeartbeat({ url: 'https://x', token: 't' }), /workerId/);
  assert.throws(() => createHeartbeat({ url: 'https://x', workerId: 'w' }), /token/);
});

test('start sends an idle beat with the bearer token, then beats on the interval', async () => {
  const { calls, fetchImpl } = recorder();
  const timers = fakeTimers();
  const hb = createHeartbeat({
    url: 'https://heartbeat.example',
    token: 'secret',
    workerId: 'worker-04',
    machine: 'DESKTOP-A3',
    adapter: 'opencode',
    version: '0.1.0',
    intervalMs: 30_000,
    fetchImpl,
    logger: quiet,
    setIntervalImpl: timers.setIntervalImpl,
    clearIntervalImpl: timers.clearIntervalImpl,
  });

  hb.start();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://heartbeat.example');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret');
  assert.deepEqual(calls[0].body, {
    workerId: 'worker-04',
    machine: 'DESKTOP-A3',
    state: 'idle',
    ticket: null,
    adapter: 'opencode',
    version: '0.1.0',
  });
  assert.equal(timers.state.interval, 30_000);
  assert.equal(timers.state.unref, 1);

  timers.state.fn();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 2);
});

test('setState marks the worker busy with the claimed ticket and idle again', async () => {
  const { calls, fetchImpl } = recorder();
  const hb = createHeartbeat({
    url: 'https://h',
    token: 't',
    workerId: 'w',
    machine: 'BOX',
    fetchImpl,
    logger: quiet,
    setIntervalImpl: () => ({ unref() {} }),
  });

  hb.setState('running', 'FLT-101');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.at(-1).body.state, 'running');
  assert.equal(calls.at(-1).body.ticket, 'FLT-101');

  hb.setState('idle');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.at(-1).body.state, 'idle');
  assert.equal(calls.at(-1).body.ticket, null);
});

test('stop sends an offline beat, clears the timer, and is idempotent', async () => {
  const { calls, fetchImpl } = recorder();
  const timers = fakeTimers();
  const hb = createHeartbeat({
    url: 'https://h',
    token: 't',
    workerId: 'w',
    fetchImpl,
    logger: quiet,
    setIntervalImpl: timers.setIntervalImpl,
    clearIntervalImpl: timers.clearIntervalImpl,
  });

  hb.start();
  await hb.stop();
  assert.equal(timers.state.cleared, true);
  assert.equal(calls.at(-1).body.state, 'offline');

  const before = calls.length;
  await hb.stop();
  assert.equal(calls.length, before);
});

test('a failing endpoint is logged once and never rejects', async () => {
  const warnings = [];
  const hb = createHeartbeat({
    url: 'https://h',
    token: 't',
    workerId: 'w',
    fetchImpl: recorder({ fail: true }).fetchImpl,
    logger: { ...quiet, warn: (m) => warnings.push(m) },
    setIntervalImpl: () => ({ unref() {} }),
  });

  await hb.stop();
  hb.setState('running', 'FLT-1');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /heartbeat failed/);
});
