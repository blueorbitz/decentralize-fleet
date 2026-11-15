import test from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, DEFAULT_FIELDS } from './helpers/mock-jira.js';
import { JiraClient } from '../src/jira.js';
import { createMcpServer, TOOLS } from '../src/mcp.js';

function server(baseUrl) {
  const cfg = {
    jira: { project: 'FLT', fields: DEFAULT_FIELDS },
    timings: { leaseStaleMs: 15 * 60_000 },
    worker: { id: 'mcp-client' },
  };
  const jira = new JiraClient({ baseUrl, email: 'b@x', token: 't', project: 'FLT', fields: DEFAULT_FIELDS });
  return createMcpServer({ jira, cfg, logger: { error() {} } });
}

const call = (server, name, args, id = 1) =>
  server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

const textOf = (res) => JSON.parse(res.result.content[0].text);

async function withMock(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  try {
    await fn(mock, baseUrl);
  } finally {
    await mock.stop();
  }
}

test('initialize returns capabilities and serverInfo', async () => {
  await withMock(async (mock, baseUrl) => {
    const res = await server(baseUrl).handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 1);
    assert.equal(res.result.protocolVersion, '2024-11-05');
    assert.ok(res.result.capabilities.tools);
    assert.equal(res.result.serverInfo.name, 'fleet-mcp');
  });
});

test('tools/list exposes the five fleet verbs', async () => {
  await withMock(async (mock, baseUrl) => {
    const res = await server(baseUrl).handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(res.result.tools.length, 5);
    assert.deepEqual(res.result.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  });
});

test('list_claimable_tickets returns only ready tickets', async () => {
  await withMock(async (mock, baseUrl) => {
    mock.addTicket({ key: 'FLT-1', status: 'Ready for Build', summary: 'x' });
    mock.addTicket({ key: 'FLT-2', status: 'Done' });
    const payload = textOf(await call(server(baseUrl), 'list_claimable_tickets', {}));
    assert.deepEqual(payload.map((t) => t.key), ['FLT-1']);
  });
});

test('claim_ticket performs the CAS claim', async () => {
  await withMock(async (mock, baseUrl) => {
    mock.addTicket({ key: 'FLT-1', status: 'Ready for Build' });
    const payload = textOf(await call(server(baseUrl), 'claim_ticket', { key: 'FLT-1', worker: 'mcp-client' }));
    assert.equal(payload.status, 'In Build');
    assert.equal(mock.plain('FLT-1').worker, 'mcp-client');
  });
});

test('reset_claim refuses a live run, then requeues when forced', async () => {
  await withMock(async (mock, baseUrl) => {
    mock.addTicket({
      key: 'FLT-1',
      status: 'In Build',
      fields: { [DEFAULT_FIELDS.worker]: 'w1', [DEFAULT_FIELDS.lease]: new Date().toISOString() },
    });
    const s = server(baseUrl);
    const refused = textOf(await call(s, 'reset_claim', { key: 'FLT-1' }, 5));
    assert.match(refused.refused, /live/);
    assert.equal(mock.plain('FLT-1').status, 'In Build');

    const forced = textOf(await call(s, 'reset_claim', { key: 'FLT-1', force: true }, 6));
    assert.equal(forced.status, 'Ready for Build');
    assert.equal(mock.plain('FLT-1').worker, null);
  });
});

test('resources/read exposes fleet://status', async () => {
  await withMock(async (mock, baseUrl) => {
    const now = new Date().toISOString();
    mock.addTicket({ key: 'FLT-1', status: 'In Build', fields: { [DEFAULT_FIELDS.worker]: 'w1', [DEFAULT_FIELDS.lease]: now } });
    mock.addTicket({ key: 'FLT-2', status: 'Ready for Build' });
    const res = await server(baseUrl).handle({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'fleet://status' } });
    const payload = JSON.parse(res.result.contents[0].text);
    assert.equal(payload.active, 1);
    assert.equal(payload.queued, 1);
    assert.equal(payload.stale, 0);
    assert.equal(payload.claims[0].key, 'FLT-1');
  });
});

test('an unknown tool is reported in-band as isError', async () => {
  await withMock(async (mock, baseUrl) => {
    const res = await call(server(baseUrl), 'does_not_exist', {}, 8);
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /unknown tool/);
  });
});
