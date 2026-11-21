import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

// A manifest that names a handler which does not exist, or a resource path that
// is not there, deploys and then fails at first invocation. This pins the three
// things that go wrong quietly: wired function keys, resolvable handlers, and a
// built UI resource.

const root = path.resolve(import.meta.dirname, '..');
const manifest = parse(fs.readFileSync(path.join(root, 'manifest.yml'), 'utf8'));

const functionKeys = manifest.modules.function.map((f) => f.key);
const byKey = new Map(manifest.modules.function.map((f) => [f.key, f]));

test('every module references a declared function', () => {
  const refs = [
    ...manifest.modules.scheduledTrigger.map((t) => t.function),
    ...manifest.modules.webtrigger.map((t) => t.function),
    ...manifest.modules['jira:issuePanel'].map((p) => p.resolver.function),
  ];
  for (const ref of refs) {
    assert.ok(functionKeys.includes(ref), `module references undeclared function "${ref}"`);
  }
});

test('every handler resolves to a real exported function', async () => {
  for (const fn of manifest.modules.function) {
    const [file, exportName] = fn.handler.split('.');
    // Handler paths are relative to src/.
    const modulePath = path.join(root, 'src', file + '.js');
    assert.ok(fs.existsSync(modulePath), `${fn.key}: no file for handler ${fn.handler}`);

    const mod = await import(pathToFileURL(modulePath).href);
    assert.equal(typeof mod[exportName], 'function', `${fn.key}: ${fn.handler} is not exported as a function`);
  }
});

test('the scheduled reaper runs on the shortest interval and the MCP trigger is dynamic', () => {
  const [reaper] = manifest.modules.scheduledTrigger;
  assert.equal(reaper.interval, 'fiveMinute', 'the reaper must poll faster than the 15m staleness window');
  assert.ok(reaper.timeoutSeconds === undefined || reaper.timeoutSeconds <= 900);

  const [mcp] = manifest.modules.webtrigger;
  // Dynamic is required: JSON-RPC responses are not a fixed set of bodies.
  assert.equal(mcp.response.type, 'dynamic');
  assert.equal(mcp.urlFormat, 'v2');
});

test('the issue panel resource is built and has an index.html entry point', () => {
  const [panel] = manifest.modules['jira:issuePanel'];
  const resource = manifest.resources.find((r) => r.key === panel.resource);
  assert.ok(resource, `issue panel resource "${panel.resource}" is not declared`);
  assert.ok(panel.title, 'the issue panel needs a title');
  assert.ok(panel.icon, 'the issue panel needs an icon');

  const entry = path.join(root, resource.path, 'index.html');
  assert.ok(fs.existsSync(entry), `${resource.path}/index.html is missing — run npm run build:ui`);
});

test('the app declares only the scopes the fleet uses', () => {
  assert.deepEqual(manifest.permissions.scopes.sort(), ['read:jira-work', 'write:jira-work']);
  assert.equal(manifest.app.runtime.name, 'nodejs24.x');
  // `forge register` fills in the real id; a placeholder must still parse.
  assert.match(manifest.app.id, /^ari:cloud:ecosystem::app\/[0-9a-fA-F-]{36}$/);
});

test('function timeouts fit the platform limits', () => {
  for (const fn of manifest.modules.function) {
    if (fn.timeoutSeconds === undefined) continue;
    assert.ok(fn.timeoutSeconds >= 1 && fn.timeoutSeconds <= 900, `${fn.key} timeout out of range`);
  }
});

test('byKey helper is consistent — no duplicate function keys', () => {
  assert.equal(byKey.size, manifest.modules.function.length);
});
