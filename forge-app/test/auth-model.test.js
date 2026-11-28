import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The Forge app authenticates to Jira through the platform, not with a Jira API
// token: `api.asApp().requestJira()` mints an installation-scoped token from the
// scopes in manifest.yml. `basicTransport()` exists only for the CLI scripts and
// tests, which run outside Forge.
//
// That distinction is easy to erode — someone adds a token to .env "just for the
// panel" and now the app ships a long-lived credential. These assertions keep
// the boundary explicit.

const root = path.resolve(import.meta.dirname, '..');

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    .filter((f) => f.endsWith('.js') && !f.includes(`${path.sep}static${path.sep}`));
}

test('the app runtime authenticates through Forge, not a Jira API token', () => {
  const backend = fs.readFileSync(path.join(root, 'src/backend/index.js'), 'utf8');
  // The backend hands `asApp` + `route` to the Forge transport, which calls
  // `asApp().requestJira()`; tokens are minted per installation from the scopes.
  assert.match(backend, /import \{[^}]*asApp[^}]*\} from '@forge\/api'/, 'must import asApp from @forge/api');
  assert.match(backend, /forgeTransport\(\s*\{\s*asApp/, 'must pass asApp to the Forge transport');
  assert.doesNotMatch(backend, /basicTransport/, 'the backend must not build Basic auth');
  assert.doesNotMatch(backend, /FLEET_JIRA_TOKEN/, 'the app must not read a Jira API token');
  assert.doesNotMatch(backend, /FLEET_JIRA_EMAIL/, 'the app must not need a Jira user identity');

  const transport = fs.readFileSync(path.join(root, 'src/transports.js'), 'utf8');
  assert.match(transport, /api\.asApp\(\)\.requestJira/, 'the Forge transport must call asApp().requestJira');
});

test('only scripts and tests use Basic auth', () => {
  const offenders = [];
  for (const file of walk(path.join(root, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/basicTransport/.test(text)) continue;
    // transports.js defines it; everything else must not reach for it.
    if (file.endsWith(path.join('src', 'transports.js'))) continue;
    offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, [], `these runtime files use Basic auth: ${offenders.join(', ')}`);
});

test('FLEET_MCP_TOKEN is a shared secret, not an Atlassian credential', () => {
  const trigger = fs.readFileSync(path.join(root, 'src/mcp-trigger.js'), 'utf8');
  // It is compared against an inbound bearer header, never sent to Jira.
  assert.match(trigger, /Bearer\\s\+/, 'the trigger compares a bearer header');
  assert.doesNotMatch(trigger, /requestJira|basicTransport/);
});

test('the manifest declares the scopes the app actually uses', () => {
  const yaml = fs.readFileSync(path.join(root, 'manifest.yml'), 'utf8');
  for (const scope of ['read:jira-work', 'write:jira-work', 'storage:app']) {
    assert.ok(yaml.includes(scope), `manifest.yml is missing ${scope}`);
  }
});
