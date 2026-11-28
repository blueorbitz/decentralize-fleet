import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The panel is a nested npm project. `npm --prefix src/static/issue-panel install`
// resolves the *cwd* package as the project, which installs the Forge app into
// the panel as `fleet-forge-app: file:../../..` — a recursive link that breaks
// every later install. The build script therefore uses `cd`. These assertions are
// cheap insurance against reintroducing the prefix form.

const root = path.resolve(import.meta.dirname, '..');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));

test('the panel does not depend on its own parent package', () => {
  const panel = read('src/static/issue-panel', 'package.json');
  const all = { ...panel.dependencies, ...panel.devDependencies };
  assert.equal(all['fleet-forge-app'], undefined, 'the panel must not link to the Forge app');
  for (const [name, range] of Object.entries(all)) {
    assert.notEqual(range, 'file:../../..', `${name} points at the parent directory`);
  }
});

test('the panel declares no stale or uninstalled design-system packages', () => {
  const panel = read('src/static/issue-panel', 'package.json');
  const deps = Object.keys(panel.dependencies);
  // These were removed on purpose; see the README design notes.
  assert.ok(!deps.includes('@atlaskit/lozenge'), 'lozenge installs unreliably; the pill is token-built');
  assert.ok(!deps.includes('@atlaskit/primitives'), 'unused');
  assert.ok(!deps.includes('@atlaskit/icon'), 'unused');
  assert.ok(deps.includes('@atlaskit/button'), 'the panel still uses Button');
});

test('build:ui installs the panel with cd, not --prefix', () => {
  const app = read('package.json');
  const script = app.scripts['build:ui'];
  assert.doesNotMatch(script, /--prefix/, '--prefix resolves the wrong package as the project');
  assert.match(script, /cd src\/static\/issue-panel/);
  assert.match(script, /--include=dev/, 'NODE_ENV=production skips devDependencies, which vite lives in');
});

test('build:ui also builds the Fleet page', () => {
  const script = read('package.json').scripts['build:ui'];
  assert.match(script, /cd \.\.\/fleet-page/, 'the Fleet page must be built for the projectPage resource');
  // Two installs, one per UI app.
  assert.equal((script.match(/--include=dev/g) || []).length, 2);
});

test('the Fleet page is a self-contained UI app', () => {
  const page = read('src/static/fleet-page', 'package.json');
  const all = { ...page.dependencies, ...page.devDependencies };
  assert.equal(all['fleet-forge-app'], undefined, 'the page must not link to the Forge app');
  assert.ok(page.dependencies['@forge/bridge'], 'the page invokes the resolver through the bridge');
  assert.equal(page.devDependencies['@compiled/vite-plugin'], '2.0.0');
});

test('the compiled plugin and the design system agree on @compiled/react', () => {
  const panel = read('src/static/issue-panel', 'package.json');
  // @compiled/vite-plugin 2.x requires @compiled/react >= 2, but every @atlaskit
  // package pins 1.x. 2.0.0 is the last line that pairs with Atlaskit.
  assert.equal(panel.devDependencies['@compiled/vite-plugin'], '2.0.0');
});
