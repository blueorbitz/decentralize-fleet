// Jira Cloud REST v3 client for the Forge app.
//
// Every fleet state change is a Jira write, and the claim is a status
// transition: Jira serialises the transition and rejects a stale source status
// with HTTP 400. That precondition is the compare-and-swap the whole
// concurrency story rests on — the same mechanism fleet-worker relies on.
//
// The transport is injected so the exact same client runs on Forge (asApp
// requestJira) and against a local mock in tests and scripts.
import { fieldText, textToAdf, extractAcceptanceCriteria } from './adf.js';
import { STATUS, TRANSITION, READY_LABEL } from './config.js';

export class JiraError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
    this.body = body;
  }
}

export class JiraClient {
  constructor({ transport, project, fields }) {
    if (!transport) throw new Error('transport is required');
    this.transport = transport;
    this.project = project;
    this.fields = fields;
  }

  // `pathFn` is a tagged-template function so the Forge transport can build a
  // safe, encoded route with `route` and the test transport can resolve it
  // plainly. See transports.js.
  async request(method, pathFn, body) {
    const { status, json, text } = await this.transport.request(method, pathFn, body);
    if (status < 200 || status >= 300) {
      const detail = json?.errorMessages?.join('; ') || json?.message || String(text ?? '').slice(0, 300);
      throw new JiraError(`${method} ${pathFn(plainTag)} -> HTTP ${status} ${detail}`, { status, body: json ?? text });
    }
    return json;
  }

  // --- reads -------------------------------------------------------------

  async search(jql, { maxResults = 50, fields = [] } = {}) {
    const wanted = Array.from(new Set(['summary', 'status', 'description', 'priority', 'labels', ...fields]));
    const json = await this.request('POST', (tag) => tag`/rest/api/3/search/jql`, {
      jql,
      maxResults,
      fields: wanted,
    });
    return (json?.issues || []).map((issue) => this.normalize(issue));
  }

  async findClaimable() {
    return this.search(
      `project = ${this.project} AND status = "${STATUS.READY}" ORDER BY priority DESC, created ASC`,
      { fields: Object.values(this.fields) },
    );
  }

  async findInBuild() {
    return this.search(
      `project = ${this.project} AND status = "${STATUS.IN_BUILD}" ORDER BY priority DESC, created ASC`,
      { maxResults: 100, fields: Object.values(this.fields) },
    );
  }

  async findFailed() {
    return this.search(`project = ${this.project} AND status = "${STATUS.FAILED}"`, {
      maxResults: 100,
      fields: Object.values(this.fields),
    });
  }

  async getIssue(key, { fields = [] } = {}) {
    const wanted = Array.from(new Set(['summary', 'status', 'description', 'priority', 'labels', ...fields]));
    const json = await this.request('GET', (tag) => tag`/rest/api/3/issue/${key}?fields=${wanted.join(',')}`);
    return this.normalize(json);
  }

  async getTransitions(key) {
    const json = await this.request('GET', (tag) => tag`/rest/api/3/issue/${key}/transitions`);
    return json?.transitions || [];
  }

  async getComments(key, { maxResults = 50 } = {}) {
    const json = await this.request('GET', (tag) => tag`/rest/api/3/issue/${key}/comment?maxResults=${maxResults}`);
    return (json?.comments || []).map((c) => ({
      id: c.id,
      author: c.author?.displayName || null,
      created: c.created || null,
      body: fieldText(c.body),
    }));
  }

  // --- writes ------------------------------------------------------------

  async transition(key, name, { fields } = {}) {
    const transitions = await this.getTransitions(key);
    const match = transitions.find((t) => t.name.toLowerCase() === String(name).toLowerCase());
    if (!match) {
      throw new JiraError(`no transition "${name}" available on ${key}`, {
        status: 400,
        body: { available: transitions.map((t) => t.name) },
      });
    }
    const body = { transition: { id: match.id }, ...(fields ? { fields } : {}) };
    await this.request('POST', (tag) => tag`/rest/api/3/issue/${key}/transitions`, body);
    return { id: match.id, name: match.name, to: match.to?.name };
  }

  async setFields(key, fields) {
    await this.request('PUT', (tag) => tag`/rest/api/3/issue/${key}`, { fields });
  }

  // A transition only accepts fields that are on its transition screen. Jira
  // answers with 400 "Field 'X' cannot be set. It is not on the appropriate
  // screen" when they are not, which rejects the whole transition.
  //
  // That is a tenant-configuration difference, not a protocol error, so the
  // caller falls back to transitioning first and writing the fields after.
  // fleet-worker does the same thing (src/worker.js, claim fallback).
  static isScreenRejection(err) {
    if (!err || err.status !== 400) return false;
    const body = err.body;
    if (!body || typeof body !== 'object') return false;
    const text = JSON.stringify(body.errors || body.errorMessages || body);
    return /cannot be set|not on the appropriate screen|is not on the appropriate screen/i.test(text);
  }

  async comment(key, text) {
    await this.request('POST', (tag) => tag`/rest/api/3/issue/${key}/comment`, { body: textToAdf(text) });
  }

  // Transition with fields when the screen allows it, otherwise transition and
  // then write the fields. Returns which path was taken so callers can report it.
  async transitionCarrying(key, name, fields) {
    try {
      const result = await this.transition(key, name, { fields });
      return { ...result, via: 'transition' };
    } catch (err) {
      if (!JiraClient.isScreenRejection(err)) throw err;
      const result = await this.transition(key, name);
      await this.setFields(key, fields);
      return { ...result, via: 'transition-then-update' };
    }
  }

  // Claim = the CAS transition plus the worker/lease fields in one request.
  async claim(key, { workerId, now = new Date() }) {
    return this.transition(key, TRANSITION.CLAIM, {
      fields: {
        [this.fields.worker]: workerId,
        [this.fields.lease]: toJiraDateTime(now),
      },
    });
  }

  async refreshLease(key, now = new Date()) {
    await this.setFields(key, { [this.fields.lease]: toJiraDateTime(now) });
    return now;
  }

  async report(key, { branch, prUrl }) {
    await this.setFields(key, {
      [this.fields.branch]: branch,
      [this.fields.pr]: prUrl,
    });
    return this.transition(key, TRANSITION.REPORT);
  }

  // Requeue clears the claim fields and moves In Build -> Ready for Build.
  async requeue(key, { reason = 'requeued' } = {}) {
    const issue = await this.getIssue(key, { fields: [] });
    const cleared = await this.clearClaim(key, issue.status);
    if (reason) await this.comment(key, reason);
    return cleared;
  }

  // The reaper's repair, split out so a caller can read the status once.
  // Failed -> Ready for Build is also valid on the board, so a ticket that a
  // failed run left in Failed can be requeued by a human without a special case.
  async clearClaim(key, status) {
    const canClear = status === STATUS.IN_BUILD || status === STATUS.FAILED;
    if (canClear) {
      await this.setFields(key, { [this.fields.worker]: null, [this.fields.lease]: null });
    }
    const transition = await this.transition(key, TRANSITION.REQUEUE);
    return { key, from: status, to: transition.to };
  }

  async reject(key, { reason = 'rejected' } = {}) {
    const result = await this.transition(key, TRANSITION.REJECT);
    if (reason) await this.comment(key, reason);
    return result;
  }

  // "Dispatch to fleet": label the ticket and, if it is Triaged, move it to
  // Ready for Build — the only state a polling worker will claim. It never
  // claims on the ticket's behalf; claiming stays a worker-side CAS transition.
  // Idempotent on a ticket that is already Ready.
  //
  // The label and the transition travel together when the transition screen
  // carries Labels. Real tenants often do not, so this falls back rather than
  // failing the dispatch: the ticket still moves, and the label is written
  // immediately after. A ticket that moved but lost its label is worse than a
  // ticket that moved, because the board would show it as not fleet-ready.
  async markReady(key) {
    const issue = await this.getIssue(key, { fields: [] });
    const labels = Array.from(new Set([...(issue.labels || []), READY_LABEL]));

    if (issue.status === STATUS.TRIAGED) {
      const result = await this.transitionCarrying(key, TRANSITION.MARK_READY, { labels });
      return { key, status: STATUS.READY, labels, via: result.via };
    }
    if (issue.status === STATUS.READY) {
      await this.setFields(key, { labels });
      return { key, status: STATUS.READY, labels, via: 'update' };
    }
    throw new JiraError(`${key} is ${issue.status}; only Triaged or Ready tickets can be dispatched`, {
      status: 409,
      body: { status: issue.status },
    });
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

// Jira's datetime fields want `YYYY-MM-DDThh:mm:ss.SSSZ`; ISO strings are that
// already, and this keeps the call sites honest about it.
export function toJiraDateTime(date) {
  return date.toISOString();
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

export function isLeaseStale(lease, { now = Date.now(), staleMs }) {
  if (!lease) return true;
  const t = Date.parse(lease);
  if (Number.isNaN(t)) return true;
  return now - t > staleMs;
}

// Plain (non-encoding) tagged template used only for error messages.
function plainTag(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '');
}
