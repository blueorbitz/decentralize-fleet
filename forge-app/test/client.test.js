import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, FIELDS } from './helpers/mock-jira.js';
import { basicTransport } from '../src/transports.js';
import { memoryStore } from '../src/settings/store.js';
import { makeJiraClient } from '../src/client.js';
import { normalizeRecord, defaultRecord } from '../src/settings/schema.js';

// makeJiraClient is the async replacement for the old synchronous env read. It
// resolves a project's config from the store and binds a Jira client to it.

function recordFor(projectId, projectKey, fields = FIELDS) {
  return normalizeRecord({ ...defaultRecord({ projectId, projectKey }), fields });
}

async function withStore(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  try {
    const transport = basicTransport({ baseUrl, email: 'b@acme.com', token: 'x' });
    return await fn({ mock, transport });
  } finally {
    await mock.stop();
  }
}

test('a saved project record supplies the client and its config', async () => {
  await withStore(async ({ mock, transport }) => {
    mock.addTicket({ key: 'FLT-950', status: 'Ready for Build' });

    const store = memoryStore({ configs: [recordFor('1', 'FLT')] });
    const { cfg, jira, record } = await makeJiraClient({ store, transport, env: {} });

    assert.equal(record.projectId, '1');
    assert.equal(cfg.jira.project, 'FLT');
    assert.equal(cfg.timings.leaseStaleMs, 15 * 60_000);

    // The client really works against that project's board.
    const tickets = await jira.search('project = FLT AND status = "Ready for Build"');
    assert.deepEqual(tickets.map((t) => t.key), ['FLT-950']);
  });
});

test('no record at all falls back to the env config, not an invented project', async () => {
  await withStore(async ({ transport }) => {
    const { cfg, record } = await makeJiraClient({
      store: memoryStore(),
      transport,
      env: { FLEET_PROJECT: 'ENV', FLEET_FIELD_WORKER: 'customfield_9' },
    });
    assert.equal(record, null);
    assert.equal(cfg.jira.project, 'ENV');
    assert.equal(cfg.jira.fields.worker, 'customfield_9');
  });
});

test('a named project is read directly; an ambiguous install says which', async () => {
  await withStore(async ({ transport }) => {
    const store = memoryStore({ configs: [recordFor('1', 'FLT'), recordFor('2', 'OPS')] });

    const { cfg } = await makeJiraClient({ store, transport, env: {}, projectId: '2' });
    assert.equal(cfg.jira.project, 'OPS');

    await assert.rejects(
      () => makeJiraClient({ store, transport, env: {} }),
      (err) => err.status === 409 && /FLT, OPS/.test(err.message),
    );
  });
});
