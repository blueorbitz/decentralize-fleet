// Jira REST over the saved browser session, for the demo prep scripts.
//
//   node scripts/jira-cli.mjs status FLT-6
//   node scripts/jira-cli.mjs list
//   node scripts/jira-cli.mjs ready FLT-6        move to Ready for Build
//   node scripts/jira-cli.mjs transitions FLT-6
//   node scripts/jira-cli.mjs clear FLT-6        clear the five Fleet fields
import { sessionClient } from './jira-session.mjs';

const FLEET_FIELDS = {
  customfield_10213: null,
  customfield_10214: null,
  customfield_10215: null,
  customfield_10216: null,
  customfield_10217: null,
};

async function main() {
  const [cmd, key] = process.argv.slice(2);
  const jira = sessionClient();

  switch (cmd) {
    case 'list': {
      const issues = await jira.search('project = FLT ORDER BY created DESC');
      if (!issues.length) console.log('no issues');
      for (const i of issues) console.log(`${i.key.padEnd(9)} ${String(i.fields.status.name).padEnd(16)} ${i.fields.summary}`);
      return;
    }
    case 'status': {
      const s = await jira.status(key);
      console.log(`${key}: ${s.status}  labels=${JSON.stringify(s.labels)}`);
      return;
    }
    case 'transitions': {
      const list = await jira.transitions(key);
      for (const t of list) console.log(`  ${t.name} -> ${t.to?.name}`);
      return;
    }
    case 'ready': {
      const to = await jira.transition(key, 'Mark Ready');
      console.log(`${key} -> ${to}`);
      return;
    }
    case 'clear': {
      await jira.setFields(key, FLEET_FIELDS);
      console.log(`${key}: Fleet fields cleared`);
      return;
    }
    default:
      console.log('usage: jira-cli.mjs <list|status|transitions|ready|clear> [KEY]');
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
