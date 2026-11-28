#!/usr/bin/env node
// Provision the Jira side of the fleet: the Fleet custom fields and the FLT
// Kanban project. Everything that the REST API genuinely cannot do — attaching
// the fields to the screen, and authoring the workflow transitions — is printed
// as an explicit checklist at the end, because it is Jira-admin work.
//
// Usage:
//   node scripts/provision.mjs --jira https://acme.atlassian.net \
//     --email admin@acme.com --token <api-token> [--project FLT] [--dry-run]
//
// Token: an API token from https://id.atlassian.com/manage/api-tokens, used with
// the email of an account that can *Administer Jira*.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { JiraClient } from '../src/jira.js';
import { basicTransport } from '../src/transports.js';
import { DEFAULT_FIELDS } from '../src/config.js';
import { checkAdmin } from './jira-admin.mjs';

const FIELDS = [
  {
    name: DEFAULT_FIELDS.worker,
    type: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield',
    searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:textsearcher',
    description: 'The worker id that holds the claim. Written by the worker and the app.',
  },
  {
    name: DEFAULT_FIELDS.lease,
    type: 'com.atlassian.jira.plugin.system.customfieldtypes:datetime',
    searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:datetimerange',
    description: 'Last heartbeat. Stale after 15 minutes; the reaper requeues on that.',
  },
  {
    name: DEFAULT_FIELDS.branch,
    type: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield',
    searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:textsearcher',
    description: 'The branch the worker pushed for this ticket.',
  },
  {
    name: DEFAULT_FIELDS.pr,
    type: 'com.atlassian.jira.plugin.system.customfieldtypes:url',
    searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:exacttextsearcher',
    description: 'The pull request the worker opened. A human merges it.',
  },
  {
    name: DEFAULT_FIELDS.retry,
    type: 'com.atlassian.jira.plugin.system.customfieldtypes:float',
    searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:exactnumber',
    description: 'Retry budget used. The fleet requeues once, then moves the ticket to Failed.',
  },
];

const WORKFLOW = [
  ['Backlog', 'Triage', 'Triaged'],
  ['Triaged', 'Mark Ready', 'Ready for Build'],
  ['Ready for Build', 'Claim', 'In Build'],
  ['In Build', 'Requeue', 'Ready for Build'],
  ['In Build', 'Reject', 'Failed'],
  ['In Build', 'Report PR', 'In Review'],
  ['Failed', 'Requeue', 'Ready for Build'],
  ['In Review', 'Finish', 'Done'],
];

function main() {
  const { values } = parseArgs({
    options: {
      jira: { type: 'string' },
      email: { type: 'string' },
      token: { type: 'string' },
      project: { type: 'string', default: 'FLT' },
      'lead-account-id': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
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

  run({
    client,
    email,
    project: values.project,
    leadAccountId: values['lead-account-id'] || process.env.FLEET_JIRA_LEAD_ACCOUNT_ID,
    dryRun: values['dry-run'],
  }).catch((err) => {
    if (err instanceof AdminRequiredError) {
      console.error(err.message);
      process.exit(3);
    }
    console.error(`provisioning failed: ${err.message}`);
    if (err.body) console.error(JSON.stringify(err.body, null, 2));
    process.exit(1);
  });
}

export class AdminRequiredError extends Error {}

async function run({ client, email, project, leadAccountId, dryRun }) {
  console.log(`Fleet provisioning — project ${project}${dryRun ? ' (dry run)' : ''}\n`);

  // Creating custom fields is a global-admin operation. Jira answers a
  // non-admin with a 400 whose text is usually translated, so a preflight keeps
  // the failure legible and names the account that actually lacks the right.
  const admin = await checkAdmin({ client });
  if (!admin.ok) {
    throw new AdminRequiredError(admin.message);
  }
  console.log(`Account: ${admin.displayName} (${admin.email || email}) — Jira administrator\n`);

  const existing = await client.request('GET', (tag) => tag`/rest/api/3/field`);

  console.log('Fleet custom fields');
  const fieldIds = {};
  for (const field of FIELDS) {
    const found = (existing || []).find((f) => f.name === field.name);
    if (found) {
      fieldIds[field.name] = found.id;
      console.log(`  = ${field.name.padEnd(14)} ${found.id}  (already exists)`);
      continue;
    }
    if (dryRun) {
      console.log(`  + ${field.name.padEnd(14)} would create ${field.type.split(':').pop()}`);
      continue;
    }
    const created = await client.request('POST', (tag) => tag`/rest/api/3/field`, {
      name: field.name,
      type: field.type,
      searcherKey: field.searcherKey,
      description: field.description,
    });
    fieldIds[field.name] = created.id;
    console.log(`  + ${field.name.padEnd(14)} ${created.id}  (created)`);
  }

  console.log('\nProject');
  const projects = await client.request('GET', (tag) => tag`/rest/api/3/project/search?query=${project}&maxResults=20`);
  const projectExists = (projects?.values || []).some((p) => p.key === project);
  if (projectExists) {
    console.log(`  = ${project} already exists`);
  } else if (dryRun) {
    console.log(`  + ${project} would be created as a company-managed Kanban project`);
  } else if (!leadAccountId) {
    // Jira refuses a project with no lead, and there is no safe default: an
    // account id is not derivable from an email address.
    console.log(`  ! ${project} not created: pass --lead-account-id <accountId>`);
    console.log('    (find it at https://acme.atlassian.net/rest/api/3/myself -> accountId,');
    console.log('     or use the account id of the Fleet Bot user that will own the project)');
  } else {
    const created = await client.request('POST', (tag) => tag`/rest/api/3/project`, {
      key: project,
      name: 'Fleet',
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
      description: 'The board the decentralized AI fleet builds from.',
      leadAccountId,
    });
    console.log(`  + ${project} created (${created?.key})`);
  }

  printChecklist({ project, fieldIds });
}

function printChecklist({ project, fieldIds }) {
  const id = (name) => fieldIds[name] || '<customfield_id>';

  console.log(`
Remaining admin steps (Jira cannot do these over REST)
=====================================================

1. Attach the five fields to the project's screens
   Jira settings -> Issues -> Screens -> (the screen used by ${project}) -> add:
     ${DEFAULT_FIELDS.worker}   ${id(DEFAULT_FIELDS.worker)}
     ${DEFAULT_FIELDS.lease}    ${id(DEFAULT_FIELDS.lease)}
     ${DEFAULT_FIELDS.branch}   ${id(DEFAULT_FIELDS.branch)}
     ${DEFAULT_FIELDS.pr}       ${id(DEFAULT_FIELDS.pr)}
     ${DEFAULT_FIELDS.retry}    ${id(DEFAULT_FIELDS.retry)}
   Without this the fields exist but cannot be written by a transition.

2. Author the workflow. Every transition name must match exactly, because the
   worker and the app resolve transitions by name:
${WORKFLOW.map(([from, name, to]) => `     ${from.padEnd(16)} -> ${name.padEnd(10)} -> ${to}`).join('\n')}

   Failed -> Ready for Build is the same "Requeue" transition, so a human can
   requeue a failed run from the panel.

3. Give the Fleet Bot account "Browse projects", "Edit issues" and
   "Transition issues" on ${project} only. It needs no admin and no other project.

4. Open Project settings -> Fleet settings and fill in the project key and the
   field ids above. That page is the source of truth: it stores the config in
   Forge's key-value store and generates the worker's .env. It also checks the
   field ids and transitions, so Test connection fails loudly on a typo.

   The project and the app do not have to be deployed yet for the ids to be
   correct; the page is per project, so open it on ${project}.

   CI/automation fallback: the same values can be supplied as app environment
   variables instead of using the page. They prefill a project that has never
   been saved, and remain the documented fallback for automation:

     forge variables set FLEET_PROJECT        ${project}
     forge variables set FLEET_FIELD_WORKER   ${id(DEFAULT_FIELDS.worker)}
     forge variables set FLEET_FIELD_LEASE    ${id(DEFAULT_FIELDS.lease)}
     forge variables set FLEET_FIELD_BRANCH   ${id(DEFAULT_FIELDS.branch)}
     forge variables set FLEET_FIELD_PR       ${id(DEFAULT_FIELDS.pr)}
     forge variables set FLEET_FIELD_RETRY    ${id(DEFAULT_FIELDS.retry)}

   Then \`forge deploy\`. The same values go to every worker as FLEET_* env vars.

Verify with: node scripts/verify-setup.mjs --jira ... --email ... --token ... --project ${project}
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { FIELDS, WORKFLOW };
