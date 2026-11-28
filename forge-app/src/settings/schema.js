// The fleet's per-project configuration: KVS key scheme and record shape.
//
// Runtime-free on purpose. Nothing here imports @forge/kvs, @forge/api or a
// Forge runtime, so the store, the service and the format all run under
// `node --test` against an in-memory store.
//
// Two kinds of data, one principle (grill D3, D10):
//   - the unencrypted record holds only what a page needs to render: ids,
//     timings, token *metadata* and updatedAt. It is queryable.
//   - token values live in the KVS secret store, keyed per token, and are never
//     listed by a query. A leak of the record is not a leak of the secrets.
import { CONSTANTS, DEFAULT_FIELDS, DEFAULT_PROJECT, WORKER_DEFAULTS } from '../config.js';

export const CONFIG_PREFIX = 'fleet:config:project:';
export const TOKEN_PREFIX = 'fleet:token:';

export const FIELD_KEYS = ['worker', 'lease', 'branch', 'pr', 'retry'];

export function configKey(projectId) {
  return `${CONFIG_PREFIX}${projectId}`;
}

export function tokenKey(projectId, tokenId) {
  return `${TOKEN_PREFIX}${projectId}:${tokenId}`;
}

export function tokenPrefix(projectId) {
  return `${TOKEN_PREFIX}${projectId}:`;
}

// What a record looks like while the page prefills it from env vars, before
// anyone has saved. Tokens are empty because they cannot be invented from an
// env var without being written back.
export function defaultRecord({ projectId, projectKey, env = {} } = {}) {
  return {
    projectId: projectId ?? null,
    projectKey: projectKey || env.FLEET_PROJECT || DEFAULT_PROJECT,
    fields: {
      worker: env.FLEET_FIELD_WORKER || DEFAULT_FIELDS.worker,
      lease: env.FLEET_FIELD_LEASE || DEFAULT_FIELDS.lease,
      branch: env.FLEET_FIELD_BRANCH || DEFAULT_FIELDS.branch,
      pr: env.FLEET_FIELD_PR || DEFAULT_FIELDS.pr,
      retry: env.FLEET_FIELD_RETRY || DEFAULT_FIELDS.retry,
    },
    timings: {
      leaseStaleMs: intOr(env.FLEET_LEASE_STALE_MS, CONSTANTS.LEASE_STALE_MS),
    },
    worker: {
      leaseRefreshMs: intOr(env.FLEET_LEASE_REFRESH_MS, WORKER_DEFAULTS.leaseRefreshMs),
      retryBudget: intOr(env.FLEET_RETRY_BUDGET, WORKER_DEFAULTS.retryBudget),
    },
    tokens: [],
    updatedAt: null,
  };
}

// Coerce whatever is in storage into the exact shape the service and the page
// agree on. Unknown keys are dropped; missing ones are filled from the defaults
// so an older or partially written record still loads.
export function normalizeRecord(raw, { projectId, projectKey } = {}) {
  const base = defaultRecord({ projectId, projectKey });
  if (!raw || typeof raw !== 'object') return base;

  const fields = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};
  return {
    projectId: raw.projectId || projectId || base.projectId,
    projectKey: raw.projectKey || projectKey || base.projectKey,
    fields: {
      worker: text(fields.worker, base.fields.worker),
      lease: text(fields.lease, base.fields.lease),
      branch: text(fields.branch, base.fields.branch),
      pr: text(fields.pr, base.fields.pr),
      retry: text(fields.retry, base.fields.retry),
    },
    timings: {
      leaseStaleMs: intOr(raw.timings?.leaseStaleMs, base.timings.leaseStaleMs),
    },
    worker: {
      leaseRefreshMs: intOr(raw.worker?.leaseRefreshMs, base.worker.leaseRefreshMs),
      retryBudget: intOr(raw.worker?.retryBudget, base.worker.retryBudget),
    },
    tokens: (Array.isArray(raw.tokens) ? raw.tokens : [])
      .filter((t) => t && typeof t === 'object' && t.id)
      .map((t) => ({
        id: String(t.id),
        name: text(t.name, 'token'),
        createdAt: t.createdAt || null,
      })),
    updatedAt: raw.updatedAt || null,
  };
}

// What the page submits. Fields, timings and the worker knobs are editable;
// tokens are managed by their own actions, never by the form.
export function recordFromInput(input, { projectId, projectKey }) {
  const base = defaultRecord({ projectId, projectKey });
  const fields = input?.fields || {};
  return {
    projectId: projectId ?? base.projectId,
    projectKey: text(input?.projectKey, base.projectKey),
    fields: Object.fromEntries(
      FIELD_KEYS.map((key) => [key, text(fields[key], base.fields[key])]),
    ),
    timings: {
      leaseStaleMs: intOr(input?.timings?.leaseStaleMs, base.timings.leaseStaleMs),
    },
    worker: {
      leaseRefreshMs: intOr(input?.worker?.leaseRefreshMs, base.worker.leaseRefreshMs),
      retryBudget: intOr(input?.worker?.retryBudget, base.worker.retryBudget),
    },
    tokens: [],
    updatedAt: null,
  };
}

// The shape fleet's own code consumes. This is what fleet-worker's config
// looks like, so a panel, the reaper and an MCP server can take it unchanged.
export function toEffectiveConfig(record, { defaultWorker = 'mcp-client' } = {}) {
  return {
    jira: {
      project: record.projectKey,
      fields: { ...record.fields },
    },
    timings: { leaseStaleMs: record.timings.leaseStaleMs },
    retryBudget: record.worker.retryBudget,
    worker: { leaseRefreshMs: record.worker.leaseRefreshMs, retryBudget: record.worker.retryBudget },
    mcp: { defaultWorker },
  };
}

function text(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const str = String(value).trim();
  return str ? str : fallback;
}

function intOr(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
