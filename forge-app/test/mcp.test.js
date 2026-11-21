import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, FIELDS } from './helpers/mock-jira.js';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { loadConfig } from '../src/config.js';
import { createMcpServer, TOOLS } from '../src/mcp.js';

const quiet = { info() {}, warn() {}, error() {} };

async function withServer(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  try {
    const cfg = loadConfig({});
    const jira = new JiraClient({
      transport: basicTransport({ baseUrl, email: 'b@acme.com', token: 'x' }),
      project: 'FLT',
      fields: FIELDS,
    });
    return await fn({ mock, server: createMcpServer({ jira, cfg, logger: quiet }) });
  } finally {
    await mock.stop();
  }
}

async function call(server, name, args = {}) {
  const res = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return JSON.parse(res.result.content[0].text);
}

test('initialize advertises the five fleet tools', async () => {
  await withServer(async ({ server }) => {
    const res = await server.handle({ jsonrpc: '2.0', id: 0, method: 'initialize' });
    assert.equal(res.result.serverInfo.name, 'fleet-mcp');

    const list = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.deepEqual(
      list.result.tools.map((t) => t.name),
      ['fleet_status', 'list_claimable_tickets', 'claim_ticket', 'report_run_result', 'reset_claim'],
    );
  });
});

test('tools/list matches the worker MCP surface exactly', () => {
  const expected = ['fleet_status', 'list_claimable_tickets', 'claim_ticket', 'report_run_result', 'reset_claim'];
  assert.deepEqual(TOOLS.map((t) => t.name), expected);
});

test('fleet_status counts claims, queue and failures', async () => {
  await withServer(async ({ mock, server }) => {
    mock.addTicket({ key: 'FLT-301', status: 'Ready for Build' });
    mock.addTicket({ key: 'FLT-302', status: 'Ready for Build' });
    mock.addTicket({ key: 'FLT-303', status: 'Failed' });

    // Claim through the tool so the CAS path is what is under test.
    await call(server, 'claim_ticket', { key: 'FLT-301', worker: 'mcp-smoke' });

    const status = await call(server, 'fleet_status');
    assert.equal(status.active, 1);
    assert.equal(status.queued, 1);
    assert.equal(status.failed, 1);
    assert.deepEqual(status.workers, ['mcp-smoke']);
    assert.equal(status.claims[0].key, 'FLT-301');
    assert.equal(status.claims[0].stale, false);
  });
});

test('claim_ticket loses the race cleanly when the ticket is already claimed', async () => {
  await withServer(async ({ mock, server }) => {
    mock.addTicket({ key: 'FLT-304', status: 'Ready for Build' });
    await call(server, 'claim_ticket', { key: 'FLT-304', worker: 'first' });

    const res = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'claim_ticket', arguments: { key: 'FLT-304', worker: 'second' } },
    });
    assert.equal(res.result.isError, true);
    assert.equal(mock.plain('FLT-304').worker, 'first');
  });
});

test('list_claimable_tickets shows what a worker would poll', async () => {
  await withServer(async ({ mock, server }) => {
    mock.addTicket({ key: 'FLT-305', status: 'Ready for Build', summary: 'Ship it', priority: 'High' });
    mock.addTicket({ key: 'FLT-306', status: 'In Build' });
    const tickets = await call(server, 'list_claimable_tickets');
    assert.deepEqual(tickets.map((t) => t.key), ['FLT-305']);
    assert.equal(tickets[0].priority, 'High');
  });
});

test('report_run_result moves the ticket to In Review and records the PR', async () => {
  await withServer(async ({ mock, server }) => {
    mock.addTicket({ key: 'FLT-307', status: 'Ready for Build' });
    await call(server, 'claim_ticket', { key: 'FLT-307', worker: 'w' });
    const out = await call(server, 'report_run_result', {
      key: 'FLT-307',
      branch: 'FLT-307-ship-it',
      pr_url: 'https://bb.example/pr/7',
    });
    assert.equal(out.status, 'In Review');
    assert.equal(mock.plain('FLT-307').status, 'In Review');
    assert.equal(mock.plain('FLT-307').pr, 'https://bb.example/pr/7');
  });
});

test('reset_claim refuses a live run and force-requeues a stale one', async () => {
  await withServer(async ({ mock, server }) => {
    mock.addTicket({ key: 'FLT-308', status: 'Ready for Build' });
    await call(server, 'claim_ticket', { key: 'FLT-308', worker: 'w' });

    const refused = await call(server, 'reset_claim', { key: 'FLT-308' });
    assert.ok(refused.refused);
    assert.equal(mock.plain('FLT-308').status, 'In Build');

    const forced = await call(server, 'reset_claim', { key: 'FLT-308', force: true, reason: 'wrong claim' });
    assert.equal(forced.status, 'Ready for Build');
    assert.equal(mock.plain('FLT-308').worker, null);
  });
});

test('fleet://status resource is readable JSON', async () => {
  await withServer(async ({ mock, server }) => {
    mock.addTicket({ key: 'FLT-309', status: 'Ready for Build' });
    const res = await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'fleet://status' },
    });
    const payload = JSON.parse(res.result.contents[0].text);
    assert.equal(payload.queued, 1);
    assert.equal(res.result.contents[0].uri, 'fleet://status');
  });
});

test('notifications get no response; unknown methods get a protocol error', async () => {
  await withServer(async ({ server }) => {
    assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const bad = await server.handle({ jsonrpc: '2.0', id: 9, method: 'nope/nope' });
    assert.equal(bad.error.code, -32601);
  });
});
