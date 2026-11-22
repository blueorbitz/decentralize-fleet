import type { BoardTicket } from '../components/Board';
import type { PanelState } from '../components/FleetPanel';

// One ticket, one story. Every scene that shows the ticket shows this, so the
// viewer can track the same object from Ready for Build to In Review.
export const TICKET = {
  key: 'FLT-101',
  summary: 'Add CSV export to the usage report',
  branch: 'FLT-101-add-csv-export-to-the-usage-report',
  pr: 'Pull request #42',
  prUrl: 'bitbucket.org/captain-sage/fleet-test/pull-requests/42',
  workerA: 'worker-04',
  workerB: 'worker-11',
  ac: [
    'GET /reports/usage accepts format=csv',
    'Streams rows instead of buffering the full report',
    'Export button gated on the Reports permission',
  ],
} as const;

export const BOARD_TICKETS: BoardTicket[] = [
  { key: 'FLT-97', summary: 'Audit log retention policy', status: 'Done' },
  { key: 'FLT-99', summary: 'Deprecate v1 usage endpoint', status: 'In Review', pr: 'PR #39' },
  { key: 'FLT-101', summary: TICKET.summary, status: 'Triaged', labels: ['needs-spec'] },
  { key: 'FLT-104', summary: 'Rate-limit the export endpoint', status: 'Triaged' },
];

export const PANEL_BASE: Omit<PanelState, 'status'> = {
  key: TICKET.key,
  summary: TICKET.summary,
  worker: null,
  lease: null,
  branch: null,
  pr: null,
  retry: 0,
  acceptanceCriteria: [...TICKET.ac],
  log: [],
};

export const RUN_LOG = [
  { stamp: '10:02:14', text: `worker-04 claimed FLT-101  (lease 15:00)` },
  { stamp: '10:02:15', text: 'verify ok — fleet_worker=worker-04', tone: 'ok' as const },
  { stamp: '10:02:17', text: 'git reset --hard origin/main @ a1b2c3d' },
  { stamp: '10:02:19', text: `branch ${TICKET.branch}` },
  { stamp: '10:02:21', text: 'adapter=opencode  running in workspace' },
  { stamp: '10:04:38', text: 'tests: 24 passed, 0 failed', tone: 'ok' as const },
  { stamp: '10:04:51', text: `pushed ${TICKET.branch}` },
  { stamp: '10:04:55', text: 'opened pull request #42', tone: 'ok' as const },
];

// The two worker logs for the claim race, in the worker's own wording.
export const LOG_A = [
  { text: '$ fleet-run --loop', tone: 'dim' as const },
  { text: 'Jira:   captain-sage.atlassian.net as Fleet Bot (project FLT)', tone: 'info' as const },
  { text: 'worker: worker-04 · adapter=opencode', tone: 'info' as const },
  { text: '' },
  { text: '1 claimable → FLT-101', tone: 'info' as const },
  { text: 'claim → transition Ready for Build → In Build  (CAS)', tone: 'info' as const },
  { text: 'verify ok — fleet_worker=worker-04', tone: 'ok' as const },
  { text: 'snapshot ticket (summary/description/AC) @ 10:02:16', tone: 'info' as const },
  { text: 'git reset origin/main @ a1b2c3d · branch FLT-101-add-csv-export', tone: 'info' as const },
  { text: 'adapter=opencode  running in workspace', tone: 'info' as const },
  { text: 'tests: 24 passed, 0 failed', tone: 'ok' as const },
  { text: 'transition In Build → In Review', tone: 'ok' as const },
];

export const LOG_B = [
  { text: '$ fleet-run --loop', tone: 'dim' as const },
  { text: 'Jira:   captain-sage.atlassian.net as Fleet Bot (project FLT)', tone: 'info' as const },
  { text: 'worker: worker-11 · adapter=opencode', tone: 'info' as const },
  { text: '' },
  { text: '1 claimable → FLT-101', tone: 'info' as const },
  { text: 'claim → transition Ready for Build → In Build  (CAS)', tone: 'info' as const },
  { text: 'FLT-101 lost the claim race (now "In Build") — moving on', tone: 'warn' as const },
  { text: '' },
  { text: 'no claimable tickets', tone: 'dim' as const },
  { text: 'sleeping 47s', tone: 'dim' as const },
];
