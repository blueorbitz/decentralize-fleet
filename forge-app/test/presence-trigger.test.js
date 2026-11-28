import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/settings/store.js';
import { createSettingsService } from '../src/settings/service.js';
import { memoryPresenceStore } from '../src/presence/store.js';
import { createPresenceService } from '../src/presence/service.js';
import { createHeartbeatTrigger } from '../src/presence/trigger.js';

// The heartbeat webtrigger: the only unauthenticated surface a worker touches,
// so its bearer check is the whole boundary.

const quiet = { info() {}, warn() {}, error() {} };
const NOW = Date.parse('2026-01-01T12:00:00Z');

async function configured({ projects = ['1'] } = {}) {
  const settingsStore = memoryStore();
  const service = createSettingsService({ store: settingsStore, env: {}, now: () => new Date(NOW) });
  const tokens = {};
  for (const id of projects) {
    const projectKey = id === '1' ? 'FLT' : 'OPS';
    await service.save(id, { projectKey }, { projectKey, validate: false });
    tokens[id] = (await service.generateToken(id, 'ci')).value;
  }
  const presenceStore = memoryPresenceStore();
  const presence = createPresenceService({ store: presenceStore, now: () => NOW });
  return { settingsStore, tokens, presenceStore, presence };
}

function trigger({ settingsStore, presence, env = {}, legacyToken }) {
  return createHeartbeatTrigger({ settingsStore, presence, env, legacyToken, logger: quiet });
}

function post(handler, { token, body = '{}', method = 'POST' } = {}) {
  return handler({
    method,
    headers: token ? { Authorization: [`Bearer ${token}`] } : {},
    body,
  });
}

const beat = (extra = {}) =>
  JSON.stringify({ workerId: 'worker-04', machine: 'DESKTOP-A3', state: 'idle', ...extra });

test('an unconfigured installation explains itself with 503', async () => {
  const { presence } = await configured({ projects: [] });
  const handler = trigger({
    settingsStore: memoryStore(),
    presence,
  });

  const res = await post(handler);
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error, /not configured|no fleet/i);
});

test('a legacy token on an unconfigured install is still told to configure the fleet', async () => {
  const { presence } = await configured({ projects: [] });
  const handler = trigger({ settingsStore: memoryStore(), presence, legacyToken: 'site-token' });

  const res = await post(handler, { token: 'site-token', body: beat() });
  assert.equal(res.statusCode, 503);
});

test('an unknown bearer is refused with 401 once tokens exist', async () => {
  const { settingsStore, presence } = await configured();
  const handler = trigger({ settingsStore, presence });

  const res = await post(handler, { token: 'nope', body: beat() });
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['WWW-Authenticate'], 'Bearer');
});

test('a project token records the beat against its own project', async () => {
  const { settingsStore, presence, tokens } = await configured({ projects: ['1', '2'] });
  const handler = trigger({ settingsStore, presence });

  const res = await post(handler, { token: tokens['1'], body: beat({ state: 'running', ticket: 'FLT-101' }) });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.workerId, 'worker-04');
  assert.equal(body.lastSeen, new Date(NOW).toISOString());

  assert.deepEqual((await presence.list('1')).workers.map((w) => w.workerId), ['worker-04']);
  assert.deepEqual((await presence.list('2')).workers, []);

  const other = await post(handler, { token: tokens['2'], body: beat({ workerId: 'worker-99' }) });
  assert.equal(other.statusCode, 200);
  assert.deepEqual((await presence.list('2')).workers.map((w) => w.workerId), ['worker-99']);
});

test('a site-wide legacy token binds to the sole configured project', async () => {
  const { settingsStore, presence } = await configured();
  const handler = trigger({ settingsStore, presence, env: { FLEET_HEARTBEAT_TOKEN: 'site-token' } });

  const res = await post(handler, { token: 'site-token', body: beat() });
  assert.equal(res.statusCode, 200);
  assert.equal((await presence.list('1')).summary.online, 1);
});

test('a site-wide token with more than one project is ambiguous', async () => {
  const { settingsStore, presence } = await configured({ projects: ['1', '2'] });
  const handler = trigger({ settingsStore, presence, legacyToken: 'site-token' });

  const res = await post(handler, { token: 'site-token', body: beat() });
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /more than one project/i);
});

test('a bad body or worker id is refused with 400', async () => {
  const { settingsStore, presence, tokens } = await configured();
  const handler = trigger({ settingsStore, presence });

  const notJson = await post(handler, { token: tokens['1'], body: 'not json' });
  assert.equal(notJson.statusCode, 400);

  const badId = await post(handler, { token: tokens['1'], body: beat({ workerId: 'has space' }) });
  assert.equal(badId.statusCode, 400);
  assert.match(JSON.parse(badId.body).error, /workerId/);

  const array = await post(handler, { token: tokens['1'], body: '[]' });
  assert.equal(array.statusCode, 400);
});

test('only POST is accepted', async () => {
  const { settingsStore, presence, tokens } = await configured();
  const handler = trigger({ settingsStore, presence });

  const res = await post(handler, { token: tokens['1'], method: 'GET' });
  assert.equal(res.statusCode, 405);
});
