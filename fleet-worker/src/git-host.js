// Pull-request host. The fleet opens PRs and stops; humans merge (High #6, #13).
//
// The worker only depends on `createPullRequest`, so the host is swappable:
// Bitbucket Cloud in the demo, a no-op host in tests.

export class BitbucketError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'BitbucketError';
    this.status = status;
    this.body = body;
  }
}

export class BitbucketClient {
  constructor({ workspace, repoSlug, username, appPassword, fetchImpl = globalThis.fetch, apiBase = 'https://api.bitbucket.org/2.0' }) {
    this.workspace = workspace;
    this.repoSlug = repoSlug;
    this.apiBase = apiBase;
    this.auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`;
    this.fetchImpl = fetchImpl;
  }

  async createPullRequest({ title, description, sourceBranch, destinationBranch, closeSourceBranch = false }) {
    const url = `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/pullrequests`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: this.auth },
      body: JSON.stringify({
        title,
        description,
        source: { branch: { name: sourceBranch } },
        destination: { branch: { name: destinationBranch } },
        close_source_branch: closeSourceBranch,
      }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw new BitbucketError(`create PR -> HTTP ${res.status}`, { status: res.status, body: json ?? text.slice(0, 300) });
    }
    return {
      id: json?.id ?? null,
      url: json?.links?.html?.href ?? null,
      raw: json,
    };
  }
}

// Records PRs instead of calling a remote. Used by tests and `--dry-run`.
export class LocalGitHost {
  constructor() {
    this.pulls = [];
  }

  async createPullRequest(input) {
    const pull = { id: this.pulls.length + 1, url: `local://pull-requests/${this.pulls.length + 1}`, ...input };
    this.pulls.push(pull);
    return { id: pull.id, url: pull.url, raw: pull };
  }
}

export function createGitHost(cfg) {
  if (cfg.kind === 'local' || cfg.kind === 'none') return new LocalGitHost();
  return new BitbucketClient({
    workspace: cfg.workspace,
    repoSlug: cfg.repoSlug,
    username: cfg.username,
    appPassword: cfg.appPassword,
  });
}
