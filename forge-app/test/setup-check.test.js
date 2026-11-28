import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockJira, FIELDS } from './helpers/mock-jira.js';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { validateConfig, REQUIRED_TRANSITIONS } from '../src/setup-check.js';
import { DEFAULT_FIELDS } from '../src/config.js';

// The readiness checks the settings page's Test connection and a save both run.
// They must agree with scripts/verify-setup.mjs, which is now a presentation of
// this same module.

async function withCheck(options, fn) {
  const mock = new MockJira(options);
  const baseUrl = await mock.start();
  try {
    const jira = new JiraClient({
      transport: basicTransport({ baseUrl, email: 'b@acme.com', token: 'x' }),
      project: 'FLT',
      fields: DEFAULT_FIELDS,
    });
    return await fn({ mock, jira });
  } finally {
    await mock.stop();
  }
}

const record = { projectKey: 'FLT', fields: { ...DEFAULT_FIELDS } };

test('a fully configured tenant passes every check', async () => {
  await withCheck({}, async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-901', status: 'Ready for Build' });
    const result = await validateConfig({ jira, record });

    assert.equal(result.ok, true, result.lines.join('\n'));
    // Structured by check, so the page can render a failure precisely.
    for (const id of ['fields', 'project', 'statuses', 'transitions', 'claim-screen']) {
      const check = result.checks.find((c) => c.id === id);
      assert.ok(check && check.ok, `check ${id} should pass`);
    }
  });
});

test('a missing field fails the field check and the save', async () => {
  await withCheck({ fieldList: [{ id: 'customfield_10101', name: 'Fleet Worker' }] }, async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-902', status: 'Ready for Build' });
    const result = await validateConfig({ jira, record });

    assert.equal(result.ok, false);
    const fields = result.checks.find((c) => c.id === 'fields');
    assert.equal(fields.ok, false);
    assert.ok(fields.lines.some((l) => l.includes('Fleet Lease')));
  });
});

test('a value that is a customfield id must exist, not be treated as a name', async () => {
  await withCheck({}, async ({ mock, jira }) => {
    mock.addTicket({ key: 'FLT-903', status: 'Ready for Build' });
    const result = await validateConfig({
      jira,
      record: { projectKey: 'FLT', fields: { ...DEFAULT_FIELDS, worker: 'customfield_99999' } },
    });
    assert.equal(result.ok, false);
    const fields = result.checks.find((c) => c.id === 'fields');
    assert.ok(fields.lines.some((l) => l.includes('customfield_99999')));
  });
});

test('a Jira that refuses returns a failed check instead of throwing', async () => {
  const jira = {
    request: async () => {
      throw new Error('401 unauthorized');
    },
    search: async () => [],
  };
  const result = await validateConfig({ jira, record });
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].id, 'jira');
  assert.match(result.checks[0].lines[0], /401/);
});

test('no client at all is a failed check, not a crash', async () => {
  const result = await validateConfig({ jira: null, record });
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /no Jira client/);
});

test('the required transitions are the fleet protocol', () => {
  const names = REQUIRED_TRANSITIONS.map(([, name]) => name);
  assert.ok(names.includes('Claim'));
  assert.ok(names.includes('Report PR'));
  assert.ok(names.includes('Requeue'));
});
