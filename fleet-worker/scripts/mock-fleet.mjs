#!/usr/bin/env node
// An offline fleet you can drive the real CLIs against: an in-process Jira with
// a seeded board, plus a scratch git repo with a real (local) origin.
//
// This exists so the worker can be exercised through its actual CLI — argv
// parsing, HTTP, git, the adapter subprocess — without a Jira Cloud tenant. It
// prints two lines to copy into another terminal, then prints the board whenever
// something changes.
//
//   node scripts/mock-fleet.mjs [--port 0] [--json]
//
// The MOCK_JIRA_URL it prints is a plain REST v3 endpoint: point
// `node bin/fleet-worker.js --jira $MOCK_JIRA_URL ...` at it.
import { parseArgs } from 'node:util';
import { MockJira } from '../test/helpers/mock-jira.js';
import { makeGitWorkspace } from '../test/helpers/git-fixture.js';

const TICKETS = [
  {
    key: 'FLT-101',
    summary: 'Add CSV export to the usage report',
    status: 'Ready for Build',
    description: 'Customers need their usage data out.\n\nAcceptance criteria\n- CSV button\n- 50k rows fast',
  },
  { key: 'FLT-102', summary: 'Rate-limit the /export API', status: 'Ready for Build' },
  { key: 'FLT-103', summary: 'Dark mode for the settings screen', status: 'Backlog' },
  { key: 'FLT-104', summary: 'Fix pagination off-by-one in results', status: 'In Review' },
];

function snapshot(mock) {
  return [...mock.issues.keys()]
    .sort()
    .map((key) => mock.plain(key))
    .map((t) => ({
      key: t.key,
      status: t.status,
      worker: t.worker,
      lease: t.lease,
      branch: t.branch,
      pr: t.pr,
      retry: t.retry,
      comments: t.comments.length,
    }));
}

function printBoard(mock) {
  const rows = snapshot(mock);
  console.log('\n--- board ' + '-'.repeat(58));
  for (const t of rows) {
    const worker = t.worker ? `worker=${t.worker}` : 'unclaimed';
    console.log(
      `  ${t.key.padEnd(8)} ${t.status.padEnd(16)} ${worker.padEnd(22)}` +
        `${t.pr ? `pr=${t.pr} ` : ''}${t.retry ? `retry=${t.retry} ` : ''}${t.comments ? `comments=${t.comments}` : ''}`,
    );
  }
}

async function main() {
  const { values } = parseArgs({ options: { json: { type: 'boolean', default: false } } });

  const mock = new MockJira();
  const baseUrl = await mock.start();
  for (const ticket of TICKETS) mock.addTicket(ticket);
  const ws = makeGitWorkspace();

  if (values.json) {
    console.log(JSON.stringify({ jira: baseUrl, repo: ws.workspace, tickets: snapshot(mock) }));
  } else {
    console.log('Offline fleet is up. Copy these into another terminal:\n');
    console.log(`  MOCK_JIRA_URL = ${baseUrl}`);
    console.log(`  MOCK_REPO     = ${ws.workspace}`);
    console.log(`\n  node bin/fleet-worker.js run --once --verbose \\`);
    console.log(`    --jira ${baseUrl} --email bot@demo --token demo --project FLT \\`);
    console.log(`    --repo "${ws.workspace}" --git-host local --worker-id worker-cli \\`);
    console.log(`    --adapter script --field-worker "Fleet Worker" --field-lease "Fleet Lease" \\`);
    console.log(`    --field-branch "Fleet Branch" --field-pr "Fleet PR" --field-retry "Fleet Retry"`);
    console.log('\nCtrl-C to stop. The board prints whenever it changes.\n');
    printBoard(mock);
  }

  // Poll the board and print a diff, so a CLI run in the other terminal is visible.
  let previous = JSON.stringify(snapshot(mock));
  setInterval(() => {
    const current = snapshot(mock);
    const encoded = JSON.stringify(current);
    if (encoded === previous) return;
    previous = encoded;
    if (values.json) console.log(encoded);
    else printBoard(mock);
  }, 1000);

  const shutdown = async () => {
    await mock.stop();
    ws.cleanup();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`mock-fleet crashed: ${err?.stack || err}`);
  process.exit(1);
});
