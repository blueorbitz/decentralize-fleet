// Jira Cloud REST v3 client — the only thing the fleet uses to move tickets.
//
// Every state change in the fleet is a Jira write made with the shared "Fleet
// Bot" token (Basic auth). Claim is a status transition: Jira serialises the
// transition and rejects it with HTTP 400 if the source status no longer
// matches, which is the compare-and-swap the whole concurrency story rests on.
import { fieldText, textToAdf, extractAcceptanceCriteria } from './adf.js';
import { STATUS, TRANSITION } from './config.js';

export class JiraError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
    this.body = body;
  }
}

export class JiraClient {
  constructor({ baseUrl, email, token, project, fields, fetchImpl = globalThis.fetch }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.project = project;
    this.fields = fields;
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    this.fetchImpl = fetchImpl;
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
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
    if (!res.ok) {
      const detail = json?.errorMessages?.join('; ') || json?.message || text.slice(0, 300);
      throw new JiraError(`${method} ${path} -> HTTP ${res.status} ${detail}`, { status: res.status, body: json ?? text });
    }
    return json;
  }

  // --- reads -------------------------------------------------------------

  // JQL search via the current endpoint.
  //
  // The legacy `GET /rest/api/3/search` was removed by Atlassian and now answers
  // HTTP 410; `/search/jql` is the replacement. It takes a JSON body, returns
  // `fields` as an array of names, and paginates with `nextPageToken` instead of
  // `startAt`/`total` — there is no total count, so callers must not expect one.
  async search(jql, { maxResults = 50, fields = [], nextPageToken } = {}) {
    const wanted = Array.from(new Set(['summary', 'status', 'description', 'priority', 'labels', ...fields]));
    const json = await this.request('POST', '/rest/api/3/search/jql', {
      body: {
        jql,
        maxResults,
        fields: wanted,
        ...(nextPageToken ? { nextPageToken } : {}),
      },
    });
    return (json?.issues || []).map((issue) => this.normalize(issue));
  }

  async findClaimable(jql) {
    return this.search(jql, { fields: Object.values(this.fields) });
  }

  // All In Build tickets — used by the reaper to find stale leases.
  async findInBuild() {
    const jql = `project = ${this.project} AND status = "${STATUS.IN_BUILD}"`;
    return this.search(jql, { maxResults: 100, fields: Object.values(this.fields) });
  }

  async getIssue(key, { fields = [] } = {}) {
    const wanted = Array.from(new Set(['summary', 'status', 'description', 'priority', 'labels', ...fields]));
    const json = await this.request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`, {
      query: { fields: wanted.join(',') },
    });
    return this.normalize(json);
  }

  async getTransitions(key) {
    const json = await this.request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    return json?.transitions || [];
  }

  // Who the credentials belong to. Useful for an operator script that wants to
  // say "running as X" instead of failing later with a confusing 401.
  async whoami() {
    return this.request('GET', '/rest/api/3/myself');
  }

  // All custom fields on the tenant, so a caller can resolve the Fleet fields by
  // display name rather than hard-coding customfield ids.
  async listFields() {
    return (await this.request('GET', '/rest/api/3/field')) || [];
  }

  // --- writes ------------------------------------------------------------

  async transition(key, name, { fields, extraBody } = {}) {
    const transitions = await this.getTransitions(key);
    const match = transitions.find((t) => t.name.toLowerCase() === String(name).toLowerCase());
    if (!match) {
      throw new JiraError(`no transition "${name}" available on ${key}`, {
        status: 400,
        body: { available: transitions.map((t) => t.name) },
      });
    }
    const body = { transition: { id: match.id }, ...(fields ? { fields } : {}), ...extraBody };
    await this.request('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { body });
    return { id: match.id, name: match.name, to: match.to?.name };
  }

  async setFields(key, fields) {
    await this.request('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { body: { fields } });
  }

  async comment(key, text) {
    await this.request('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      body: { body: textToAdf(text) },
    });
  }

  // Claim = the CAS status transition, then the worker/lease fields.
  //
  // Ideally both go in one request, so a crash cannot leave a ticket In Build
  // with no worker recorded. But Jira only accepts fields in a transition body
  // if they are on that transition's *screen*, and a tenant that has not been
  // configured that way rejects the whole claim with HTTP 400 — which looks
  // exactly like losing a race. So: try the atomic form first, and if Jira says
  // the fields are not on the screen, fall back to transition-then-update.
  //
  // The fallback is safe because the transition still happens first (the CAS),
  // and if the process dies before the update, the lease is null, which the
  // reaper treats as stale and requeues.
  async claim(key, { workerId, now = new Date() }) {
    const claimFields = {
      [this.fields.worker]: workerId,
      [this.fields.lease]: now.toISOString(),
    };

    try {
      return await this.transition(key, TRANSITION.CLAIM, { fields: claimFields });
    } catch (err) {
      if (!isFieldNotOnScreen(err)) throw err;

      // Retry without fields: this is the compare-and-swap on its own.
      const result = await this.transition(key, TRANSITION.CLAIM);
      await this.setFields(key, claimFields);
      return { ...result, fieldsDeferred: true };
    }
  }

  async refreshLease(key, now = new Date()) {
    await this.setFields(key, { [this.fields.lease]: now.toISOString() });
    return now;
  }

  // Report the finished run: record branch + PR, then move In Build -> In Review.
  async report(key, { branch, prUrl }) {
    await this.setFields(key, {
      [this.fields.branch]: branch,
      [this.fields.pr]: prUrl,
    });
    return this.transition(key, TRANSITION.REPORT);
  }

  // Requeue (used by the reaper, on timeout, and by reset_claim): clear the
  // claim fields and move In Build -> Ready for Build.
  async requeue(key, { reason = 'requeued' } = {}) {
    await this.setFields(key, {
      [this.fields.worker]: null,
      [this.fields.lease]: null,
    });
    const result = await this.transition(key, TRANSITION.REQUEUE);
    if (reason) await this.comment(key, reason);
    return result;
  }

  async reject(key, { reason = 'rejected', incrementRetry = false } = {}) {
    if (incrementRetry) {
      const issue = await this.getIssue(key, { fields: [this.fields.retry] });
      const used = toNumber(issue.raw?.fields?.[this.fields.retry]) ?? 0;
      await this.setFields(key, { [this.fields.retry]: used + 1 });
    }
    const result = await this.transition(key, TRANSITION.REJECT);
    if (reason) await this.comment(key, reason);
    return result;
  }

  // --- model -------------------------------------------------------------

  normalize(issue) {
    if (!issue) return null;
    const f = issue.fields || {};
    const description = fieldText(f.description);
    return {
      key: issue.key,
      id: issue.id,
      summary: f.summary || '',
      status: f.status?.name || null,
      priority: f.priority?.name || null,
      labels: f.labels || [],
      description,
      acceptanceCriteria: extractAcceptanceCriteria(description),
      worker: f[this.fields.worker] ?? null,
      lease: f[this.fields.lease] ?? null,
      branch: f[this.fields.branch] ?? null,
      pr: f[this.fields.pr] ?? null,
      retry: toNumber(f[this.fields.retry]),
      raw: issue,
    };
  }
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

// Does this error say "that field is not on the screen"? Jira reports it in the
// `errors` map keyed by field id, e.g.
//   { errors: { customfield_10213: "Field '...' cannot be set. It is not on the
//               appropriate screen, or unknown." } }
// Matching on the specific sentence matters: a 400 for any other reason (a
// required field, a bad value, a lost race) must not be retried as if it were
// this one.
export function isFieldNotOnScreen(err) {
  if (!err || err.status !== 400) return false;
  const errors = err.body?.errors;
  if (!errors || typeof errors !== 'object') return false;
  return Object.values(errors).some((message) =>
    /not on the appropriate screen|not on the transition screen|cannot be set/i.test(String(message)),
  );
}

// Is a lease timestamp older than the staleness window?
export function isLeaseStale(lease, { now = Date.now(), staleMs }) {
  if (!lease) return true;
  const t = Date.parse(lease);
  if (Number.isNaN(t)) return true;
  return now - t > staleMs;
}
