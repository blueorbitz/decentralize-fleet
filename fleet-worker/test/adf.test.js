import test from 'node:test';
import assert from 'node:assert/strict';
import { adfToText, textToAdf, extractAcceptanceCriteria, fieldText } from '../src/adf.js';

test('adfToText flattens a document with headings and lists', () => {
  const doc = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'heading', content: [{ type: 'text', text: 'Acceptance criteria' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It works' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It is fast' }] }] },
        ],
      },
    ],
  };
  const text = adfToText(doc);
  assert.match(text, /Acceptance criteria/);
  assert.match(text, /- It works/);
  assert.match(text, /- It is fast/);
});

test('fieldText passes strings through and flattens ADF', () => {
  assert.equal(fieldText('plain'), 'plain');
  assert.equal(
    fieldText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }),
    'hi',
  );
});

test('textToAdf round-trips through adfToText', () => {
  const adf = textToAdf('line one\nline two');
  assert.equal(adf.type, 'doc');
  assert.equal(adfToText(adf).trim(), 'line one\nline two');
});

test('extractAcceptanceCriteria reads the list under the heading', () => {
  const desc = 'We need export.\n\nAcceptance criteria:\n- CSV button\n- 50k rows < 10s\n\nNotes: reuse query';
  assert.equal(extractAcceptanceCriteria(desc), 'CSV button\n50k rows < 10s');
});

test('extractAcceptanceCriteria returns empty when there is none', () => {
  assert.equal(extractAcceptanceCriteria('just a rough idea'), '');
});
