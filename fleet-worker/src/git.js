// Git operations for a worker workspace.
//
// One persistent clone per worker (Med #6). Each run starts from a clean
// `git reset --hard origin/<base>` and branches `FLT-<key>-<slug>`. The worker
// commits and pushes, but never merges — that is a human gate.
import { execFileSync } from 'node:child_process';

export class GitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitError';
  }
}

function defaultRun(cmd, args, { cwd, env } = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      env: env ?? process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return stdout ?? '';
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    throw new GitError(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`);
  }
}

export function slugify(text, max = 40) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'task';
}

export function branchFor(key, summary) {
  return `${key}-${slugify(summary)}`;
}

export class GitClient {
  constructor({ dir, remote, baseBranch = 'main', run = defaultRun }) {
    this.dir = dir;
    this.remote = remote;
    this.baseBranch = baseBranch;
    this._run = run;
  }

  git(args) {
    return this._run('git', args, { cwd: this.dir });
  }

  // Clone if the workspace is empty, otherwise fetch the latest base branch.
  prepare() {
    if (this.remote) {
      try {
        this.git(['remote', 'get-url', 'origin']);
      } catch {
        this.git(['clone', this.remote, '.']);
      }
    }
    this.git(['fetch', 'origin', this.baseBranch]);
  }

  // Step 5: clean the tree back to the base branch.
  resetHard() {
    this.git(['checkout', '-B', this.baseBranch, `origin/${this.baseBranch}`]);
    this.git(['reset', '--hard', `origin/${this.baseBranch}`]);
    this.git(['clean', '-fd']);
    return this.headSha();
  }

  checkoutNewBranch(branch) {
    this.git(['checkout', '-B', branch]);
    return branch;
  }

  headSha() {
    return this.git(['rev-parse', 'HEAD']).trim();
  }

  currentBranch() {
    return this.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  }

  hasChanges() {
    return this.git(['status', '--porcelain']).trim().length > 0;
  }

  commitAll(message) {
    this.git(['add', '--all']);
    this.git([
      '-c',
      'user.name=fleet-bot',
      '-c',
      'user.email=fleet-bot@users.noreply.github.com',
      'commit',
      '-m',
      message,
    ]);
    return this.headSha();
  }

  push(branch) {
    this.git(['push', '--set-upstream', 'origin', branch]);
    return branch;
  }

  diffStat() {
    try {
      return this.git(['diff', '--stat', `origin/${this.baseBranch}...HEAD`]).trim();
    } catch {
      return '';
    }
  }

  // Concatenated commit subjects since the base branch — a compact change list.
  commitSubjects() {
    try {
      return this.git(['log', '--pretty=format:%s', `origin/${this.baseBranch}..HEAD`]).trim();
    } catch {
      return '';
    }
  }
}
