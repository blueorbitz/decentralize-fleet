import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECTION_INPUTS,
  TIMING_INPUTS,
  buildPageState,
  formToRecord,
  formValues,
  formatTimestamp,
  validationView,
} from '../src/static/settings/model.js';

// The settings page's view model. The JSX itself cannot be imported under
// `node --test` because @forge/react refuses to load outside a Forge host, so
// every decision worth asserting is here instead.

const record = {
  projectId: '10001',
  projectKey: 'FLT',
  fields: {
    worker: 'customfield_1',
    lease: 'customfield_2',
    branch: 'customfield_3',
    pr: 'customfield_4',
    retry: 'customfield_5',
  },
  timings: { leaseStaleMs: 900000 },
  worker: { leaseRefreshMs: 300000, retryBudget: 2 },
  tokens: [{ id: 'a', name: 'alice', createdAt: '2026-01-01T10:00:00Z' }],
  updatedAt: '2026-01-01T12:00:00Z',
};

test('the form seeds nested defaults and maps a submission back unchanged', () => {
  const values = formValues(record);
  // Nested shape, matching UI Kit's dot-syntax register(): no flat dotted keys.
  assert.equal(values.fields.worker, 'customfield_1');
  assert.equal(values.timings.leaseStaleMs, 900000);
  assert.equal(values.worker.retryBudget, 2);
  assert.equal(values['fields.worker'], undefined);

  // A submission arrives with numbers as strings and the same nesting.
  const submitted = {
    projectKey: 'FLT',
    fields: { ...record.fields },
    timings: { leaseStaleMs: '1200000' },
    worker: { leaseRefreshMs: '300000', retryBudget: '4' },
  };
  assert.deepEqual(formToRecord(submitted, { record, projectKey: 'FLT' }), {
    projectKey: 'FLT',
    fields: { ...record.fields },
    timings: { leaseStaleMs: 1200000 },
    worker: { leaseRefreshMs: 300000, retryBudget: 4 },
  });
});

test('every editable input names a nested path the form can register', () => {
  const values = formValues(record);
  for (const input of [...CONNECTION_INPUTS, ...TIMING_INPUTS]) {
    assert.match(input.name, /^[a-zA-Z]/, `${input.name} must be a registrable path`);
    assert.ok(input.label && input.hint, `${input.name} needs a label and a hint`);
    const resolved = input.name.split('.').reduce((acc, key) => acc?.[key], values);
    assert.ok(resolved !== undefined, `${input.name} has no default value in formValues`);
  }
});

test('a page with no record leads with the configure CTA', () => {
  const state = buildPageState({
    project: { id: '10001', key: 'FLT' },
    record,
    configured: false,
    provenance: 'env',
    canEdit: true,
    workerEnv: null,
  });
  assert.equal(state.showConfigureCta, true);
  assert.equal(state.notice, null);
  assert.equal(state.canEdit, true);
});

test('a non-admin gets the read-only notice and no copyable block', () => {
  const state = buildPageState({
    project: { id: '10001', key: 'FLT' },
    record,
    configured: true,
    canEdit: false,
    workerEnv: null,
  });
  assert.equal(state.notice, 'You can view these settings, but only a project administrator can change them.');
  assert.equal(state.envBlock, null);
  assert.equal(state.tokens.length, 1, 'tokens are listed for a non-admin too');
});

test('an admin sees the generated worker env and the saved timestamp', () => {
  const state = buildPageState({
    project: { id: '10001', key: 'FLT' },
    record,
    configured: true,
    canEdit: true,
    workerEnv: 'FLEET_PROJECT=FLT',
  });
  assert.equal(state.envBlock, 'FLEET_PROJECT=FLT');
  assert.equal(state.updatedAt, '2026-01-01T12:00:00Z');
  assert.equal(state.tokens[0].name, 'alice');
});

test('a validation result is flattened into what the page shows', () => {
  const view = validationView({
    ok: false,
    checks: [
      { id: 'fields', ok: true, lines: [] },
      { id: 'transitions', ok: false, lines: ['  FAIL  missing'] },
    ],
    lines: ['Custom fields', '  FAIL  missing'],
  });
  assert.equal(view.ok, false);
  assert.deepEqual(view.failing, ['transitions']);
  assert.equal(view.lines.length, 2);
});

test('timestamps render as a stable UTC string or null', () => {
  assert.equal(formatTimestamp('2026-01-01T12:34:56.789Z'), '2026-01-01 12:34:56 UTC');
  assert.equal(formatTimestamp(null), null);
  assert.equal(formatTimestamp('not a date'), null);
});
