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

  async search(jql, { maxResults = 50, fields = [] } = {}) {
    const wanted = Array.from(new Set(['summary', 'status', 'description', 'priority', 'labels', ...fields]));
    const json = await this.request('GET', '/rest/api/3/search', {
      query: { jql, maxResults, fields: wanted.join(',') },
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

  // Claim = the CAS transition plus the worker/lease fields in one request.
  async claim(key, { workerId, now = new Date() }) {
    return this.transition(key, TRANSITION.CLAIM, {
      fields: {
        [this.fields.worker]: workerId,
        [this.fields.lease]: now.toISOString(),
      },
    });
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

// Is a lease timestamp older than the staleness window?
export function isLeaseStale(lease, { now = Date.now(), staleMs }) {
  if (!lease) return true;
  const t = Date.parse(lease);
  if (Number.isNaN(t)) return true;
  return now - t > staleMs;
}
