import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, FIELDS } from './helpers/mock-jira.js';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { loadConfig } from '../src/config.js';

async function withJira(fn, mockOptions = {}) {
  const mock = new MockJira(mockOptions);
  const baseUrl = await mock.start();
  try {
    const cfg = loadConfig({});
    const jira = new JiraClient({
      transport: basicTransport({ baseUrl, email: 'fleet-bot@acme.com', token: 'x' }),
      project: 'FLT',
      fields: FIELDS,
    });
    return await fn({ mock, jira, cfg });
  } finally {
    await mock.stop();
  }
}

test('claim is a CAS transition that records worker and lease', async () => {
  await withJira(async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-101', status: 'Ready for Build' });
    await jira.claim('FLT-101', { workerId: 'worker-01', now: new Date('2026-01-01T10:00:00Z') });

    const after = mock.plain('FLT-101');
    assert.equal(after.status, 'In Build');
    assert.equal(after.worker, 'worker-01');
    assert.equal(after.lease, '2026-01-01T10:00:00.000Z');
  });
});

test('a second claim loses the race with HTTP 400 and does not steal the ticket', async () => {
  await withJira(async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-102', status: 'Ready for Build' });
    await jira.claim('FLT-102', { workerId: 'worker-01' });

    await assert.rejects(
      () => jira.claim('FLT-102', { workerId: 'worker-02' }),
      (err) => err.status === 400,
    );
    assert.equal(mock.plain('FLT-102').worker, 'worker-01');
  });
});

test('normalize maps custom fields, description and acceptance criteria', async () => {
  await withJira(async ({ mock, jira }) => {
    const description = 'Do the thing.\n\nAcceptance criteria\n- Export is a CSV\n- Column headers match';
    mock.addTicket({
      key: 'FLT-103',
      status: 'In Build',
      description,
      fields: { [FIELDS.worker]: 'worker-09', [FIELDS.retry]: 1 },
    });
    const ticket = await jira.getIssue('FLT-103', { fields: Object.values(FIELDS) });
    assert.equal(ticket.worker, 'worker-09');
    assert.equal(ticket.retry, 1);
    assert.equal(ticket.acceptanceCriteria, 'Export is a CSV\nColumn headers match');
  });
});

test('dispatch marks a Triaged ticket ready and keeps it unclaimed', async () => {
  await withJira(async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-104', status: 'Triaged', labels: [] });
    const result = await jira.markReady('FLT-104');

    const after = mock.plain('FLT-104');
    assert.equal(result.status, 'Ready for Build');
    assert.equal(after.status, 'Ready for Build');
    assert.equal(after.worker, null, 'dispatch must not claim');
    assert.deepEqual(after.labels, ['fleet-ready']);
  });
});

test('dispatch is idempotent on a Ready ticket and refuses other statuses', async () => {
  await withJira(async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-105', status: 'Ready for Build' });
    await jira.markReady('FLT-105');
    assert.deepEqual(mock.plain('FLT-105').labels, ['fleet-ready']);

    mock.addTicket({ key: 'FLT-106', status: 'In Build' });
    await assert.rejects(() => jira.markReady('FLT-106'), (err) => err.status === 409);
  });
});

// A real tenant rejects the whole transition when the request carries a field
// its screen does not show. Dispatch must still land the ticket on Ready, with
// its label, because a moved-but-unlabelled ticket is invisible to the board.
test('dispatch falls back when the transition screen rejects labels', async () => {
  await withJira(
    async ({ mock, jira }) => {
      mock.addTicket({ key: 'FLT-109', status: 'Triaged', labels: [] });

      const result = await jira.markReady('FLT-109');

      assert.equal(result.status, 'Ready for Build');
      assert.equal(result.via, 'transition-then-update', 'should report the fallback path');

      const after = mock.plain('FLT-109');
      assert.equal(after.status, 'Ready for Build', 'the ticket must still move');
      assert.deepEqual(after.labels, ['fleet-ready'], 'the label must still be written');
      assert.equal(after.worker, null, 'dispatch must not claim');

      const rejected = mock.transitionLog.filter((t) => t.screenRejected);
      assert.equal(rejected.length, 1, 'exactly one request should have been rejected');
      const applied = mock.transitionLog.filter((t) => t.ok && t.to === 'Ready for Build');
      assert.equal(applied.length, 1, 'exactly one transition should have succeeded');
    },
    { screenRejects: ['labels'] },
  );
});

test('dispatch does not swallow a rejection that is not about the screen', async () => {
  await withJira(async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-110', status: 'Triaged' });
    // A 400 that is not a screen rejection must surface, not be retried.
    const realTransition = jira.transition.bind(jira);
    jira.transition = async () => {
      throw Object.assign(new Error('bad request'), { status: 400, body: { errorMessages: ['something else'] } });
    };
    await assert.rejects(() => jira.markReady('FLT-110'), (err) => err.status === 400);
    jira.transition = realTransition;
    assert.equal(mock.plain('FLT-110').status, 'Triaged');
  });
});

test('requeue clears worker and lease and moves In Build -> Ready for Build', async () => {
  await withJira(async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-107', status: 'Ready for Build' });
    await jira.claim('FLT-107', { workerId: 'worker-01' });

    await jira.requeue('FLT-107', { reason: 'aborted from panel' });

    const after = mock.plain('FLT-107');
    assert.equal(after.status, 'Ready for Build');
    assert.equal(after.worker, null);
    assert.equal(after.lease, null);
    assert.ok(after.comments.some((c) => c.body.includes('aborted from panel')));
  });
});

test('report records branch + PR and moves the ticket to In Review', async () => {
  await withJira(async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-108', status: 'Ready for Build' });
    await jira.claim('FLT-108', { workerId: 'worker-01' });

    await jira.report('FLT-108', { branch: 'FLT-108-do-a-thing', prUrl: 'https://bb.example/pr/42' });

    const after = mock.plain('FLT-108');
    assert.equal(after.status, 'In Review');
    assert.equal(after.branch, 'FLT-108-do-a-thing');
    assert.equal(after.pr, 'https://bb.example/pr/42');
  });
});
