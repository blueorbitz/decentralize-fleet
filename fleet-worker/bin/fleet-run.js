#!/usr/bin/env node
// `fleet-run` — start a worker without typing the whole command.
//
// It reads configuration from the environment (and from a .env file, because an
// operator usually keeps these there), then asks Jira which customfield id each
// Fleet field actually has. On a real tenant those ids are customfield_XXXXX and
// copying five of them by hand is the most likely way to get this wrong.
//
// Then it hands the equivalent argv to the normal CLI, so a bug here cannot
// diverge from `fleet-worker run`.
//
//   node bin/fleet-run.js              # one poll cycle, then exit
//   node bin/fleet-run.js --loop       # poll forever
//   node bin/fleet-run.js --check      # resolve and print the plan, run nothing
//   node bin/fleet-run.js -- <args>    # pass extra flags through to fleet-worker
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadEnvFile,
  resolveOperatorConfig,
  discoverFields,
  toWorkerArgs,
} from '../src/operator-config.js';
import { JiraClient, JiraError } from '../src/jira.js';
import { GitClient } from '../src/git.js';
import { DEFAULT_FIELDS } from '../src/config.js';
import { main as workerMain } from '../src/cli.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseFlags(argv) {
  const flags = { check: false, loop: false, dryRun: false, verbose: false, passThrough: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '--check') flags.check = true;
    else if (arg === '--loop') flags.loop = true;
    else if (arg === '--verbose') {
      flags.verbose = true;
      rest.push(arg);
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else rest.push(arg);
  }
  flags.passThrough = rest;
  return flags;
}

function redact(args) {
  const out = [...args];
  const secret = ['--token', '--bb-app-password'];
  for (let i = 0; i < out.length - 1; i += 1) {
    if (secret.includes(out[i])) out[i + 1] = '****';
  }
  return out;
}

// The first .env found by searching each directory in turn.
function firstEnvFile(dirs) {
  for (const dir of dirs) {
    const found = loadEnvFile(dir);
    if (found.path) return found;
  }
  return { path: null, values: {} };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  // There is one .env for the repo, at its root. Search order:
  //   1. from the cwd upward (so running from a subdirectory still works)
  //   2. the repo root explicitly (cwd may be outside the tree entirely)
  //   3. beside the launcher, for a package checked out on its own
  // FLEET_NO_ENV=1 skips all of it, which tests need: a developer's real .env
  // must not leak into a run that is meant to be isolated.
  const skipEnvFile = process.env.FLEET_NO_ENV === '1';
  const launcherDir = path.resolve(HERE, '..');
  const repoRoot = path.resolve(launcherDir, '..');
  const envFile = skipEnvFile
    ? { path: null, values: {} }
    : firstEnvFile([process.cwd(), repoRoot, launcherDir]);

  // Export .env values into this process before resolving config. The worker
  // spawns the harness as a child process, which inherits process.env — that is
  // how FLEET_SCRIPT_* and adapter settings reach it. Without this, a value in
  // .env would configure the wrapper but silently not reach the adapter.
  for (const [key, value] of Object.entries(envFile.values)) {
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }

  const cfg = resolveOperatorConfig({ env: process.env, dotenv: envFile.values });

  const configSource = envFile.path
    ? `environment + ${path.relative(process.cwd(), envFile.path) || '.env'}`
    : 'environment only (no .env found)';
  console.log(`Config: ${configSource}`);

  if (cfg.missing.length) {
    console.error(`\nMissing required configuration:\n  ${cfg.missing.join('\n  ')}`);
    console.error('\nSet them in your shell, or add them to a .env file:');
    console.error('  JIRA_URL=https://your-site.atlassian.net');
    console.error('  JIRA_EMAIL=you@example.com');
    console.error('  JIRA_TOKEN=...        (the Fleet Bot token, not the admin one)');
    console.error('  JIRA_PROJECT=FLT');
    console.error('  FLEET_REPO=C:\\path\\to\\a\\git\\workspace');
    process.exit(2);
  }

  const jira = new JiraClient({
    baseUrl: cfg.baseUrl,
    email: cfg.email,
    token: cfg.token,
    project: cfg.project,
    fields: DEFAULT_FIELDS,
  });

  let me;
  try {
    me = await jira.whoami();
  } catch (err) {
    if (err instanceof JiraError && err.status === 401) {
      console.error(`\nJira rejected ${cfg.email} (HTTP 401).`);
      console.error('Check that JIRA_EMAIL and JIRA_TOKEN belong to the same account.');
      process.exit(3);
    }
    throw err;
  }

  let discovered;
  try {
    discovered = await discoverFields(jira);
  } catch (err) {
    console.error(`\nCould not list Jira fields: ${err.message}`);
    process.exit(1);
  }

  console.log(`Jira:   ${cfg.baseUrl} as ${me?.displayName || cfg.email} (project ${cfg.project})`);

  if (discovered.missing.length) {
    console.error(`\nThese Fleet fields do not exist on ${cfg.baseUrl}:`);
    for (const name of discovered.missing) console.error(`  - ${name}`);
    console.error('\nCreate them with:  node ../forge-app/scripts/provision.mjs --jira ... --token ...');
    process.exit(4);
  }

  console.log('Fields:');
  for (const [key, id] of Object.entries(discovered.ids)) {
    console.log(`  ${DEFAULT_FIELDS[key].padEnd(13)} ${id}`);
  }
  console.log(`PR host: ${cfg.gitHost}${cfg.gitHost === 'local' ? ' (no Bitbucket credentials, so PRs are recorded locally)' : ''}`);

  // Show the base branch the worker will actually use. Detecting it here means
  // `--check` answers "which branch will this cut from?" before a run starts.
  if (cfg.repo) {
    try {
      const probe = new GitClient({ dir: cfg.repo, remote: cfg.remote, baseBranch: cfg.baseBranch });
      if (cfg.remote) {
        try {
          probe.git(['remote', 'get-url', 'origin']);
        } catch {
          probe.git(['clone', cfg.remote, '.']);
        }
      }
      const detected = cfg.baseBranch || probe.detectBaseBranch();
      if (detected) {
        console.log(`Base branch: ${detected}${cfg.baseBranch ? ' (configured)' : ' (detected from the remote)'}`);
      } else {
        console.log('Base branch: UNKNOWN — set FLEET_BASE_BRANCH (remote has: ' +
          `${probe.remoteBranches().join(', ') || 'no branches'})`);
      }
    } catch (err) {
      console.log(`Base branch: could not check (${err.message})`);
    }
  }

  // Default to a single poll cycle so a first run cannot hang, and so the
  // command is safe to paste. --loop opts into the daemon.
  const extra = [...flags.passThrough];
  if (!flags.loop && !extra.includes('--once')) extra.push('--once');
  if (flags.dryRun && !extra.includes('--dry-run')) extra.push('--dry-run');

  const args = toWorkerArgs({ cfg, fieldIds: discovered.ids, extra });

  if (flags.check || flags.verbose) {
    console.log(`\nWould run:\n  fleet-worker ${redact(args).join(' ')}\n`);
  }
  if (flags.check) return;

  const code = await workerMain(args, process.env);
  process.exit(code);
}

main().catch((err) => {
  console.error(`fleet-run failed: ${err?.stack || err}`);
  process.exit(1);
});
