// Operator CLI: `fleet-worker run` (default) and `fleet-worker reap`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError } from './config.js';
import { Logger } from './logger.js';
import { JiraClient } from './jira.js';
import { Worker, reap } from './worker.js';

const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

const HELP = `fleet-worker ${pkg.version} — Jira-driven worker for the decentralized AI fleet

Usage:
  fleet-worker run   [options]     Poll Jira, claim and build tickets (default)
  fleet-worker reap  [options]     Requeue In Build tickets with stale leases
  fleet-worker --help | --version

  (the fleet MCP server is a separate bin: fleet-mcp — see the README)

Core options:
  --jira <url>        Jira base URL (env FLEET_JIRA_URL)
  --email <email>     Fleet bot email (env FLEET_JIRA_EMAIL)
  --token <token>     Jira API token (env FLEET_JIRA_TOKEN)
  --project <key>     Jira project key (env FLEET_PROJECT, default FLT)
  --repo <path>       Local git workspace, cloned if empty (env FLEET_REPO)
  --remote <url>      Git remote to clone (env FLEET_REMOTE)
  --base-branch <b>   Base branch (env FLEET_BASE_BRANCH, default main)
  --worker-id <id>    Worker identity (env FLEET_WORKER_ID, default worker-<host>)
  --adapter <name>    Harness adapter: cmdc | opencode | copilot | kiro | script (default cmdc)
  --adapter-path <p>  Run an adapter script at an explicit path
  --once              Run a single poll cycle and exit
  --verbose           Verbose logging
  --log <file>        Mirror the run log to a file

Fleet field ids (default to the human names; set to customfield_* on real Jira):
  --field-worker --field-lease --field-branch --field-pr --field-retry

Bitbucket PR host:
  --git-host <kind>   bitbucket | local (env FLEET_GIT_HOST, default bitbucket)
  --bb-workspace --bb-repo --bb-username --bb-app-password
  --bb-auth <mode>    auto | bearer | basic (env FLEET_BB_AUTH, default auto)

Heartbeat (optional presence registry):
  --heartbeat-url <url>        Fleet heartbeat webtrigger (env FLEET_HEARTBEAT_URL)
  --heartbeat-token <token>    A Fleet token from Project settings (env FLEET_HEARTBEAT_TOKEN)
  --heartbeat-interval-ms <n>  Beat interval, default 30000 (env FLEET_HEARTBEAT_INTERVAL_MS)
  --machine <name>             Display name shown in the Fleet page (env FLEET_MACHINE)

Everything else has a documented default (lease 5m/15m, run timeout 2h, retry 1,
poll 30-60s) — see docs/grill/codegeist-jira-ai-fleet.md.
`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  let cfg;
  try {
    cfg = loadConfig(argv, env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`error: ${err.message}\n\n${HELP}`);
      return 2;
    }
    throw err;
  }

  if (cfg.help || cfg.command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const logger = new Logger({ verbose: cfg.verbose, file: cfg.logFile });

  try {
    if (cfg.command === 'reap') {
      const jira = new JiraClient({
        baseUrl: cfg.jira.baseUrl,
        email: cfg.jira.email,
        token: cfg.jira.token,
        project: cfg.jira.project,
        fields: cfg.jira.fields,
      });
      const result = await reap({ cfg, jira, logger });
      return result.requeued > 0 ? 0 : 0;
    }

    const worker = new Worker({ cfg, logger });
    const stop = (sig) => {
      logger.info(`${sig} received — finishing the current cycle then stopping`);
      worker.stop();
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));

    logger.info(`fleet-worker ${pkg.version} as ${cfg.worker.id} (adapter=${cfg.worker.adapter})`);
    if (worker.heartbeat) {
      logger.info(
        `heartbeat → ${cfg.heartbeat.url} every ${Math.round(cfg.heartbeat.intervalMs / 1000)}s as ${cfg.heartbeat.machine}`,
      );
    } else {
      logger.debug('heartbeat disabled — set FLEET_HEARTBEAT_URL to show this worker on the Fleet page');
    }
    if (cfg.once) {
      worker.heartbeat?.start();
      try {
        const summary = await worker.pollOnce();
        logger.info('poll summary', summary);
      } finally {
        await worker.heartbeat?.stop();
      }
      return 0;
    }
    await worker.runLoop();
    return 0;
  } finally {
    await logger.close();
  }
}
