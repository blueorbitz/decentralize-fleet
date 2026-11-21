import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPanelModel, leaseState } from '../src/panel-model.js';
import { CONSTANTS } from '../src/config.js';

const NOW = Date.parse('2026-01-01T12:00:00Z');

function ticket(overrides = {}) {
  return {
    key: 'FLT-101',
    summary: 'Add CSV export',
    status: 'Ready for Build',
    labels: ['fleet-ready'],
    worker: null,
    lease: null,
    branch: null,
    pr: null,
    retry: 0,
    acceptanceCriteria: 'Export is CSV\nHeaders match',
    ...overrides,
  };
}

test('a ready, unclaimed ticket can be dispatched but not requeued', () => {
  const model = buildPanelModel({ ticket: ticket(), now: NOW });
  assert.equal(model.actions.canDispatch, true);
  assert.equal(model.actions.canRequeue, false);
  assert.deepEqual(model.acceptanceCriteria, ['Export is CSV', 'Headers match']);
  assert.equal(model.leaseState.state, 'none');
});

test('a live claim shows a countdown and offers abort & requeue', () => {
  const lease = new Date(NOW - 2 * 60_000).toISOString();
  const model = buildPanelModel({ ticket: ticket({ status: 'In Build', worker: 'worker-04', lease }), now: NOW });

  assert.equal(model.actions.canDispatch, false);
  assert.equal(model.actions.canRequeue, true);
  assert.equal(model.actions.requeueLabel, 'Abort & requeue');
  assert.equal(model.leaseState.state, 'live');
  assert.equal(model.leaseState.remainingMs, 13 * 60_000);
});

test('a stale claim is labelled as such so the reaper contract is visible', () => {
  const lease = new Date(NOW - 30 * 60_000).toISOString();
  const model = buildPanelModel({ ticket: ticket({ status: 'In Build', worker: 'worker-dead', lease }), now: NOW });
  assert.equal(model.leaseState.state, 'stale');
  assert.equal(model.actions.requeueLabel, 'Requeue stale claim');
});

test('leaseState is exact at the staleness boundary', () => {
  const lease = new Date(NOW - CONSTANTS.LEASE_STALE_MS).toISOString();
  assert.equal(leaseState({ lease }, { now: NOW, staleMs: CONSTANTS.LEASE_STALE_MS }).state, 'live');

  const justOver = new Date(NOW - CONSTANTS.LEASE_STALE_MS - 1).toISOString();
  assert.equal(leaseState({ lease: justOver }, { now: NOW, staleMs: CONSTANTS.LEASE_STALE_MS }).state, 'stale');
});

test('the run log prefers fleet comments and falls back to all comments', () => {
  const comments = [
    { created: '2026-01-01T10:00:00Z', author: 'Someone', body: 'Unrelated chatter' },
    { created: '2026-01-01T10:02:00Z', author: 'Fleet', body: 'Fleet worker `worker-04` claimed this ticket.' },
    { created: '2026-01-01T10:05:00Z', author: 'Fleet', body: 'Requeued after lease expiry.' },
  ];
  const withFleet = buildPanelModel({ ticket: ticket({ status: 'In Build' }), comments, now: NOW });
  assert.equal(withFleet.log.length, 2);
  assert.ok(withFleet.log[0].text.includes('claimed'));

  const fallback = buildPanelModel({
    ticket: ticket(),
    comments: [{ created: '2026-01-01T10:00:00Z', author: 'Someone', body: 'Plain note' }],
    now: NOW,
  });
  assert.equal(fallback.log.length, 1);
  assert.equal(fallback.log[0].text, 'Plain note');
});

test('an In Review ticket offers neither action — the human takes over', () => {
  const model = buildPanelModel({
    ticket: ticket({ status: 'In Review', worker: 'worker-04', branch: 'FLT-101-add-csv', pr: 'https://bb.example/pr/42' }),
    now: NOW,
  });
  assert.equal(model.actions.canDispatch, false);
  assert.equal(model.actions.canRequeue, false);
  assert.equal(model.pr, 'https://bb.example/pr/42');
});
