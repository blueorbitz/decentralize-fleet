import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { MockJira, FIELDS } from './helpers/mock-jira.js';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { loadConfig } from '../src/config.js';
import { createMcpServer } from '../src/mcp.js';

// Drive the MCP surface the way a coding agent does: JSON-RPC messages in, JSON
// out, over HTTP. This is the shape the Forge webtrigger exposes; the handler in
// src/backend/index.js is a thin auth + parse wrapper around exactly this.
function rpc(server, message) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${server.url}/mcp`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(message));
  });
}

async function withMcpHttp(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  const cfg = loadConfig({});
  const jira = new JiraClient({
    transport: basicTransport({ baseUrl, email: 'b@acme.com', token: 'x' }),
    project: 'FLT',
    fields: FIELDS,
  });
  const mcp = createMcpServer({ jira, cfg, logger: { info() {}, warn() {}, error() {} } });

  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
        return;
      }
      const out = await mcp.handle(msg);
      res.writeHead(out ? 200 : 202, { 'Content-Type': 'application/json' });
      res.end(out ? JSON.stringify(out) : '');
    });
  });

  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    return await fn({ mock, server: { url } });
  } finally {
    await new Promise((r) => srv.close(r));
    await mock.stop();
  }
}

async function tool(server, name, args = {}) {
  const res = await rpc(server, {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  return JSON.parse(res.result.content[0].text);
}

test('a client can discover, then use, the fleet over HTTP', async () => {
  await withMcpHttp(async ({ mock, server }) => {
    mock.addTicket({ key: 'FLT-601', status: 'Ready for Build', summary: 'Ship CSV export', priority: 'High' });

    const init = await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal(init.result.protocolVersion, '2024-11-05');
    assert.equal(init.result.serverInfo.name, 'fleet-mcp');

    const list = await rpc(server, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(list.result.tools.length, 5);

    const claimable = await tool(server, 'list_claimable_tickets');
    assert.deepEqual(claimable.map((t) => t.key), ['FLT-601']);

    const claimed = await tool(server, 'claim_ticket', { key: 'FLT-601', worker: 'mcp-http' });
    assert.equal(claimed.status, 'In Build');

    const reported = await tool(server, 'report_run_result', {
      key: 'FLT-601',
      branch: 'FLT-601-ship-csv',
      pr_url: 'https://bitbucket.org/acme/app/pull-requests/9',
    });
    assert.equal(reported.status, 'In Review');
    assert.equal(mock.plain('FLT-601').pr, 'https://bitbucket.org/acme/app/pull-requests/9');

    const status = await tool(server, 'fleet_status');
    assert.equal(status.active, 0, 'In Review is not an active claim');
    assert.equal(status.queued, 0);

    const resource = await rpc(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'fleet://status' },
    });
    assert.equal(JSON.parse(resource.result.contents[0].text).stale, 0);
  });
});

test('a malformed body is reported as a parse error, not a crash', async () => {
  await withMcpHttp(async ({ server }) => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        `${server.url}/mcp`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
        },
      );
      req.on('error', reject);
      req.end('{not json');
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, -32700);
  });
});

// --- the real entry point -------------------------------------------------
// The platform invokes mcpHandler with a webtrigger request and sends its return
// value back as the HTTP response. Serve that handler over HTTP so the auth
// boundary and the response envelope are exercised as a client sees them.
test('mcpHandler serves JSON-RPC over HTTP behind its bearer token', async () => {
  const { createMcpTrigger } = await import('../src/mcp-trigger.js');
  const mock = new MockJira();
  const baseUrl = await mock.start();

  const cfg = loadConfig({});
  const jira = new JiraClient({
    transport: basicTransport({ baseUrl, email: 'b@acme.com', token: 'x' }),
    project: 'FLT',
    fields: FIELDS,
  });
  const mcpHandler = createMcpTrigger({
    env: { FLEET_MCP_TOKEN: 'secret-token' },
    makeServer: () => createMcpServer({ jira, cfg, logger: { info() {}, warn() {}, error() {} } }),
    logger: { error() {} },
  });

  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const out = await mcpHandler({
        method: req.method,
        path: req.url,
        userPath: '',
        headers: { Authorization: [String(req.headers.authorization || '')] },
        queryParameters: {},
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(out.statusCode, Object.fromEntries((out.headers || {}).ContentType || []));
      res.end(out.body || '');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;

  const post = (body, auth) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) } },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString() }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });

  try {
    mock.addTicket({ key: 'FLT-701', status: 'Ready for Build' });

    const denied = await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }), null);
    assert.equal(denied.status, 401);

    const wrong = await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }), 'Bearer nope');
    assert.equal(wrong.status, 401);

    const ok = await post(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fleet_status', arguments: {} } }),
      'Bearer secret-token',
    );
    assert.equal(ok.status, 200);
    const status = JSON.parse(JSON.parse(ok.body).result.content[0].text);
    assert.equal(status.queued, 1);
  } finally {
    await new Promise((r) => srv.close(r));
    await mock.stop();
  }
});
