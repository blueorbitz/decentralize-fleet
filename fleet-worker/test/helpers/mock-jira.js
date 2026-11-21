// A local stand-in for Jira Cloud's REST v3 — just the slice the fleet uses.
//
// The point of this mock is to be honest about the one behaviour the whole
// design depends on: Claim is a status transition, and Jira rejects a
// transition that is not valid for the issue's *current* status. That is the
// compare-and-swap. Everything else (fields, comments, search) is a faithful
// enough subset to run the worker end to end without a real tenant.
import http from 'node:http';
import { adfToText, textToAdf } from '../../src/adf.js';

export const DEFAULT_FIELDS = {
  worker: 'Fleet Worker',
  lease: 'Fleet Lease',
  branch: 'Fleet Branch',
  pr: 'Fleet PR',
  retry: 'Fleet Retry',
};

// Which transitions exist from each status, and where they land.
export const FLOW = {
  Backlog: [{ id: '11', name: 'Triage', to: 'Triaged' }],
  Triaged: [{ id: '12', name: 'Mark Ready', to: 'Ready for Build' }],
  'Ready for Build': [{ id: '21', name: 'Claim', to: 'In Build' }],
  'In Build': [
    { id: '31', name: 'Requeue', to: 'Ready for Build' },
    { id: '32', name: 'Reject', to: 'Failed' },
    { id: '33', name: 'Report PR', to: 'In Review' },
  ],
  'In Review': [{ id: '41', name: 'Finish', to: 'Done' }],
  Failed: [{ id: '51', name: 'Requeue', to: 'Ready for Build' }],
};

export class MockJira {
  constructor({ project = 'FLT', fields = DEFAULT_FIELDS, requireAuth = true, fieldList = null, rejectAuth = false, rejectTransitionFields = false } = {}) {
    this.project = project;
    this.fields = fields;
    this.requireAuth = requireAuth;
    // When true, a transition that carries fields is refused with a 400, as Jira
    // does when those fields are not on the transition's screen.
    this.rejectTransitionFields = rejectTransitionFields;
    // What GET /rest/api/3/field reports; null means "all fields this mock knows".
    this.fieldList = fieldList;
    this.rejectAuth = rejectAuth;
    this.issues = new Map();
    this.comments = new Map();
    this.seq = 100;
    // Every request the client made, so tests can assert on the wire shape.
    this.requests = [];
    this.writes = [];
    this.transitionLog = [];
    this.server = http.createServer((req, res) => this.#handle(req, res));
  }

  addTicket({ key, summary = 'A ticket', status = 'Ready for Build', description = '', priority = 'Medium', labels = [], fields = {} }) {
    const id = String(this.seq++);
    this.issues.set(key, {
      key,
      id,
      fields: { summary, status: { name: status }, description, priority: { name: priority }, labels, ...fields },
    });
    return this.plain(key);
  }

  plain(key) {
    const i = this.issues.get(key);
    if (!i) return null;
    const f = i.fields;
    // The worker normally writes by display name (tests pass `--field-*` names),
    // but an operator script resolves real customfield ids. Accept both so a
    // ticket written with ids is still readable here.
    const read = (displayName, fallbackId) => f[displayName] ?? f[fallbackId] ?? null;
    return {
      key: i.key,
      summary: f.summary,
      status: f.status.name,
      worker: read(this.fields.worker, 'customfield_10001'),
      lease: read(this.fields.lease, 'customfield_10002'),
      branch: read(this.fields.branch, 'customfield_10003'),
      pr: read(this.fields.pr, 'customfield_10004'),
      retry: read(this.fields.retry, 'customfield_10005') ?? 0,
      labels: f.labels || [],
      description: typeof f.description === 'string' ? f.description : adfToText(f.description),
      comments: this.comments.get(key) || [],
    };
  }

  async start() {
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${this.server.address().port}`;
    return this.baseUrl;
  }

  async stop() {
    await new Promise((resolve) => this.server.close(resolve));
  }

  #applyFields(key, fields) {
    const issue = this.issues.get(key);
    for (const [k, v] of Object.entries(fields || {})) {
      issue.fields[k] = v === null ? undefined : v;
    }
    this.writes.push({ key, fields });
  }

  #handle(req, res) {
    const send = (code, body) => {
      const text = body === undefined ? '' : JSON.stringify(body);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(text);
    };

    if (this.rejectAuth || (this.requireAuth && !String(req.headers.authorization || '').startsWith('Basic '))) {
      return send(401, { errorMessages: ['authentication required'] });
    }

    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          body = null;
        }
      }
      this.requests.push({ method: req.method, path, body });

      // GET /rest/api/3/field — lets an operator script resolve the Fleet
      // fields by display name instead of hard-coding customfield ids. Set
      // `fieldList` to simulate a partially provisioned tenant.
      if (req.method === 'GET' && path === '/rest/api/3/field') {
        const all = Object.entries(this.fields).map(([key, name], i) => ({
          id: `customfield_${10001 + i}`,
          name,
          custom: true,
          schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield' },
          clauseNames: [name],
          _fleetKey: key,
        }));
        return send(200, this.fieldList ?? all);
      }

      // GET /rest/api/3/myself — who the token belongs to.
      if (req.method === 'GET' && path === '/rest/api/3/myself') {
        return send(200, {
          accountId: '557058:mock-account',
          displayName: 'Mock Bot',
          emailAddress: 'bot@demo',
        });
      }

      // The legacy search endpoint was removed by Atlassian. Answer it the way
      // production does, so a regression is a clear failure rather than a flake.
      if (path === '/rest/api/3/search') {
        return send(410, {
          errorMessages: [
            'The requested API has been removed. Please migrate to the /rest/api/3/search/jql API.',
          ],
        });
      }

      // POST /rest/api/3/search/jql — the current JQL search.
      if (req.method === 'POST' && path === '/rest/api/3/search/jql') {
        const jql = body?.jql || '';
        const statusMatch = jql.match(/status\s*=\s*"([^"]+)"/i);
        const projectMatch = jql.match(/project\s*=\s*(\w+)/i);
        const wantStatus = statusMatch ? statusMatch[1] : null;
        const wantProject = projectMatch ? projectMatch[1] : this.project;
        const issues = [...this.issues.values()].filter((i) => {
          const okProject = i.key.startsWith(`${wantProject}-`);
          const okStatus = !wantStatus || i.fields.status.name === wantStatus;
          return okProject && okStatus;
        });
        // The real endpoint returns no `total`; it pages with `nextPageToken`.
        return send(200, { issues, isLast: true });
      }

      const issueMatch = path.match(/^\/rest\/api\/3\/issue\/([^/]+)(?:\/(transitions|comment))?$/);
      if (!issueMatch) return send(404, { errorMessages: ['not found'] });
      const key = decodeURIComponent(issueMatch[1]);
      const sub = issueMatch[2];
      const issue = this.issues.get(key);
      if (!issue) return send(404, { errorMessages: [`issue ${key} not found`] });

      if (sub === 'transitions' && req.method === 'GET') {
        const available = FLOW[issue.fields.status.name] || [];
        return send(200, { transitions: available.map((t) => ({ id: t.id, name: t.name, to: { name: t.to } })) });
      }

      if (sub === 'transitions' && req.method === 'POST') {
        const wanted = body?.transition?.id;
        const fromStatus = issue.fields.status.name;
        const available = FLOW[fromStatus] || [];
        const match = available.find((t) => t.id === wanted);
        if (!match) {
          this.transitionLog.push({ key, from: fromStatus, id: wanted, ok: false });
          return send(400, { errorMessages: ['Transition is not valid for the current status'] });
        }
        // Simulate a transition screen that rejects the fields we sent — the
        // misconfiguration whose 400 is indistinguishable from a lost race.
        // The message matches production exactly, because the client keys off
        // the wording to decide whether to fall back.
        if (this.rejectTransitionFields && body.fields) {
          const rejected = Object.keys(body.fields);
          this.transitionLog.push({ key, from: fromStatus, id: wanted, ok: false, cause: 'fields' });
          return send(400, {
            errorMessages: [],
            errors: Object.fromEntries(
              rejected.map((id) => [
                id,
                `Field '${id}' cannot be set. It is not on the appropriate screen, or unknown.`,
              ]),
            ),
          });
        }
        if (body.fields) this.#applyFields(key, body.fields);
        issue.fields.status = { name: match.to };
        this.transitionLog.push({ key, from: fromStatus, to: match.to, ok: true, name: match.name });
        return send(204);
      }

      if (sub === 'comment' && req.method === 'POST') {
        const raw = typeof body?.body === 'string' ? body.body : adfToText(body?.body);
        const text = raw.trim();
        const list = this.comments.get(key) || [];
        list.push(text);
        this.comments.set(key, list);
        return send(201, { id: String(this.seq++) });
      }

      if (!sub && req.method === 'GET') {
        return send(200, issue);
      }

      if (!sub && req.method === 'PUT') {
        if (body?.fields) this.#applyFields(key, body.fields);
        return send(204);
      }

      return send(405, { errorMessages: ['method not allowed'] });
    });
  }
}

export { textToAdf };
