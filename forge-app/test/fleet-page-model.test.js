import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_AVATARS,
  buildPageState,
  formatAge,
  hoverLines,
  initials,
  machineLabel,
} from '../src/static/fleet-page/src/model.js';

// The Fleet page's decisions, without @forge/react or @forge/bridge.

const NOW = Date.parse('2026-01-01T12:00:00Z');

function worker(overrides = {}) {
  return {
    workerId: 'worker-04',
    machine: 'DESKTOP-A3',
    state: 'idle',
    ticket: null,
    adapter: 'opencode',
    version: '0.1.0',
    firstSeen: new Date(NOW - 60 * 60_000).toISOString(),
    lastSeen: new Date(NOW).toISOString(),
    ageMs: 0,
    online: true,
    ...overrides,
  };
}

test('online, busy and idle are counted separately, and busy sorts first upstream', () => {
  const state = buildPageState({
    project: { id: '1', key: 'FLT' },
    onlineWindowMs: 90_000,
    workers: [
      worker({ workerId: 'worker-07', machine: 'BUILD-BOX', state: 'idle' }),
      worker({ workerId: 'worker-04', state: 'running', ticket: 'FLT-101' }),
      worker({ workerId: 'worker-09', machine: 'OLD-BOX', online: false, ageMs: 120_000 }),
    ],
    recentlySeen: [worker({ workerId: 'worker-09', machine: 'OLD-BOX', online: false, ageMs: 120_000 })],
  });

  assert.deepEqual(state.summary, { online: 2, busy: 1, idle: 1 });
  assert.equal(state.tiles[0].key, 'online');
  assert.equal(state.tiles[0].value, 2);
  assert.equal(state.tiles[1].value, 1);
  assert.equal(state.tiles[2].value, 1);
  assert.equal(state.busy[0].id, 'worker-04');
  assert.equal(state.busy[0].ticket, 'FLT-101');
  assert.deepEqual(state.recently.map((w) => w.id), ['worker-09']);
  assert.equal(state.empty, false);
});

test('the Online tile hint names the machines and truncates a long roster', () => {
  const workers = Array.from({ length: MAX_AVATARS + 3 }, (_, i) =>
    worker({ workerId: `worker-${i}`, machine: `BOX-${i}` }),
  );
  const state = buildPageState({ workers, recentlySeen: [] });

  assert.equal(state.avatars.length, MAX_AVATARS);
  assert.equal(state.extraAvatars, 3);
  assert.match(state.tiles[0].hint, /BOX-0/);
  assert.match(state.tiles[0].hint, /\+\d+ more/);
});

test('no workers is an explicit empty state, and no phantom counts', () => {
  const state = buildPageState({ workers: [], recentlySeen: [] });
  assert.deepEqual(state.summary, { online: 0, busy: 0, idle: 0 });
  assert.equal(state.empty, true);
  assert.equal(state.avatars.length, 0);
  assert.match(state.tiles[0].hint, /No workers are beating/);
});

test('hover detail leads with the machine name and explains the state', () => {
  const running = hoverLines(worker({ state: 'running', ticket: 'FLT-101' }));
  assert.deepEqual(running, ['DESKTOP-A3', 'worker-04', 'Running FLT-101', 'Adapter: opencode (0.1.0)']);

  const idle = hoverLines(worker());
  assert.ok(idle.includes('Idle — waiting for work'));

  const offline = hoverLines(worker({ online: false, ageMs: 120_000 }));
  assert.ok(offline.includes('Last seen 2m ago'));
});

test('labels fall back sensibly and initials come from the machine or id', () => {
  assert.equal(machineLabel({}), 'unknown');
  assert.equal(machineLabel({ workerId: 'worker-1' }), 'worker-1');
  assert.equal(initials({ machine: 'BUILD BOX 2', workerId: 'worker-11' }), 'BB');
  assert.equal(initials({ machine: 'desktop', workerId: 'worker-07' }), '07');
  assert.equal(initials({ machine: 'X', workerId: 'worker-a' }), 'X');
});

test('ages render as stable short strings', () => {
  assert.equal(formatAge(undefined), 'unknown');
  assert.equal(formatAge(500), 'just now');
  assert.equal(formatAge(12_000), '12s ago');
  assert.equal(formatAge(90_000), '1m ago');
  assert.equal(formatAge(2 * 60 * 60_000), '2h ago');
  assert.equal(formatAge(25 * 60 * 60_000), '1d ago');
});
