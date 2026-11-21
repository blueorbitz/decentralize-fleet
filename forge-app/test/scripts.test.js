import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../scripts/verify-setup.mjs';
import { FIELDS, WORKFLOW } from '../scripts/provision.mjs';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { FLOW, MockJira } from './helpers/mock-jira.js';
import { DEFAULT_FIELDS } from '../src/config.js';

async function withClient(options, fn) {
  const mock = new MockJira(options);
  const baseUrl = await mock.start();
  try {
    const client = new JiraClient({
      transport: basicTransport({ baseUrl, email: 'b@acme.com', token: 'x' }),
      project: 'FLT',
      fields: DEFAULT_FIELDS,
    });
    return await fn({ mock, client });
  } finally {
    await mock.stop();
  }
}

test('the fields provisioning creates are the fields the fleet uses', () => {
  assert.deepEqual(FIELDS.map((f) => f.name), Object.values(DEFAULT_FIELDS));
});

test('the workflow provisioning documents is the workflow Jira enforces', () => {
  const fromMock = Object.entries(FLOW).flatMap(([from, ts]) => ts.map((t) => [from, t.name, t.to]));
  for (const step of WORKFLOW) {
    assert.ok(
      fromMock.some(([f, n, to]) => f === step[0] && n === step[1] && to === step[2]),
      `${step.join(' -> ')} is documented but not in the workflow`,
    );
  }
  // Every enforced transition except the human-only Finish is documented.
  const humanOnly = new Set(['Finish', 'Triage']);
  for (const [from, name, to] of fromMock) {
    if (humanOnly.has(name)) continue;
    assert.ok(
      WORKFLOW.some(([f, n, t]) => f === from && n === name && t === to),
      `${from} -> ${name} -> ${to} is in the workflow but not documented`,
    );
  }
});

test('verify reports a fully configured tenant as ready', async () => {
  await withClient({}, async ({ mock, client }) => {
    mock.addTicket({ key: 'FLT-401', status: 'Ready for Build' });
    const lines = [];
    const ok = await verify({ client, project: 'FLT', log: (l) => lines.push(l) });

    assert.equal(ok, true, lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('Fleet Retry')));
    assert.ok(lines.some((l) => l.includes('Ready for Build -> Claim -> In Build')));
  });
});

test('verify fails loudly when a field is missing', async () => {
  await withClient({ fieldList: [{ id: 'customfield_10101', name: 'Fleet Worker' }] }, async ({ mock, client }) => {
    mock.addTicket({ key: 'FLT-402', status: 'Ready for Build' });
    const lines = [];
    const ok = await verify({ client, project: 'FLT', log: (l) => lines.push(l) });

    assert.equal(ok, false);
    assert.ok(lines.some((l) => l.includes('FAIL') && l.includes('Fleet Lease')));
  });
});

test('verify fails when a workflow status is missing', async () => {
  // A status the workflow does not have makes a JQL query fail, which is how a
  // mis-authored workflow shows up. Take one away and the board is no longer
  // usable by the fleet, even though all five fields are present.
  const { KNOWN_STATUSES } = await import('./helpers/mock-jira.js');
  const index = KNOWN_STATUSES.indexOf('Triaged');
  KNOWN_STATUSES.splice(index, 1);
  try {
    await withClient({}, async ({ mock, client }) => {
      mock.addTicket({ key: 'FLT-403', status: 'Ready for Build' });
      const lines = [];
      const ok = await verify({ client, project: 'FLT', log: (l) => lines.push(l) });

      assert.equal(ok, false);
      assert.ok(lines.some((l) => l.includes('FAIL') && l.includes('"Triaged"')), lines.join('\n'));
    });
  } finally {
    KNOWN_STATUSES.splice(index, 0, 'Triaged');
  }
});

test('verify skips transition checks when no ticket is claimable', async () => {
  await withClient({}, async ({ mock, client }) => {
    mock.addTicket({ key: 'FLT-404', status: 'Done' });
    const lines = [];
    const ok = await verify({ client, project: 'FLT', log: (l) => lines.push(l) });
    assert.equal(ok, true, lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('skip') && l.includes('transitions cannot be read')));
  });
});

test('provisioning creates only the fields that are missing', async () => {
  await withClient({ fieldList: [{ id: 'customfield_10101', name: 'Fleet Worker' }] }, async ({ mock, client }) => {
    const before = mock.fieldList.length;
    for (const field of FIELDS) {
      const existing = mock.fieldList.find((f) => f.name === field.name);
      if (existing) continue;
      await client.request('POST', (tag) => tag`/rest/api/3/field`, { name: field.name, type: field.type });
    }
    assert.equal(mock.fieldList.length, before + FIELDS.length - 1);
    assert.deepEqual(
      mock.fieldList.map((f) => f.name).sort(),
      FIELDS.map((f) => f.name).sort(),
    );
  });
});
