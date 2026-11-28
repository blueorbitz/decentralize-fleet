// The settings page's view model, kept out of the JSX.
//
// src/static/settings/index.jsx renders these; @forge/react refuses to load
// outside a Forge host, so anything worth asserting lives here instead. The
// components are then thin: they map this model to UI Kit components.

// The editable inputs, in the order the page renders them. `path` is the value
// path inside a record, so one form maps to the record shape the service saves.
export const CONNECTION_INPUTS = [
  { name: 'projectKey', label: 'Project key', hint: 'The Jira project the fleet builds from, e.g. FLT.' },
  { name: 'fields.worker', label: 'Fleet Worker field id', hint: 'customfield_XXXXX holding the claiming worker.' },
  { name: 'fields.lease', label: 'Fleet Lease field id', hint: 'customfield_XXXXX holding the last heartbeat.' },
  { name: 'fields.branch', label: 'Fleet Branch field id', hint: 'customfield_XXXXX holding the pushed branch.' },
  { name: 'fields.pr', label: 'Fleet PR field id', hint: 'customfield_XXXXX holding the pull request URL.' },
  { name: 'fields.retry', label: 'Fleet Retry field id', hint: 'customfield_XXXXX holding the retry budget used.' },
];

export const TIMING_INPUTS = [
  {
    name: 'worker.leaseRefreshMs',
    label: 'Lease refresh (ms)',
    hint: 'How often a worker renews its lease. Worker-only; the app does not read it.',
  },
  {
    name: 'timings.leaseStaleMs',
    label: 'Lease stale after (ms)',
    hint: 'When the reaper treats a claim as dead. The app and the worker both use it.',
  },
  {
    name: 'worker.retryBudget',
    label: 'Retry budget',
    hint: 'How many requeues a ticket gets before it moves to Failed. Worker-only.',
  },
];

// UI Kit's `useForm` uses dot syntax for nested fields (`register('fields.worker')`
// submits `{ fields: { worker } }`), so the form values are the record shape with
// numbers kept as strings. `formValues` seeds `defaultValues`; `formToRecord`
// turns a submission back into what the service saves.
export function formValues(record) {
  return {
    projectKey: record.projectKey,
    fields: { ...record.fields },
    timings: { leaseStaleMs: record.timings.leaseStaleMs },
    worker: { leaseRefreshMs: record.worker.leaseRefreshMs, retryBudget: record.worker.retryBudget },
  };
}

// Apply a form's values back onto the record shape the service expects.
export function formToRecord(values, { record, projectKey }) {
  return {
    projectKey: values?.projectKey ?? record.projectKey ?? projectKey,
    fields: {
      worker: values?.fields?.worker,
      lease: values?.fields?.lease,
      branch: values?.fields?.branch,
      pr: values?.fields?.pr,
      retry: values?.fields?.retry,
    },
    timings: {
      leaseStaleMs: numberOr(values?.timings?.leaseStaleMs, record.timings.leaseStaleMs),
    },
    worker: {
      leaseRefreshMs: numberOr(values?.worker?.leaseRefreshMs, record.worker.leaseRefreshMs),
      retryBudget: numberOr(values?.worker?.retryBudget, record.worker.retryBudget),
    },
  };
}

/**
 * Everything the page derives from one fleet.settings.get response.
 *
 * @returns {{
 *   project: { id: string, key: string|null },
 *   canEdit: boolean,
 *   configured: boolean,
 *   provenance: 'record'|'env',
 *   showConfigureCta: boolean,
 *   updatedAt: string|null,
 *   values: object,
 *   envBlock: string|null,
 *   notice: string|null,
 *   tokens: Array<{ id: string, name: string, createdAt: string|null }>,
 * }}
 */
export function buildPageState(payload) {
  const record = payload?.record;
  if (!record) throw new Error('the settings page needs a record');

  const canEdit = Boolean(payload.canEdit);
  const configured = Boolean(payload.configured);

  return {
    project: payload.project,
    canEdit,
    configured,
    provenance: payload.provenance || 'env',
    // Zero configured -> the page leads with a CTA rather than an empty form.
    showConfigureCta: !configured,
    updatedAt: record.updatedAt || null,
    values: formValues(record),
    // The worker block is a copy-paste artefact; a non-admin sees read-only
    // content, so it is rendered but not offered as an action.
    envBlock: payload.workerEnv || null,
    notice: canEdit
      ? null
      : 'You can view these settings, but only a project administrator can change them.',
    tokens: record.tokens || [],
  };
}

// The validation payload from fleet.settings.validate, flattened for display.
export function validationView(result) {
  const checks = result?.checks || [];
  return {
    ok: Boolean(result?.ok),
    failing: checks.filter((c) => !c.ok).map((c) => c.id),
    lines: result?.lines || [],
  };
}

// `updatedAt` as something an operator reads, or null so the caller can hide it.
export function formatTimestamp(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace('T', ' ').replace(/\..*$/, ' UTC');
}

function numberOr(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
