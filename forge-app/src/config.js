// Fleet constants, statuses and Jira field ids for the Forge app.
//
// These deliberately mirror fleet-worker/src/config.js: the worker and the app
// must agree on the status names, the transition names and the custom fields,
// because every fleet state change is a Jira write made by whichever process
// gets there first. test/contract.test.js fails if the two drift apart.
export const CONSTANTS = {
  LEASE_REFRESH_MS: 5 * 60_000,
  LEASE_STALE_MS: 15 * 60_000,
  RUN_TIMEOUT_MS: 2 * 60 * 60_000,
  RETRY_BUDGET: 1,
  COMMENT_TAIL: 8,
};

export const STATUS = {
  BACKLOG: 'Backlog',
  TRIAGED: 'Triaged',
  READY: 'Ready for Build',
  IN_BUILD: 'In Build',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
  FAILED: 'Failed',
};

export const TRANSITION = {
  MARK_READY: 'Mark Ready',
  CLAIM: 'Claim',
  REPORT: 'Report PR',
  REQUEUE: 'Requeue',
  REJECT: 'Reject',
};

// On a real Jira tenant these are customfield_XXXXX ids, not display names.
// scripts/provision.mjs prints the ids; set them with `forge variables set`.
export const DEFAULT_FIELDS = {
  worker: 'Fleet Worker',
  lease: 'Fleet Lease',
  branch: 'Fleet Branch',
  pr: 'Fleet PR',
  retry: 'Fleet Retry',
};

export const READY_LABEL = 'fleet-ready';

export function loadConfig(env = process.env) {
  return {
    jira: {
      project: env.FLEET_PROJECT || 'FLT',
      fields: {
        worker: env.FLEET_FIELD_WORKER || DEFAULT_FIELDS.worker,
        lease: env.FLEET_FIELD_LEASE || DEFAULT_FIELDS.lease,
        branch: env.FLEET_FIELD_BRANCH || DEFAULT_FIELDS.branch,
        pr: env.FLEET_FIELD_PR || DEFAULT_FIELDS.pr,
        retry: env.FLEET_FIELD_RETRY || DEFAULT_FIELDS.retry,
      },
    },
    timings: {
      leaseRefreshMs: intOr(env.FLEET_LEASE_REFRESH_MS, CONSTANTS.LEASE_REFRESH_MS),
      leaseStaleMs: intOr(env.FLEET_LEASE_STALE_MS, CONSTANTS.LEASE_STALE_MS),
    },
    retryBudget: intOr(env.FLEET_RETRY_BUDGET, CONSTANTS.RETRY_BUDGET),
    mcp: {
      token: env.FLEET_MCP_TOKEN || '',
      defaultWorker: env.FLEET_MCP_WORKER || 'mcp-client',
    },
  };
}

function intOr(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function jqlFor(status, project) {
  return `project = ${project} AND status = "${status}" ORDER BY priority DESC, created ASC`;
}
