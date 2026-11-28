import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, FIELDS } from './helpers/mock-jira.js';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { loadConfig } from '../src/config.js';
import { createMcpServer } from '../src/mcp.js';
import { reap } from '../src/reaper.js';
import { createFleetResolver } from '../src/resolver.js';
import { handler } from '../src/backend/index.js';

// These tests cover the resolver functions the Custom UI actually invokes:
// `invoke('fleet.panel')`, `invoke('fleet.dispatch')`, `invoke('fleet.requeue')`.
// They run the real bodies against the mock Jira rather than re-deriving the
// model, so a change to a resolver is a change this test sees.

const quiet = { info() {}, warn() {}, error() {} };

async function withResolver(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  try {
    const cfg = loadConfig({});
    const jira = new JiraClient({
      transport: basicTransport({ baseUrl, email: 'b@acme.com', token: 'x' }),
      project: 'FLT',
      fields: FIELDS,
    });
    return await fn({ mock, jira, cfg, resolver: createFleetResolver({ jira, cfg }) });
  } finally {
    await mock.stop();
  }
}

const onIssue = (key, payload) => ({ context: { extension: { issue: { key } } }, payload });

test('fleet.panel renders the ticket the panel was opened on', async () => {
  await withResolver(async ({ mock, resolver }) => {
    mock.addTicket({
      key: 'FLT-501',
      status: 'In Build',
      summary: 'Add CSV export',
      description: 'Do it.\n\nAcceptance criteria\n- CSV downloads\n- Headers match',
      fields: { [FIELDS.worker]: 'worker-04', [FIELDS.lease]: new Date().toISOString() },
    });

    const model = await resolver['fleet.panel'](onIssue('FLT-501'));

    assert.equal(model.key, 'FLT-501');
    assert.equal(model.worker, 'worker-04');
    assert.equal(model.actions.canRequeue, true);
    assert.deepEqual(model.acceptanceCriteria, ['CSV downloads', 'Headers match']);
  });
});

test('fleet.dispatch moves the ticket to Ready and explains itself in a comment', async () => {
  await withResolver(async ({ mock, resolver }) => {
    mock.addTicket({ key: 'FLT-502', status: 'Triaged', labels: [] });

    const result = await resolver['fleet.dispatch'](onIssue('FLT-502'));

    assert.equal(result.status, 'Ready for Build');
    const after = mock.plain('FLT-502');
    assert.equal(after.status, 'Ready for Build');
    assert.equal(after.worker, null);
    assert.ok(after.comments.some((c) => c.body.includes('Dispatched from the Fleet panel')));
  });
});

test('fleet.requeue clears a live claim and records the reason', async () => {
  await withResolver(async ({ mock, jira, resolver }) => {
    mock.addTicket({ key: 'FLT-503', status: 'Ready for Build' });
    await jira.claim('FLT-503', { workerId: 'worker-01' });

    await resolver['fleet.requeue'](onIssue('FLT-503', { reason: 'wrong ticket' }));

    const after = mock.plain('FLT-503');
    assert.equal(after.status, 'Ready for Build');
    assert.equal(after.worker, null);
    assert.equal(after.lease, null);
    assert.ok(after.comments.some((c) => c.body.includes('wrong ticket')));
  });
});

test('every resolver refuses to run outside an issue', async () => {
  await withResolver(async ({ resolver }) => {
    for (const key of ['fleet.panel', 'fleet.dispatch', 'fleet.requeue']) {
      await assert.rejects(() => resolver[key]({ context: {} }), /must be opened on an issue/);
    }
  });
});

test('the backend exports the panel, page and every trigger handler', async () => {
  assert.equal(typeof handler, 'function');
  const mod = await import('../src/backend/index.js');
  assert.equal(typeof mod.reaperHandler, 'function');
  assert.equal(typeof mod.mcpHandler, 'function');
  assert.equal(typeof mod.heartbeatHandler, 'function');
  assert.equal(typeof mod.pageHandler, 'function');
});

test('the MCP trigger refuses without a token, then parses JSON-RPC once authorized', async () => {
  const { createMcpTrigger } = await import('../src/mcp-trigger.js');
  const calls = [];
  const trigger = (env) =>
    createMcpTrigger({
      env,
      // A server that answers requests and stays silent for notifications, like
      // createMcpServer does.
      makeServer: () => ({
        handle: (msg) => {
          calls.push(msg.method);
          if (msg.id === undefined || msg.id === null) return null;
          return { jsonrpc: '2.0', id: msg.id, result: {} };
        },
      }),
      logger: { error() {} },
    });

  const unconfigured = await trigger({})({ method: 'POST', headers: {}, body: '{}' });
  assert.equal(unconfigured.statusCode, 503);

  const authorized = trigger({ FLEET_MCP_TOKEN: 'test-token' });

  const unauthorized = await authorized({ method: 'POST', headers: {}, body: '{}' });
  assert.equal(unauthorized.statusCode, 401);
  assert.deepEqual(unauthorized.headers['WWW-Authenticate'], 'Bearer');

  const headers = { Authorization: ['Bearer test-token'] };
  const badJson = await authorized({ method: 'POST', headers, body: 'not json' });
  assert.equal(badJson.statusCode, 400);
  assert.equal(JSON.parse(badJson.body).error.code, -32700);

  const init = await authorized({
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(init.statusCode, 200);
  assert.equal(JSON.parse(init.body).id, 1);
  assert.deepEqual(calls, ['initialize']);

  const notification = await authorized({
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(notification.statusCode, 202);

  const stream = await authorized({ method: 'GET', headers, body: '' });
  assert.equal(stream.statusCode, 200);
  assert.deepEqual(stream.headers['Content-Type'], ['text/event-stream']);
});

test('reap and createMcpServer compose the same fleet_status shape', async () => {
  await withResolver(async ({ mock, jira, cfg }) => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    mock.addTicket({ key: 'FLT-504', status: 'Ready for Build' });
    await jira.claim('FLT-504', { workerId: 'worker-dead', now: new Date(now - 40 * 60_000) });

    const summary = await reap({ jira, fields: FIELDS, now, logger: quiet });
    assert.deepEqual(summary.keys, ['FLT-504']);

    const server = createMcpServer({ jira, cfg, logger: quiet });
    const status = await server.fleetStatus();
    assert.equal(status.active, 0);
    assert.equal(status.queued, 1);
    assert.equal(mock.plain('FLT-504').status, 'Ready for Build');
  });
});
