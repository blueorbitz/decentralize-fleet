#!/usr/bin/env node
// Run verify-setup using the same .env the worker uses, so an operator does not
// have to retype the Jira URL, email and token on the command line.
//
//   node scripts/verify-from-env.mjs [--project FLT]
//
// Accepts both the app's FLEET_* names and the plain JIRA_* names. Uses the
// Fleet Bot token (this only reads), not the admin token.
import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadEnvFile } from '../../fleet-worker/src/operator-config.js';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { DEFAULT_FIELDS } from '../src/config.js';
import { verify } from './verify-setup.mjs';

function pick(env, dotenv, ...names) {
  for (const name of names) {
    if (env[name]) return env[name];
    if (dotenv[name]) return dotenv[name];
  }
  return undefined;
}

async function main() {
  const { values } = parseArgs({ options: { project: { type: 'string' } } });

  // One .env for the repo, at its root. Same search as fleet-run: cwd upward,
  // then the repo root, then beside the worker package.
  const here = path.resolve(import.meta.dirname);
  const repoRoot = path.resolve(here, '..', '..');
  const candidates = [process.cwd(), repoRoot, path.join(repoRoot, 'fleet-worker')];
  let envFile = { path: null, values: {} };
  for (const dir of candidates) {
    const found = loadEnvFile(dir);
    if (found.path) {
      envFile = found;
      break;
    }
  }

  if (envFile.path) console.log(`Config: ${envFile.path}\n`);
  else console.log('Config: environment only (no .env found)\n');

  const baseUrl = pick(process.env, envFile.values, 'FLEET_JIRA_URL', 'JIRA_URL');
  const email = pick(process.env, envFile.values, 'FLEET_JIRA_EMAIL', 'JIRA_EMAIL');
  const token = pick(process.env, envFile.values, 'FLEET_JIRA_TOKEN', 'JIRA_TOKEN', 'JIRA_API_TOKEN');
  const project = values.project || pick(process.env, envFile.values, 'FLEET_PROJECT', 'JIRA_PROJECT') || 'FLT';

  const missing = [
    !baseUrl && 'JIRA_URL',
    !email && 'JIRA_EMAIL',
    !token && 'JIRA_TOKEN',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing: ${missing.join(', ')}`);
    console.error('Add them to the .env at the repo root (see .env.example), or pass them in the environment.');
    process.exit(2);
  }

  const client = new JiraClient({
    transport: basicTransport({ baseUrl, email, token }),
    project,
    fields: DEFAULT_FIELDS,
  });

  const ok = await verify({ client, project });
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`verification failed: ${err.message}`);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
