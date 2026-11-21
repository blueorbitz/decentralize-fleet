// Resolve everything the worker CLI needs from the environment and from Jira
// itself, so an operator does not have to type five customfield ids.
//
// Precedence, highest first:
//   1. an explicit CLI flag (handled by loadConfig, not here)
//   2. a process env var of the same name
//   3. a variable in the repo's .env file
//   4. whatever Jira reports for the field's display name
//
// The field lookup is the part that matters: on a real tenant the ids are
// customfield_XXXXX and nobody should be copying them by hand.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FIELDS } from './config.js';

// Minimal .env reader. Deliberately not a dependency, and deliberately tolerant:
// blank lines, # comments, optional `export `, and quoted or unquoted values.
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

/**
 * Read the nearest .env walking up from `startDir`. Returns {} when there is
 * none, so this is always safe to call.
 */
export function loadEnvFile(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      return { path: candidate, values: parseEnvFile(fs.readFileSync(candidate, 'utf8')) };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { path: null, values: {} };
}

/**
 * Resolve Jira settings from env vars, falling back to .env, then probe Jira
 * for the field ids. `env` is the process environment; `dotenv` is the parsed
 * file. Never throws for a missing optional value: the caller validates.
 */
export function resolveOperatorConfig({ env = process.env, dotenv = {}, cwd = process.cwd() } = {}) {
  const get = (...names) => {
    for (const name of names) {
      if (env[name] !== undefined && env[name] !== '') return env[name];
      if (dotenv[name] !== undefined && dotenv[name] !== '') return dotenv[name];
    }
    return undefined;
  };

  // Accept both the app's FLEET_* names and the plain names an operator is
  // likely to have in .env (JIRA_URL, JIRA_TOKEN, ...).
  const baseUrl = get('FLEET_JIRA_URL', 'JIRA_URL', 'ATLASSIAN_URL');
  const email = get('FLEET_JIRA_EMAIL', 'JIRA_EMAIL', 'ATLASSIAN_EMAIL');
  const token = get('FLEET_JIRA_TOKEN', 'JIRA_TOKEN', 'JIRA_API_TOKEN');
  const project = get('FLEET_PROJECT', 'JIRA_PROJECT') || 'FLT';
  const workerId = get('FLEET_WORKER_ID');
  const repo = get('FLEET_REPO');
  const remote = get('FLEET_REMOTE');
  // Leave null when unset: the worker asks the remote for its default branch.
  const baseBranch = get('FLEET_BASE_BRANCH') || null;
  const adapter = get('FLEET_ADAPTER') || 'script';
  // Default the PR host by whether Bitbucket is configured: with no credentials
  // there is nowhere to open a PR, and falling back to the real Bitbucket API
  // would fail with a confusing 401.
  const gitHost = get('FLEET_GIT_HOST');

  const bitbucket = {
    workspace: get('FLEET_BB_WORKSPACE', 'BITBUCKET_WORKSPACE'),
    repoSlug: get('FLEET_BB_REPO', 'BITBUCKET_REPO'),
    username: get('FLEET_BB_USERNAME', 'BITBUCKET_USERNAME'),
    appPassword: get('FLEET_BB_APP_PASSWORD', 'BITBUCKET_APP_PASSWORD'),
  };
  const bitbucketConfigured = Boolean(
    bitbucket.workspace && bitbucket.repoSlug && bitbucket.username && bitbucket.appPassword,
  );

  return {
    baseUrl: baseUrl ? String(baseUrl).replace(/\/+$/, '') : undefined,
    email,
    token,
    project,
    workerId,
    repo,
    remote,
    baseBranch,
    adapter,
    gitHost: gitHost || (bitbucketConfigured ? 'bitbucket' : 'local'),
    bitbucketConfigured,
    bitbucket,
    missing: [
      !baseUrl && 'JIRA_URL (or FLEET_JIRA_URL)',
      !email && 'JIRA_EMAIL (or FLEET_JIRA_EMAIL)',
      !token && 'JIRA_TOKEN (or FLEET_JIRA_TOKEN)',
    ].filter(Boolean),
  };
}

/**
 * Ask Jira for the id of each Fleet field by display name. Returns the ids that
 * were found, plus the names that were not, so the caller can report precisely
 * which field is missing rather than failing with a 400 three steps later.
 */
export async function discoverFields(jira, { names = DEFAULT_FIELDS } = {}) {
  const all = await jira.listFields();
  const byName = new Map((all || []).map((f) => [String(f.name).toLowerCase(), f.id]));

  const ids = {};
  const missing = [];
  for (const [key, name] of Object.entries(names)) {
    const id = byName.get(name.toLowerCase());
    if (id) ids[key] = id;
    else missing.push(name);
  }
  return { ids, missing };
}

/**
 * Turn resolved settings plus discovered ids into the argv loadConfig expects.
 * Keeping this as argv (rather than a config object) means the wrapper exercises
 * exactly the same parsing path as a hand-typed command.
 */
export function toWorkerArgs({ cfg, fieldIds, extra = [] }) {
  const args = ['run'];
  if (cfg.baseUrl) args.push('--jira', cfg.baseUrl);
  if (cfg.email) args.push('--email', cfg.email);
  if (cfg.token) args.push('--token', cfg.token);
  if (cfg.project) args.push('--project', cfg.project);
  if (cfg.workerId) args.push('--worker-id', cfg.workerId);
  if (cfg.repo) args.push('--repo', cfg.repo);
  if (cfg.remote) args.push('--remote', cfg.remote);
  if (cfg.baseBranch) args.push('--base-branch', cfg.baseBranch);
  if (cfg.adapter) args.push('--adapter', cfg.adapter);
  if (cfg.gitHost) args.push('--git-host', cfg.gitHost);

  const flag = {
    worker: '--field-worker',
    lease: '--field-lease',
    branch: '--field-branch',
    pr: '--field-pr',
    retry: '--field-retry',
  };
  for (const [key, name] of Object.entries(flag)) {
    if (fieldIds?.[key]) args.push(name, fieldIds[key]);
  }

  const bb = cfg.bitbucket || {};
  if (bb.workspace) args.push('--bb-workspace', bb.workspace);
  if (bb.repoSlug) args.push('--bb-repo', bb.repoSlug);
  if (bb.username) args.push('--bb-username', bb.username);
  if (bb.appPassword) args.push('--bb-app-password', bb.appPassword);

  return [...args, ...extra];
}
