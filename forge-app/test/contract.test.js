import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as appConfig from '../src/config.js';

// The worker and the Forge app are two independent processes that move the same
// tickets. If they disagree about a status name, a transition name or a field,
// the fleet silently stops working — a claim becomes an "invalid transition".
// These tests fail the build when the two drift apart.
const workerUrl = pathToFileURL(
  path.resolve(import.meta.dirname, '../../fleet-worker/src/config.js'),
).href;

test('status and transition names match fleet-worker exactly', async () => {
  const worker = await import(workerUrl);
  assert.deepEqual(appConfig.STATUS, worker.STATUS);
  assert.deepEqual(
    { claim: appConfig.TRANSITION.CLAIM, report: appConfig.TRANSITION.REPORT, requeue: appConfig.TRANSITION.REQUEUE, reject: appConfig.TRANSITION.REJECT },
    { claim: worker.TRANSITION.CLAIM, report: worker.TRANSITION.REPORT, requeue: worker.TRANSITION.REQUEUE, reject: worker.TRANSITION.REJECT },
  );
});

test('fleet custom fields match fleet-worker exactly', async () => {
  const worker = await import(workerUrl);
  assert.deepEqual(appConfig.DEFAULT_FIELDS, worker.DEFAULT_FIELDS);
});

test('the lease timings match the worker constants', async () => {
  const worker = await import(workerUrl);
  assert.equal(appConfig.CONSTANTS.LEASE_REFRESH_MS, worker.CONSTANTS.LEASE_REFRESH_MS);
  assert.equal(appConfig.CONSTANTS.LEASE_STALE_MS, worker.CONSTANTS.LEASE_STALE_MS);
  assert.equal(appConfig.CONSTANTS.RUN_TIMEOUT_MS, worker.CONSTANTS.RUN_TIMEOUT_MS);
  assert.equal(appConfig.CONSTANTS.RETRY_BUDGET, worker.CONSTANTS.RETRY_BUDGET);
});

test('JQL is byte-identical to the worker poll query', async () => {
  const worker = await import(workerUrl);
  const appJql = appConfig.jqlFor(appConfig.STATUS.READY, 'FLT');
  const workerJql = worker.jqlFor({ jira: { jql: null, project: 'FLT' } });
  assert.equal(appJql, workerJql);
});
