#!/usr/bin/env node
// Verify a Jira tenant is ready for the fleet, without moving any tickets.
//
// This is the check to run after provisioning: it proves the five fields exist,
// are writable, and that the workflow exposes the transitions the worker and the
// app resolve by name. A missing transition is the single most common way to
// break the fleet, and it is silent until a worker tries to claim.
//
// The checks themselves live in src/setup-check.js, because the Fleet settings
// page's "Test connection" runs exactly the same ones. This script is the
// command-line presentation of that module.
//
// Usage:
//   node scripts/verify-setup.mjs --jira https://acme.atlassian.net \
//     --email bot@acme.com --token <api-token> [--project FLT]
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { DEFAULT_FIELDS, DEFAULT_PROJECT } from '../src/config.js';
import { validateConfig } from '../src/setup-check.js';

function main() {
  const { values } = parseArgs({
    options: {
      jira: { type: 'string' },
      email: { type: 'string' },
      token: { type: 'string' },
      project: { type: 'string', default: DEFAULT_PROJECT },
    },
  });

  const baseUrl = values.jira || process.env.FLEET_JIRA_URL;
  const email = values.email || process.env.FLEET_JIRA_EMAIL;
  const token = values.token || process.env.FLEET_JIRA_TOKEN;
  if (!baseUrl || !email || !token) {
    console.error('missing --jira, --email and --token (or FLEET_JIRA_URL/EMAIL/TOKEN)');
    process.exit(2);
  }

  const client = new JiraClient({
    transport: basicTransport({ baseUrl, email, token }),
    project: values.project,
    fields: DEFAULT_FIELDS,
  });

  verify({ client, project: values.project }).then(
    (ok) => process.exit(ok ? 0 : 1),
    (err) => {
      console.error(`verification failed: ${err.message}`);
      if (err.body) console.error(JSON.stringify(err.body, null, 2));
      process.exit(1);
    },
  );
}

// Keeps the CLI's printed report, but every line comes from the shared checks.
export async function verify({ client, project, log = console.log }) {
  const record = { projectKey: project, fields: { ...DEFAULT_FIELDS } };
  log(`Fleet readiness — project ${project}\n`);
  const result = await validateConfig({ jira: client, record });
  for (const line of result.lines) log(line);
  return result.ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
