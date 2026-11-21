import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, FIELDS } from './helpers/mock-jira.js';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { reap, findStale, humanAge } from '../src/reaper.js';
import { CONSTANTS } from '../src/config.js';

const quiet = { info() {}, warn() {}, error() {} };

async function withJira(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  try {
    const jira = new JiraClient({
      transport: basicTransport({ baseUrl, email: 'b@acme.com', token: 'x' }),
      project: 'FLT',
      fields: FIELDS,
    });
    return await fn({ mock, jira });
  } finally {
    await mock.stop();
  }
}

test('findStale only picks In Build tickets whose lease is past the window', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const fresh = new Date(now - 60_000).toISOString();
  const old = new Date(now - 20 * 60_000).toISOString();
  const stale = findStale(
    [
      { key: 'A', status: 'In Build', lease: fresh },
      { key: 'B', status: 'In Build', lease: old },
      { key: 'C', status: 'In Build', lease: null },
      { key: 'D', status: 'In Review', lease: old },
    ],
    { now, staleMs: CONSTANTS.LEASE_STALE_MS },
  );
  assert.deepEqual(stale.map((t) => t.key), ['B', 'C']);
});

test('humanAge reads like an operator wrote it', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.equal(humanAge(new Date(now - 7 * 60_000).toISOString(), now), '7m since last refresh');
  assert.equal(humanAge(null, now), 'never refreshed');
});

test('reaper requeues a crashed worker and self-heals the board', async () => {
  await withJira(async ({ mock, jira }) => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    mock.addTicket({ key: 'FLT-201', status: 'Ready for Build' });
    mock.addTicket({ key: 'FLT-202', status: 'Ready for Build' });

    await jira.claim('FLT-201', { workerId: 'worker-dead', now: new Date(now - 30 * 60_000) });
    await jira.claim('FLT-202', { workerId: 'worker-alive', now: new Date(now - 60_000) });

    const summary = await reap({ jira, fields: FIELDS, now, logger: quiet });

    assert.equal(summary.scanned, 2);
    assert.equal(summary.requeued, 1);
    assert.deepEqual(summary.keys, ['FLT-201']);

    const healed = mock.plain('FLT-201');
    assert.equal(healed.status, 'Ready for Build');
    assert.equal(healed.worker, null);
    assert.equal(healed.lease, null);
    assert.equal(healed.retry, 1);
    assert.ok(healed.comments.some((c) => c.body.includes('worker-dead')));

    const untouched = mock.plain('FLT-202');
    assert.equal(untouched.status, 'In Build');
    assert.equal(untouched.worker, 'worker-alive');
    assert.equal(untouched.retry, 0);
  });
});

test('reaper leaves a healthy board alone', async () => {
  await withJira(async ({ mock, jira }) => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    mock.addTicket({ key: 'FLT-203', status: 'Ready for Build' });
    await jira.claim('FLT-203', { workerId: 'worker-alive', now: new Date(now - 60_000) });

    const summary = await reap({ jira, fields: FIELDS, now, logger: quiet });
    assert.equal(summary.scanned, 1);
    assert.equal(summary.requeued, 0);
    assert.equal(mock.transitionLog.length, 1, 'only the claim transition should have happened');
  });
});
