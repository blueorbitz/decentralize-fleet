// Creates a throwaway git workspace with a real (local) origin, so the worker's
// git steps — fetch, reset --hard origin/main, branch, commit, push — run
// against actual git rather than a stub.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function git(dir, args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'seed',
      GIT_AUTHOR_EMAIL: 'seed@example.com',
      GIT_COMMITTER_NAME: 'seed',
      GIT_COMMITTER_EMAIL: 'seed@example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function makeGitWorkspace({ seed, branch = 'main' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-git-'));
  const origin = path.join(root, 'origin.git');
  const seedDir = path.join(root, 'seed');
  const workspace = path.join(root, 'workspace');

  fs.mkdirSync(seedDir, { recursive: true });
  git(root, ['init', '--bare', '-b', branch, origin]);
  git(seedDir, ['init', '-b', branch]);
  if (typeof seed === 'function') seed(seedDir);
  fs.writeFileSync(path.join(seedDir, 'README.md'), '# demo repo\n');
  git(seedDir, ['add', '-A']);
  git(seedDir, ['commit', '-m', 'init']);
  git(seedDir, ['remote', 'add', 'origin', origin]);
  git(seedDir, ['push', 'origin', branch]);

  git(root, ['clone', origin, workspace]);

  return {
    root,
    origin,
    workspace,
    branch,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
