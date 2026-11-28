import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryPresenceStore } from '../src/presence/store.js';
import { createPresenceService } from '../src/presence/service.js';
import {
  ONLINE_WINDOW_MS,
  PresenceError,
  ageMs,
  isOnline,
  normalizeBeat,
  presenceKey,
} from '../src/presence/schema.js';

// The registry's rules, driven without Forge or HTTP.

const NOW = Date.parse('2026-01-01T12:00:00Z');

function service() {
  const store = memoryPresenceStore();
  let clock = NOW;
  const presence = createPresenceService({ store, now: () => clock });
  return {
    store,
    presence,
    advance: (ms) => { clock += ms; },
  };
}

test('a heartbeat is validated and shaped server-side', () => {
  const beat = normalizeBeat(
    { workerId: 'worker-04', machine: 'DESKTOP-A3\u0000', state: 'running', ticket: 'FLT-101', adapter: 'opencode' },
    { projectId: '1', now: new Date(NOW) },
  );

  assert.deepEqual(beat, {
    projectId: '1',
    workerId: 'worker-04',
    machine: 'DESKTOP-A3',
    state: 'running',
    ticket: 'FLT-101',
    adapter: 'opencode',
    version: null,
    firstSeen: new Date(NOW).toISOString(),
    lastSeen: new Date(NOW).toISOString(),
  });
});

test('a bad or missing worker id is refused', () => {
  assert.throws(() => normalizeBeat({}, { projectId: '1' }), PresenceError);
  assert.throws(() => normalizeBeat({ workerId: 'has space' }, { projectId: '1' }), /may contain/);
  assert.throws(() => normalizeBeat({ workerId: '-nope' }, { projectId: '1' }), /may contain/);
});

test('unknown states fall back to idle and machine falls back to the worker id', () => {
  const beat = normalizeBeat({ workerId: 'worker-09', state: 'sleeping' }, { projectId: '1', now: new Date(NOW) });
  assert.equal(beat.state, 'idle');
  assert.equal(beat.machine, 'worker-09');
});

test('the online window and age use server time', () => {
  const record = { state: 'running', lastSeen: new Date(NOW - ONLINE_WINDOW_MS).toISOString() };
  assert.equal(ageMs(record, { now: NOW }), ONLINE_WINDOW_MS);
  assert.equal(isOnline(record, { now: NOW }), true);
  assert.equal(isOnline(record, { now: NOW + 1 }), false);
  assert.equal(isOnline({ ...record, state: 'offline' }, { now: NOW }), false);
  assert.equal(isOnline({ lastSeen: 'not-a-date' }, { now: NOW }), false);
});

test('busy and idle workers are counted separately and busy sorts first', async () => {
  const { presence } = service();
  await presence.record('1', { workerId: 'worker-07', machine: 'BUILD-BOX', state: 'idle' });
  await presence.record('1', { workerId: 'worker-04', machine: 'DESKTOP-A3', state: 'running', ticket: 'FLT-101' });

  const page = await presence.list('1');

  assert.deepEqual(page.summary, { online: 2, busy: 1, idle: 1 });
  assert.equal(page.workers[0].workerId, 'worker-04');
  assert.equal(page.workers[0].ticket, 'FLT-101');
  assert.equal(page.workers[0].online, true);
  assert.equal(page.workers[0].machine, 'DESKTOP-A3');
  assert.equal(page.onlineWindowMs, ONLINE_WINDOW_MS);
});

test('a worker that stops beating drops out of online and into recently seen', async () => {
  const { presence, advance } = service();
  await presence.record('1', { workerId: 'worker-04', state: 'running', ticket: 'FLT-101' });

  advance(ONLINE_WINDOW_MS + 1);
  const page = await presence.list('1');

  assert.deepEqual(page.summary, { online: 0, busy: 0, idle: 0 });
  assert.equal(page.workers[0].online, false);
  assert.equal(page.recentlySeen.length, 1);
  assert.equal(page.recentlySeen[0].workerId, 'worker-04');
});

test('an offline beat is immediately not online', async () => {
  const { presence } = service();
  await presence.record('1', { workerId: 'worker-04', state: 'idle' });
  await presence.record('1', { workerId: 'worker-04', state: 'offline' });

  const page = await presence.list('1');
  assert.equal(page.summary.online, 0);
  assert.deepEqual(page.recentlySeen.map((w) => w.workerId), ['worker-04']);
});

test('firstSeen survives later beats and project records are isolated', async () => {
  const { presence, advance } = service();
  const first = await presence.record('1', { workerId: 'worker-04', machine: 'A', state: 'idle' });
  advance(60_000);
  const second = await presence.record('1', { workerId: 'worker-04', machine: 'A-renamed', state: 'running' });

  assert.equal(second.firstSeen, first.firstSeen);
  assert.equal(second.lastSeen, new Date(NOW + 60_000).toISOString());
  assert.equal(second.machine, 'A-renamed');

  await presence.record('2', { workerId: 'worker-99', state: 'idle' });
  const page1 = await presence.list('1');
  const page2 = await presence.list('2');
  assert.deepEqual(page1.workers.map((w) => w.workerId), ['worker-04']);
  assert.deepEqual(page2.workers.map((w) => w.workerId), ['worker-99']);
});

test('prune removes records older than the retention window', async () => {
  const { presence, advance } = service();
  await presence.record('1', { workerId: 'worker-04' });
  advance(25 * 60 * 60_000);

  const result = await presence.prune('1', 24 * 60 * 60_000);
  assert.equal(result.removed, 1);
  assert.equal((await presence.list('1')).workers.length, 0);
});

test('the key scheme keeps projects apart', () => {
  assert.equal(presenceKey('10001', 'worker-04'), 'fleet:presence:10001:worker-04');
});
