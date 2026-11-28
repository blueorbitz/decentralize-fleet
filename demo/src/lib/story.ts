import type { BoardTicket } from '../components/Board';

// One ticket, one story. The footage beats all show the same real ticket, so
// these constants describe it for the two scenes that still draw it: the
// solution overview and the claim race.
export const TICKET = {
  key: 'FLT-7',
  summary: 'Add CSV export to the usage report',
  branch: 'FLT-7-add-csv-export-to-the-usage-report',
  pr: 'Pull request #6',
  prUrl: 'bitbucket.org/captain-sage/fleet-test/pull-requests/6',
  workerA: 'worker-04',
  workerB: 'worker-11',
  ac: [
    'GET /reports/usage accepts format=csv',
    'Streams rows instead of buffering the full report',
    'Export button gated on the Reports permission',
  ],
} as const;

export const BOARD_TICKETS: BoardTicket[] = [
  { key: 'FLT-1', summary: 'Create a Hello world README.md', status: 'In Review', pr: 'PR #4' },
  { key: 'FLT-3', summary: 'Add CSV export to the usage report', status: 'In Review', pr: 'PR #5' },
  { key: 'FLT-7', summary: TICKET.summary, status: 'In Build', labels: ['fleet-ready'], worker: 'worker-04' },
  { key: 'FLT-2', summary: TICKET.summary, status: 'Triaged', labels: ['fleet-ready'] },
];

// The claim race, in the workers' own words.
//
// LOG_A is the real stdout of a full run on the tenant (demo/public/logs was
// captured by scripts/capture-live.mjs), with the site address and bot account
// replaced. LOG_B is the same ticket seen by the machine that lost the claim: it
// is the worker's own rejection line, which is the point of the beat. Nothing
// here is invented prose.
export const LOG_A = [
  { text: '$ fleet-run --loop', tone: 'dim' as const },
  { text: 'Jira:   acme.atlassian.net as fleet-bot (project FLT)', tone: 'info' as const },
  { text: 'PR host: bitbucket · base branch main', tone: 'info' as const },
  { text: '10:23:45  worker-04 (adapter=opencode)', tone: 'info' as const },
  { text: '10:23:46  1 claimable → FLT-7', tone: 'info' as const },
  { text: '10:23:46  claim → transition Ready for Build → In Build  (CAS)', tone: 'info' as const },
  { text: '10:23:47  verify ok — fleet_worker=worker-04', tone: 'ok' as const },
  { text: '10:23:51  git reset origin/main @ 4360ca95 · branch FLT-7-add-csv-export', tone: 'info' as const },
  { text: '10:23:51  adapter=opencode — running harness', tone: 'info' as const },
  { text: '10:24:59  adapter status=ok tests=11/11', tone: 'ok' as const },
  { text: '10:25:06  pushed · PR #6 · transition In Build → In Review', tone: 'ok' as const },
];

export const LOG_B = [
  { text: '$ fleet-run --loop', tone: 'dim' as const },
  { text: 'Jira:   acme.atlassian.net as fleet-bot (project FLT)', tone: 'info' as const },
  { text: 'PR host: bitbucket · base branch main', tone: 'info' as const },
  { text: '10:23:44  worker-11 (adapter=opencode)', tone: 'info' as const },
  { text: '10:23:46  1 claimable → FLT-7', tone: 'info' as const },
  { text: '10:23:46  claim → transition Ready for Build → In Build  (CAS)', tone: 'info' as const },
  { text: 'FLT-7 lost the claim race (now "In Build") — moving on', tone: 'warn' as const },
  { text: '', tone: 'dim' as const },
  { text: '10:23:46  no claimable tickets', tone: 'dim' as const },
  { text: '10:24:33  sleeping 47s', tone: 'dim' as const },
];
