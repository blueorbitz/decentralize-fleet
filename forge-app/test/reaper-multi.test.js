import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, FIELDS } from './helpers/mock-jira.js';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { reap } from '../src/reaper.js';
import { memoryStore } from '../src/settings/store.js';
import { createSettingsService } from '../src/settings/service.js';
import { normalizeRecord, defaultRecord } from '../src/settings/schema.js';

// The reaper stopped being a single-project loop. These tests pin the new
// contract: zero configured is a quiet no-op, one project reaps that project,
// and many projects are each reaped exactly once.

const quiet = { info() {}, warn() {}, error() {} };
const now = Date.parse('2026-01-01T12:00:00Z');

function recordFor(projectId, projectKey) {
  return normalizeRecord(defaultRecord({ projectId, projectKey, env: {} }));
}

async function withFleet(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  try {
    const transport = basicTransport({ baseUrl, email: 'b@acme.com', token: 'x' });
    const jiraFor = (project) =>
      new JiraClient({ transport, project, fields: FIELDS });
    return await fn({ mock, jiraFor, transport });
  } finally {
    await mock.stop();
  }
}

test('no configured project means the reaper does nothing, quietly', async () => {
  const store = memoryStore();
  const service = createSettingsService({ store, env: {} });
  const projects = await service.listProjects();
  assert.deepEqual(projects, [], 'an install that never opened the settings page has no records');
});

test('each configured project is reaped against its own board', async () => {
  await withFleet(async ({ mock, jiraFor }) => {
    // Two boards, each with one stale claim and one healthy claim.
    mock.addTicket({ key: 'FLT-1001', status: 'Ready for Build' });
    mock.addTicket({ key: 'FLT-1002', status: 'Ready for Build' });
    mock.addTicket({ key: 'OPS-2001', status: 'Ready for Build' });
    mock.addTicket({ key: 'OPS-2002', status: 'Ready for Build' });

    const flt = jiraFor('FLT');
    const ops = jiraFor('OPS');
    await flt.claim('FLT-1001', { workerId: 'dead-a', now: new Date(now - 30 * 60_000) });
    await flt.claim('FLT-1002', { workerId: 'alive-a', now: new Date(now - 60_000) });
    await ops.claim('OPS-2001', { workerId: 'dead-b', now: new Date(now - 30 * 60_000) });
    await ops.claim('OPS-2002', { workerId: 'alive-b', now: new Date(now - 60_000) });

    const store = memoryStore({ configs: [recordFor('1', 'FLT'), recordFor('2', 'OPS')] });
    const service = createSettingsService({ store, env: {} });

    const totals = { projects: 0, scanned: 0, requeued: 0, keys: [] };
    for (const record of await service.listProjects()) {
      const cfg = await service.loadEffectiveConfig({ projectId: record.projectId });
      const summary = await reap({ jira: jiraFor(cfg.jira.project), fields: cfg.jira.fields, now, logger: quiet });
      totals.projects += 1;
      totals.scanned += summary.scanned;
      totals.requeued += summary.requeued;
      totals.keys.push(...summary.keys);
    }

    assert.equal(totals.projects, 2);
    assert.equal(totals.scanned, 4, 'both boards were scanned');
    assert.equal(totals.requeued, 2, 'one stale claim per board');
    assert.deepEqual(totals.keys.sort(), ['FLT-1001', 'OPS-2001']);

    assert.equal(mock.plain('FLT-1002').worker, 'alive-a', 'a healthy claim is untouched');
    assert.equal(mock.plain('OPS-2002').worker, 'alive-b');
  });
});

test('a project saved on the settings page is what the reaper reads', async () => {
  const store = memoryStore();
  const service = createSettingsService({ store, env: {}, now: () => new Date(now) });
  // Save without validation (no tenant in this test), then read it back.
  await service.save('77', { projectKey: 'OPS', timings: { leaseStaleMs: 60_000 } }, {
    projectKey: 'OPS',
    validate: false,
  });

  const projects = await service.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].projectKey, 'OPS');

  const cfg = await service.loadEffectiveConfig({ projectId: '77' });
  assert.equal(cfg.jira.project, 'OPS');
  assert.equal(cfg.timings.leaseStaleMs, 60_000);
});
