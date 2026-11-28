// Config + the hard-coded fleet constants.
//
// The design doc (docs/grill/codegeist-jira-ai-fleet.md) pins these numbers as
// constants rather than config: lease refresh 5 min, stale 15 min, run timeout
// 2h, retry budget 1, poll 30-60s. They are exported here so the worker, the
// reaper and the tests all read the same values. Tests may override timings.
import os from 'node:os';

export const CONSTANTS = {
  POLL_MIN_MS: 30_000,
  POLL_MAX_MS: 60_000,
  LEASE_REFRESH_MS: 5 * 60_000,
  LEASE_STALE_MS: 15 * 60_000,
  RUN_TIMEOUT_MS: 2 * 60 * 60_000,
  RETRY_BUDGET: 1,
  HEARTBEAT_INTERVAL_MS: 30_000,
};

// Kanban state machine (High #4 in the doc).
export const STATUS = {
  BACKLOG: 'Backlog',
  TRIAGED: 'Triaged',
  READY: 'Ready for Build',
  IN_BUILD: 'In Build',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
  FAILED: 'Failed',
};

// Transition names, resolved by name against the issue's available transitions.
export const TRANSITION = {
  CLAIM: 'Claim', // Ready for Build -> In Build
  REPORT: 'Report PR', // In Build -> In Review
  REQUEUE: 'Requeue', // In Build -> Ready for Build
  REJECT: 'Reject', // In Build -> Failed
};

// Fleet custom fields. On real Jira these are customfield_XXXXX ids; set the
// env vars to the real ids. The names below match the mock server and the doc.
export const DEFAULT_FIELDS = {
  worker: 'Fleet Worker',
  lease: 'Fleet Lease',
  branch: 'Fleet Branch',
  pr: 'Fleet PR',
  retry: 'Fleet Retry',
};

const BOOLEAN_FLAGS = new Set(['once', 'dry-run', 'verbose', 'help']);

function coerce(key, value) {
  if (BOOLEAN_FLAGS.has(key)) return value === undefined ? true : value !== 'false';
  return value;
}

// Minimal `--key value` / `--key=value` / `--flag` parser. No dependency.
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('-')) {
      out._.push(token);
      continue;
    }
    const body = token.replace(/^--?/, '');
    const eq = body.indexOf('=');
    if (eq !== -1) {
      const key = body.slice(0, eq);
      out[key] = coerce(key, body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      out[body] = coerce(body, next);
      i += 1;
    } else {
      out[body] = coerce(body, undefined);
    }
  }
  return out;
}

function pick(args, env, argKey, envKey, fallback) {
  if (args[argKey] !== undefined) return args[argKey];
  if (envKey && env[envKey] !== undefined && env[envKey] !== '') return env[envKey];
  return fallback;
}

function intOr(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function defaultWorkerId() {
  const host = os.hostname().split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `worker-${host.slice(0, 12)}`;
}

export class ConfigError extends Error {}

/**
 * Build the worker configuration from CLI args + env. Throws ConfigError with
 * an operator-friendly message when a required value is missing.
 */
export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const command = args._[0] && !args._[0].startsWith('-') ? args._[0] : 'run';

  const baseUrl = pick(args, env, 'jira', 'FLEET_JIRA_URL');
  const email = pick(args, env, 'email', 'FLEET_JIRA_EMAIL');
  const token = pick(args, env, 'token', 'FLEET_JIRA_TOKEN');
  const repoPath = pick(args, env, 'repo', 'FLEET_REPO');
  const workerId = pick(args, env, 'worker-id', 'FLEET_WORKER_ID', defaultWorkerId());

  const fields = {
    worker: pick(args, env, 'field-worker', 'FLEET_FIELD_WORKER', DEFAULT_FIELDS.worker),
    lease: pick(args, env, 'field-lease', 'FLEET_FIELD_LEASE', DEFAULT_FIELDS.lease),
    branch: pick(args, env, 'field-branch', 'FLEET_FIELD_BRANCH', DEFAULT_FIELDS.branch),
    pr: pick(args, env, 'field-pr', 'FLEET_FIELD_PR', DEFAULT_FIELDS.pr),
    retry: pick(args, env, 'field-retry', 'FLEET_FIELD_RETRY', DEFAULT_FIELDS.retry),
  };

  const cfg = {
    command,
    help: Boolean(args.help),
    verbose: Boolean(args.verbose),
    dryRun: Boolean(args['dry-run']),
    once: Boolean(args.once),
    jira: {
      baseUrl: baseUrl ? String(baseUrl).replace(/\/+$/, '') : undefined,
      email,
      token,
      project: pick(args, env, 'project', 'FLEET_PROJECT', 'FLT'),
      fields,
      jql: pick(args, env, 'jql', 'FLEET_JQL'),
    },
    repo: {
      path: repoPath,
      remote: pick(args, env, 'remote', 'FLEET_REMOTE'),
      // No default: the worker asks the remote which branch it considers HEAD.
      // Defaulting to 'main' broke every repository whose default is 'master'.
      baseBranch: pick(args, env, 'base-branch', 'FLEET_BASE_BRANCH'),
    },
    worker: {
      id: workerId,
      adapter: pick(args, env, 'adapter', 'FLEET_ADAPTER', 'cmdc'),
      adapterPath: pick(args, env, 'adapter-path', 'FLEET_ADAPTER_PATH'),
      once: Boolean(args.once),
      pollMinMs: intOr(pick(args, env, 'poll-min-ms', 'FLEET_POLL_MIN_MS'), CONSTANTS.POLL_MIN_MS),
      pollMaxMs: intOr(pick(args, env, 'poll-max-ms', 'FLEET_POLL_MAX_MS'), CONSTANTS.POLL_MAX_MS),
    },
    timings: {
      leaseRefreshMs: intOr(pick(args, env, 'lease-refresh-ms', 'FLEET_LEASE_REFRESH_MS'), CONSTANTS.LEASE_REFRESH_MS),
      leaseStaleMs: intOr(pick(args, env, 'lease-stale-ms', 'FLEET_LEASE_STALE_MS'), CONSTANTS.LEASE_STALE_MS),
      runTimeoutMs: intOr(pick(args, env, 'run-timeout-ms', 'FLEET_RUN_TIMEOUT_MS'), CONSTANTS.RUN_TIMEOUT_MS),
    },
    retryBudget: intOr(pick(args, env, 'retry-budget', 'FLEET_RETRY_BUDGET'), CONSTANTS.RETRY_BUDGET),
    gitHost: {
      kind: pick(args, env, 'git-host', 'FLEET_GIT_HOST', 'bitbucket'),
      workspace: pick(args, env, 'bb-workspace', 'FLEET_BB_WORKSPACE'),
      repoSlug: pick(args, env, 'bb-repo', 'FLEET_BB_REPO'),
      username: pick(args, env, 'bb-username', 'FLEET_BB_USERNAME'),
      appPassword: pick(args, env, 'bb-app-password', 'FLEET_BB_APP_PASSWORD'),
      authMode: pick(args, env, 'bb-auth', 'FLEET_BB_AUTH', 'auto'),
    },
    logFile: pick(args, env, 'log', 'FLEET_LOG'),
    heartbeat: {
      url: pick(args, env, 'heartbeat-url', 'FLEET_HEARTBEAT_URL'),
      // A heartbeat is authenticated with a Fleet token from Project settings.
      // FLEET_MCP_TOKEN is accepted as a migration fallback, matching the MCP
      // webtrigger's legacy token.
      token: pick(args, env, 'heartbeat-token', 'FLEET_HEARTBEAT_TOKEN') || env.FLEET_MCP_TOKEN,
      intervalMs: intOr(
        pick(args, env, 'heartbeat-interval-ms', 'FLEET_HEARTBEAT_INTERVAL_MS'),
        CONSTANTS.HEARTBEAT_INTERVAL_MS,
      ),
      machine: pick(args, env, 'machine', 'FLEET_MACHINE') || os.hostname(),
    },
  };

  validateConfig(cfg);
  return cfg;
}

function validateConfig(cfg) {
  if (cfg.help) return;
  const missing = [];
  if (!cfg.jira.baseUrl) missing.push('--jira (FLEET_JIRA_URL)');
  if (!cfg.jira.email) missing.push('--email (FLEET_JIRA_EMAIL)');
  if (!cfg.jira.token) missing.push('--token (FLEET_JIRA_TOKEN)');
  if (cfg.command === 'run' && !cfg.repo.path) missing.push('--repo (FLEET_REPO)');
  if (cfg.command === 'run' && cfg.worker.adapter !== 'script' && !cfg.worker.adapterPath && !cfg.worker.adapter) {
    missing.push('--adapter (FLEET_ADAPTER)');
  }
  // Heartbeat is opt-in: no URL means no presence registry, which is the
  // original worker behaviour. A URL without a token is a misconfiguration.
  if (cfg.heartbeat?.url && !cfg.heartbeat.token) {
    missing.push('--heartbeat-token (FLEET_HEARTBEAT_TOKEN)');
  }
  if (missing.length) {
    throw new ConfigError(`missing required config: ${missing.join(', ')}`);
  }
}

export function jqlFor(cfg) {
  if (cfg.jira.jql) return cfg.jira.jql;
  return `project = ${cfg.jira.project} AND status = "${STATUS.READY}" ORDER BY priority DESC, created ASC`;
}
