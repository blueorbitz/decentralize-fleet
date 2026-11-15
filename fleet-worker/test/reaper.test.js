import test from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, DEFAULT_FIELDS } from './helpers/mock-jira.js';
import { JiraClient } from '../src/jira.js';
import { Logger } from '../src/logger.js';
import { reap } from '../src/worker.js';

test('reaper requeues In Build tickets with stale leases only', async () => {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  try {
    const stale = new Date(Date.now() - 20 * 60_000).toISOString();
    const fresh = new Date().toISOString();
    mock.addTicket({
      key: 'FLT-1',
      status: 'In Build',
      fields: { [DEFAULT_FIELDS.worker]: 'w1', [DEFAULT_FIELDS.lease]: stale },
    });
    mock.addTicket({
      key: 'FLT-2',
      status: 'In Build',
      fields: { [DEFAULT_FIELDS.worker]: 'w2', [DEFAULT_FIELDS.lease]: fresh },
    });

    const jira = new JiraClient({ baseUrl, email: 'b@x', token: 't', project: 'FLT', fields: DEFAULT_FIELDS });
    const cfg = { jira: { fields: DEFAULT_FIELDS }, timings: { leaseStaleMs: 15 * 60_000 } };
    const result = await reap({ cfg, jira, logger: new Logger({}) });

    assert.deepEqual(result.keys, ['FLT-1']);
    assert.equal(mock.plain('FLT-1').status, 'Ready for Build');
    assert.equal(mock.plain('FLT-1').worker, null);
    assert.equal(mock.plain('FLT-1').retry, 1);
    assert.equal(mock.plain('FLT-2').status, 'In Build');
  } finally {
    await mock.stop();
  }
});
