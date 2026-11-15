import test from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, DEFAULT_FIELDS } from './helpers/mock-jira.js';
import { JiraClient, JiraError, isLeaseStale } from '../src/jira.js';

async function withMock(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  try {
    await fn(mock, baseUrl);
  } finally {
    await mock.stop();
  }
}

function client(baseUrl) {
  return new JiraClient({ baseUrl, email: 'b@x', token: 't', project: 'FLT', fields: DEFAULT_FIELDS });
}

test('search returns only claimable tickets', async () => {
  await withMock(async (mock, baseUrl) => {
    mock.addTicket({ key: 'FLT-1', status: 'Ready for Build' });
    mock.addTicket({ key: 'FLT-2', status: 'Done' });
    const found = await client(baseUrl).findClaimable('project = FLT AND status = "Ready for Build"');
    assert.equal(found.length, 1);
    assert.equal(found[0].key, 'FLT-1');
  });
});

test('claim is a CAS transition that sets worker + lease', async () => {
  await withMock(async (mock, baseUrl) => {
    mock.addTicket({ key: 'FLT-1', status: 'Ready for Build' });
    await client(baseUrl).claim('FLT-1', { workerId: 'w1', now: new Date('2026-01-01T00:00:00Z') });
    const t = mock.plain('FLT-1');
    assert.equal(t.status, 'In Build');
    assert.equal(t.worker, 'w1');
    assert.equal(t.lease, '2026-01-01T00:00:00.000Z');
  });
});

test('a second claim loses the race with HTTP 400', async () => {
  await withMock(async (mock, baseUrl) => {
    mock.addTicket({ key: 'FLT-1', status: 'Ready for Build' });
    const c = client(baseUrl);
    await c.claim('FLT-1', { workerId: 'w1' });
    await assert.rejects(
      () => c.claim('FLT-1', { workerId: 'w2' }),
      (err) => err instanceof JiraError && err.status === 400,
    );
    assert.equal(mock.plain('FLT-1').worker, 'w1');
  });
});

test('requeue clears worker/lease and returns the ticket to Ready', async () => {
  await withMock(async (mock, baseUrl) => {
    mock.addTicket({
      key: 'FLT-1',
      status: 'In Build',
      fields: { [DEFAULT_FIELDS.worker]: 'w1', [DEFAULT_FIELDS.lease]: '2026-01-01T00:00:00.000Z' },
    });
    await client(baseUrl).requeue('FLT-1', { reason: 'requeued after lease expiry' });
    const t = mock.plain('FLT-1');
    assert.equal(t.status, 'Ready for Build');
    assert.equal(t.worker, null);
    assert.equal(t.lease, null);
    assert.deepEqual(t.comments, ['requeued after lease expiry']);
  });
});

test('report records branch/PR and moves the ticket to In Review', async () => {
  await withMock(async (mock, baseUrl) => {
    mock.addTicket({ key: 'FLT-1', status: 'In Build' });
    await client(baseUrl).report('FLT-1', { branch: 'FLT-1-x', prUrl: 'http://pr/1' });
    const t = mock.plain('FLT-1');
    assert.equal(t.status, 'In Review');
    assert.equal(t.branch, 'FLT-1-x');
    assert.equal(t.pr, 'http://pr/1');
  });
});

test('isLeaseStale treats missing/old leases as stale', () => {
  const now = Date.parse('2026-01-01T01:00:00Z');
  assert.equal(isLeaseStale(null, { now, staleMs: 900_000 }), true);
  assert.equal(isLeaseStale('2026-01-01T00:30:00Z', { now, staleMs: 900_000 }), true);
  assert.equal(isLeaseStale('2026-01-01T00:55:00Z', { now, staleMs: 900_000 }), false);
});
