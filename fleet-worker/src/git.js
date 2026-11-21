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
  constructor({ dir, remote, baseBranch = null, run = defaultRun }) {
    this.dir = dir;
    this.remote = remote;
    // null means "ask the remote". Hardcoding `main` breaks every repository
    // whose default branch is `master`, and the failure surfaces as a confusing
    // `couldn't find remote ref main`.
    this.baseBranch = baseBranch || null;
    this._run = run;
  }

  git(args) {
    return this._run('git', args, { cwd: this.dir });
  }

  // Which branch does the remote consider its default?
  //
  // `ls-remote --symref origin HEAD` is the authoritative answer and works for
  // local-path remotes too. If that fails (an older git, an odd remote), fall
  // back to the first conventional name that actually exists remotely.
  detectBaseBranch() {
    try {
      const out = this.git(['ls-remote', '--symref', 'origin', 'HEAD']);
      const match = out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
      if (match) return match[1];
    } catch {
      /* fall through to the name probe */
    }
    for (const candidate of ['main', 'master', 'develop', 'trunk']) {
      try {
        this.git(['rev-parse', '--verify', `origin/${candidate}`]);
        return candidate;
      } catch {
        /* try the next one */
      }
    }
    return null;
  }

  // The branches the remote actually has, for a useful error message.
  // `branch -r` also lists `origin/HEAD` and, in a freshly cloned repo, a bare
  // `origin`; neither is a branch you can cut from.
  remoteBranches() {
    try {
      return this.git(['branch', '-r', '--format=%(refname:short)'])
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('origin/'))
        .map((l) => l.slice('origin/'.length))
        .filter((l) => l && l !== 'HEAD');
    } catch {
      return [];
    }
  }

  // Clone if the workspace is empty, then make sure we know the base branch.
  prepare() {
    if (this.remote) {
      try {
        this.git(['remote', 'get-url', 'origin']);
      } catch {
        this.git(['clone', this.remote, '.']);
      }
    }

    if (!this.baseBranch) {
      this.baseBranch = this.detectBaseBranch();
      if (!this.baseBranch) {
        const available = this.remoteBranches();
        throw new GitError(
          `cannot determine the base branch for ${this.remote || this.dir}` +
            `${available.length ? ` (remote has: ${available.join(', ')})` : ''}. ` +
            'Set it explicitly with --base-branch / FLEET_BASE_BRANCH.',
        );
      }
    }

    try {
      this.git(['fetch', 'origin', this.baseBranch]);
    } catch (err) {
      const available = this.remoteBranches();
      throw new GitError(
        `fetch of base branch "${this.baseBranch}" failed` +
          `${available.length ? `; the remote has: ${available.join(', ')}` : ''}. ` +
          'Set the right branch with --base-branch / FLEET_BASE_BRANCH.',
      );
    }
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
