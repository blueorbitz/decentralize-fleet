import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpTrigger, resolveTokenProject } from '../src/mcp-trigger.js';
import { memoryStore } from '../src/settings/store.js';
import { createSettingsService } from '../src/settings/service.js';
import { normalizeRecord, defaultRecord } from '../src/settings/schema.js';

// The MCP trigger used to compare one env token. It now resolves a bearer to a
// project, so one webtrigger can serve every project without an MCP argument.

const quiet = { info() {}, warn() {}, error() {} };

function serverSpy() {
  const calls = [];
  return {
    calls,
    makeServer: async ({ projectId, siteWide }) => {
      calls.push({ projectId, siteWide });
      return {
        handle: (msg) => {
          if (msg.id === undefined || msg.id === null) return null;
          return { jsonrpc: '2.0', id: msg.id, result: { bound: projectId } };
        },
      };
    },
  };
}

async function configuredStore() {
  const store = memoryStore();
  const service = createSettingsService({ store, env: {}, now: () => new Date('2026-01-01T00:00:00Z') });
  await service.save('1', { projectKey: 'FLT' }, { projectKey: 'FLT', validate: false });
  await service.save('2', { projectKey: 'OPS' }, { projectKey: 'OPS', validate: false });
  return { store, service };
}

function post(handler, { token, body = '{}', method = 'POST' } = {}) {
  return handler({
    method,
    headers: token ? { Authorization: [`Bearer ${token}`] } : {},
    body,
  });
}

test('with no configured project at all, the trigger explains itself with 503', async () => {
  const handler = createMcpTrigger({ store: memoryStore(), env: {}, makeServer: serverSpy().makeServer, logger: quiet });
  const res = await post(handler);
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error.message, /not configured|no fleet/i);
});

test('an unknown bearer is refused with 401 when some project has tokens', async () => {
  const { store, service } = await configuredStore();
  await service.generateToken('1', 'ci');
  const handler = createMcpTrigger({ store, env: {}, makeServer: serverSpy().makeServer, logger: quiet });

  const res = await post(handler, { token: 'not-a-real-token' });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.headers['WWW-Authenticate'], 'Bearer');
});

test('a project token binds the session to its own project', async () => {
  const { store, service } = await configuredStore();
  const flt = await service.generateToken('1', 'flt-ci');
  const ops = await service.generateToken('2', 'ops-ci');

  const spell = serverSpy();
  const handler = createMcpTrigger({ store, env: {}, makeServer: spell.makeServer, logger: quiet });

  const asFlt = await post(handler, {
    token: flt.value,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(asFlt.statusCode, 200);

  const asOps = await post(handler, {
    token: ops.value,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  assert.equal(asOps.statusCode, 200);

  assert.deepEqual(spell.calls.map((c) => c.projectId), ['1', '2']);
});

test('a legacy site-wide env token still works and binds to no project', async () => {
  const { store } = await configuredStore();
  const spell = serverSpy();
  const handler = createMcpTrigger({
    store,
    env: {},
    legacyToken: 'site-token',
    makeServer: spell.makeServer,
    logger: quiet,
  });

  const res = await post(handler, {
    token: 'site-token',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(spell.calls, [{ projectId: null, siteWide: true }]);
});

test('an authorize-but-GET probe returns an event stream, as before', async () => {
  const { store, service } = await configuredStore();
  const token = await service.generateToken('1', 'stream');
  const handler = createMcpTrigger({ store, env: {}, makeServer: serverSpy().makeServer, logger: quiet });

  const res = await post(handler, { token: token.value, method: 'GET' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.headers['Content-Type'], ['text/event-stream']);
});

test('resolveTokenProject finds a match and reports none for a stranger', async () => {
  const { store, service } = await configuredStore();
  const token = await service.generateToken('2', 'ops');

  assert.deepEqual(
    await resolveTokenProject({ store, bearer: token.value }),
    { projectId: '2', projectKey: 'OPS' },
  );
  assert.equal(await resolveTokenProject({ store, bearer: 'nope' }), null);
  assert.equal(await resolveTokenProject({ store, bearer: '' }), null);
});
