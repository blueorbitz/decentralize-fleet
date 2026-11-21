import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLease,
  prettyPr,
  shortStamp,
  oneLine,
  actionHint,
} from '../src/static/issue-panel/src/display.js';

test('a live lease is formatted as a countdown', () => {
  const out = formatLease({ state: 'live', remainingMs: 13 * 60_000 + 12_000 });
  assert.deepEqual(out, { text: '13:12', tone: 'warn', suffix: 'left of 15m' });
});

test('a stale lease says so rather than counting down past zero', () => {
  assert.deepEqual(formatLease({ state: 'stale' }), { text: 'expired', tone: 'danger' });
  assert.equal(formatLease({ state: 'none' }), null);
  assert.equal(formatLease(undefined), null);

  const negative = formatLease({ state: 'live', remainingMs: -5000 });
  assert.equal(negative.text, '00:00');
});

test('a pull request URL is shown as a readable reference', () => {
  assert.equal(prettyPr('https://bitbucket.org/acme/app/pull-requests/42'), 'pull request #42');
  assert.equal(prettyPr('https://bitbucket.org/acme/app'), 'bitbucket.org/acme/app');
  assert.equal(prettyPr('not a url'), 'not a url');
  assert.equal(prettyPr(null), null);
});

test('stamps are HH:MM:SS and multi-line comments become one line', () => {
  assert.match(shortStamp('2026-01-01T10:02:14Z'), /^\d\d:\d\d:\d\d\s\s$/);
  assert.equal(shortStamp(null), '');

  assert.equal(oneLine('line one\nline two\n\nline three'), 'line one · line two · line three');
});

test('the action hint appears only when there is nothing to do', () => {
  assert.equal(actionHint({ canDispatch: true, canRequeue: false }), null);
  assert.equal(actionHint({ canDispatch: false, canRequeue: true }), null);
  assert.match(actionHint({ canDispatch: false, canRequeue: false }), /No fleet action available/);
});
