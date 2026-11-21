#!/usr/bin/env node
// Verify a Jira tenant is ready for the fleet, without moving any tickets.
//
// This is the check to run after provisioning: it proves the five fields exist,
// are writable, and that the workflow exposes the transitions the worker and the
// app resolve by name. A missing transition is the single most common way to
// break the fleet, and it is silent until a worker tries to claim.
//
// Usage:
//   node scripts/verify-setup.mjs --jira https://acme.atlassian.net \
//     --email bot@acme.com --token <api-token> [--project FLT]
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { DEFAULT_FIELDS, STATUS, TRANSITION, jqlFor } from '../src/config.js';

const REQUIRED_TRANSITIONS = [
  [STATUS.TRIAGED, TRANSITION.MARK_READY, STATUS.READY],
  [STATUS.READY, TRANSITION.CLAIM, STATUS.IN_BUILD],
  [STATUS.IN_BUILD, TRANSITION.REQUEUE, STATUS.READY],
  [STATUS.IN_BUILD, TRANSITION.REJECT, STATUS.FAILED],
  [STATUS.IN_BUILD, TRANSITION.REPORT, STATUS.IN_REVIEW],
];

function main() {
  const { values } = parseArgs({
    options: {
      jira: { type: 'string' },
      email: { type: 'string' },
      token: { type: 'string' },
      project: { type: 'string', default: 'FLT' },
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

export async function verify({ client, project, log = console.log }) {
  let ok = true;
  const fail = (msg) => {
    ok = false;
    log(`  FAIL  ${msg}`);
  };
  const pass = (msg) => log(`  ok    ${msg}`);

  log(`Fleet readiness — project ${project}\n`);

  log('Custom fields');
  const fields = await client.request('GET', (tag) => tag`/rest/api/3/field`);
  const byName = new Map((fields || []).map((f) => [f.name, f]));
  for (const name of Object.values(DEFAULT_FIELDS)) {
    const found = byName.get(name);
    if (found) pass(`${name.padEnd(14)} ${found.id}`);
    else fail(`${name} does not exist — run scripts/provision.mjs`);
  }

  log('\nProject and board');
  const projects = await client.request('GET', (tag) => tag`/rest/api/3/project/search?query=${project}&maxResults=20`);
  const found = (projects?.values || []).find((p) => p.key === project);
  if (!found) {
    fail(`project ${project} not found`);
    log(`\n${ok ? 'Ready.' : 'Not ready — see the failures above.'}`);
    return ok;
  }
  pass(`${project} exists (${found.projectTypeKey})`);

  log('\nWorkflow');
  // The transitions a worker needs are only observable from a ticket that is
  // actually in that status, so check the statuses exist first, then the
  // transitions on whichever ticket we can find.
  for (const status of Object.values(STATUS)) {
    try {
      await client.search(`project = ${project} AND status = "${status}"`, { maxResults: 1, fields: [] });
      pass(`status "${status}" exists`);
    } catch (err) {
      fail(`status "${status}" is not valid on this workflow (${err.message})`);
    }
  }

  let sample = (await client.search(jqlFor(STATUS.READY, project), { maxResults: 1, fields: [] }))[0];
  let inspectedFrom = STATUS.READY;
  if (!sample) {
    sample = (await client.search(jqlFor(STATUS.IN_BUILD, project), { maxResults: 1, fields: [] }))[0];
    inspectedFrom = STATUS.IN_BUILD;
  }
  if (!sample) {
    log('  skip  no Ready for Build or In Build ticket exists, so transitions cannot be read');
    log('        create one ticket and rerun to check the transition names');
    log(`\n${ok ? 'Ready.' : 'Not ready — see the failures above.'}`);
    return ok;
  }

  const available = (await client.getTransitions(sample.key)).map((t) => t.name);
  pass(`${sample.key} (${inspectedFrom}) exposes: ${available.join(', ') || 'none'}`);
  for (const [from, name, to] of REQUIRED_TRANSITIONS) {
    if (from !== inspectedFrom) {
      log(`  skip  ${from} -> ${name} -> ${to}  (needs a ticket in ${from})`);
      continue;
    }
    if (available.some((a) => a.toLowerCase() === name.toLowerCase())) pass(`${from} -> ${name} -> ${to}`);
    else fail(`${from} -> ${name} -> ${to} is missing (have: ${available.join(', ') || 'none'})`);
  }

  log(`\n${ok ? 'Ready.' : 'Not ready — see the failures above.'}`);
  return ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
