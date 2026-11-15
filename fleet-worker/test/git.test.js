import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { slugify, branchFor, GitClient } from '../src/git.js';
import { makeGitWorkspace } from './helpers/git-fixture.js';

test('slugify and branchFor produce dev-panel-linkable names', () => {
  assert.equal(slugify('Add CSV export to the usage report'), 'add-csv-export-to-the-usage-report');
  assert.equal(branchFor('FLT-101', 'Add CSV export!'), 'FLT-101-add-csv-export');
  assert.equal(branchFor('FLT-9', ''), 'FLT-9-task');
});

test('git client resets to base, branches, commits and pushes', () => {
  const ws = makeGitWorkspace();
  try {
    const git = new GitClient({ dir: ws.workspace, baseBranch: 'main' });
    git.prepare();
    const base = git.resetHard();
    assert.equal(base.length, 40);

    git.checkoutNewBranch('FLT-1-test');
    assert.equal(git.currentBranch(), 'FLT-1-test');
    assert.equal(git.hasChanges(), false);

    fs.writeFileSync(path.join(ws.workspace, 'out.txt'), 'hi');
    assert.equal(git.hasChanges(), true);
    const sha = git.commitAll('FLT-1: test');
    assert.equal(git.headSha(), sha);

    git.push('FLT-1-test');
    assert.match(git.commitSubjects(), /FLT-1: test/);
  } finally {
    ws.cleanup();
  }
});
