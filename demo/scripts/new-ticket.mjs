// Create a demo ticket in the exact shape the video needs, via the saved session.
//
// Status flow is forward-only (In Review cannot go back to Ready for Build), so a
// fresh ticket is the clean way to get one that can be dispatched and claimed.
//
//   node scripts/new-ticket.mjs
import { sessionClient } from './jira-session.mjs';

const TICKET = {
  summary: 'Add CSV export to the usage report',
  description: [
    'The usage report can only be viewed in the browser. Teams need the raw data in their own tooling.',
    '',
    'Acceptance criteria:',
    '- GET /reports/usage accepts format=csv',
    '- Streams rows instead of buffering the full report',
    '- Export button is gated on the Reports permission',
  ].join('\n'),
};

const adf = (text) => ({
  type: 'doc',
  version: 1,
  content: text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  })),
});

async function main() {
  const jira = sessionClient();

  const created = await jira.request('POST', '/rest/api/3/issue', {
    fields: {
      project: { key: 'FLT' },
      summary: TICKET.summary,
      description: adf(TICKET.description),
      issuetype: { name: 'Story' },
      labels: ['fleet-ready'],
    },
  });
  const key = created.key;
  console.log(`created ${key}`);

  // Backlog -> Triaged, so the panel offers "Dispatch to fleet".
  const list = await jira.transitions(key);
  const triage = list.find((t) => t.to?.name === 'Triaged');
  if (!triage) throw new Error(`no Triage transition; available: ${list.map((t) => t.name).join(', ')}`);
  await jira.transition(key, triage.name);
  console.log(`moved to Triaged`);
  console.log(`\n${key}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
