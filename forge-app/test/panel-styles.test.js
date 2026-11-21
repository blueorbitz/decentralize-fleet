import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { statusTone } from '../src/static/issue-panel/src/display.js';
import { STATUS } from '../src/config.js';

// The panel renders Custom UI from a hand-written stylesheet, so a class name
// that no rule styles is a silent visual regression: the element renders but
// looks broken. Ping-ponging class names between src/*.jsx and panel.css is
// exactly the kind of drift a build cannot catch, so it is asserted here.

const panelDir = path.resolve(import.meta.dirname, '../src/static/issue-panel');
const css = fs.readFileSync(path.join(panelDir, 'src/panel.css'), 'utf8');
const cssClasses = new Set([...css.matchAll(/\.(fleet-[a-z0-9-]+)/gi)].map((m) => m[1]));

function sourceFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    .filter((f) => /\.(jsx|js)$/.test(f));
}

// Class names appear as literals, or inside template literals like
// `fleet-ac-box${done ? ' fleet-ac-box--done' : ''}`. A fragment ending in an
// interpolation (`fleet-pill--`) is a prefix, not a class, and is skipped.
function usedClasses() {
  const used = new Set();
  const add = (token) => {
    if (/^fleet-[a-z0-9-]+[a-z0-9]$/.test(token)) used.add(token);
  };
  for (const file of sourceFiles(path.join(panelDir, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      for (const token of (m[1] || m[2]).split(/[\s${}?:'"+.]+/)) add(token);
    }
    for (const m of text.matchAll(/' (fleet-[a-z0-9-]+)'/g)) add(m[1]);
  }
  return used;
}

test('every class the panel renders is styled', () => {
  const missing = [...usedClasses()].filter((c) => !cssClasses.has(c));
  assert.deepEqual(missing, [], `unstyled classes: ${missing.join(', ')}`);
});

test('the check would catch a class that is not styled', () => {
  // Guard against a vacuous test: prove the extractor sees the panel's classes.
  const used = usedClasses();
  assert.ok(used.has('fleet-root'), 'extractor missed a known class');
  assert.ok(!cssClasses.has('fleet-does-not-exist'));
});

test('every status the board can show has a styled pill', () => {
  for (const status of Object.values(STATUS)) {
    const tone = statusTone(status);
    assert.ok(cssClasses.has(`fleet-pill--${tone}`), `no pill style for tone "${tone}" (status ${status})`);
  }
  // An unknown status must fall back to a real tone rather than inventing one.
  assert.equal(statusTone('Something Else'), 'neutral');
  assert.ok(cssClasses.has('fleet-pill--neutral'));
});

test('the stylesheet only references design-system tokens', () => {
  // Every custom property is a --ds-* token; a typo quietly yields no color.
  const vars = new Set([...css.matchAll(/var\((--ds-[a-z0-9-]+)\)/g)].map((m) => m[1]));
  const allowed = /^--ds-(text|background|border|surface|space|radius|font|link|icon|elevation|shadow|interaction|skeleton|blanket|opacity|utility)[a-z0-9-]*$/;
  for (const v of vars) {
    assert.match(v, allowed, `${v} is not a design-system token name`);
  }
});

test('the stylesheet has no hard-coded colors', () => {
  // Tokens, not hexes: a hex breaks dark mode.
  const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hexes, [], `hard-coded colors: ${hexes.join(', ')}`);
});
