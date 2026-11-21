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

// Bitbucket Cloud accepts two credential shapes, and they are not
// interchangeable:
//
//   Authorization: Bearer <token>          repository / workspace access tokens
//                                          (ATCT…, ATBB…), and OAuth access tokens
//   Authorization: Basic base64(user:pass) app passwords and OAuth consumer keys
//
// Sending an access token as Basic silently 401s, which is the failure this
// client used to have. `mode` is 'auto' unless configured: in auto, only a token
// whose shape is an access token is sent as Bearer, so an app password can never
// be mistaken for one. Set FLEET_BB_AUTH for an unusual token.
export function bitbucketAuthHeader({ username, appPassword, mode = 'auto' } = {}) {
  const token = String(appPassword ?? '').trim();
  if (!token) {
    throw new BitbucketError(
      'no Bitbucket credential: set FLEET_BB_APP_PASSWORD to a repository access token or an app password',
    );
  }
  const accessToken = /^(ATCT|ATBB)/i.test(token);
  const useBearer = mode === 'bearer' || (mode !== 'basic' && accessToken);
  if (useBearer) return `Bearer ${token}`;
  if (!username) {
    throw new BitbucketError(
      'Basic auth needs a username: set FLEET_BB_USERNAME alongside the app password, ' +
        'or set FLEET_BB_AUTH=bearer if the value is an access token',
    );
  }
  return `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
}

function pullFromResponse(json) {
  return {
    id: json?.id ?? null,
    url: json?.links?.html?.href ?? null,
    sourceBranch: json?.source?.branch?.name ?? null,
    destinationBranch: json?.destination?.branch?.name ?? null,
    raw: json,
  };
}

export class BitbucketClient {
  constructor({
    workspace,
    repoSlug,
    username,
    appPassword,
    authMode = 'auto',
    fetchImpl = globalThis.fetch,
    apiBase = 'https://api.bitbucket.org/2.0',
  }) {
    if (!workspace || !repoSlug) {
      throw new BitbucketError('Bitbucket needs both a workspace and a repository slug (FLEET_BB_WORKSPACE, FLEET_BB_REPO)');
    }
    this.workspace = workspace;
    this.repoSlug = repoSlug;
    this.apiBase = String(apiBase).replace(/\/+$/, '');
    this.auth = bitbucketAuthHeader({ username, appPassword, mode: authMode });
    this.fetchImpl = fetchImpl;
  }

  get repoUrl() {
    return `${this.apiBase}/repositories/${encodeURIComponent(this.workspace)}/${encodeURIComponent(this.repoSlug)}`;
  }

  async request(method, path, { body } = {}) {
    const res = await this.fetchImpl(`${this.repoUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Authorization: this.auth,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { res, json, text };
  }

  // Is there already an open PR for this branch? A worker can retry a run, and
  // Bitbucket answers a duplicate POST with 409, so the caller needs a way to
  // reuse what is already open rather than failing the ticket.
  async findPullRequest({ sourceBranch, state = 'OPEN' }) {
    const query = `source.branch.name="${String(sourceBranch).replace(/"/g, '')}"`;
    const { res, json, text } = await this.request(
      'GET',
      `/pullrequests?state=${encodeURIComponent(state)}&q=${encodeURIComponent(query)}&pagelen=10`,
    );
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new BitbucketError(this.describeAuthFailure(res.status), { status: res.status, body: json ?? text.slice(0, 300) });
      }
      throw new BitbucketError(`lookup PR for ${sourceBranch} -> HTTP ${res.status}`, { status: res.status, body: json ?? text.slice(0, 300) });
    }
    const match = (json?.values || []).find((pr) => pr.source?.branch?.name === sourceBranch);
    return match ? pullFromResponse(match) : null;
  }

  async createPullRequest({ title, description, sourceBranch, destinationBranch, closeSourceBranch = false, reuseExisting = true }) {
    if (reuseExisting) {
      const existing = await this.findPullRequest({ sourceBranch });
      if (existing) return { ...existing, reused: true };
    }

    const { res, json, text } = await this.request('POST', '/pullrequests', {
      body: {
        title,
        description,
        source: { branch: { name: sourceBranch } },
        destination: { branch: { name: destinationBranch } },
        close_source_branch: closeSourceBranch,
      },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new BitbucketError(this.describeAuthFailure(res.status), { status: res.status, body: json ?? text.slice(0, 300) });
      }
      if (res.status === 409 && reuseExisting) {
        const existing = await this.findPullRequest({ sourceBranch });
        if (existing) return { ...existing, reused: true };
      }
      const detail = json?.error?.message || text.slice(0, 300);
      throw new BitbucketError(`create PR -> HTTP ${res.status} ${detail}`, { status: res.status, body: json ?? text.slice(0, 300) });
    }
    return { ...pullFromResponse(json), reused: false };
  }

  // 401/403 is almost always the credential shape, so say which one was sent
  // and how to change it instead of leaving the operator with a bare status.
  describeAuthFailure(status) {
    const used = this.auth.startsWith('Bearer ') ? 'Bearer access token' : 'Basic username:app password';
    return (
      `Bitbucket rejected the credential (HTTP ${status}) using ${used} for ${this.workspace}/${this.repoSlug}. ` +
      'A repository/workspace access token (ATCT…/ATBB…) must be sent as Bearer; ' +
      'an app password needs its username and is sent as Basic. ' +
      'Set FLEET_BB_AUTH=bearer|basic to force one.'
    );
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
    authMode: cfg.authMode || 'auto',
  });
}
