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
  constructor({ project = 'FLT', fields = DEFAULT_FIELDS, requireAuth = true } = {}) {
    this.project = project;
    this.fields = fields;
    this.requireAuth = requireAuth;
    this.issues = new Map();
    this.comments = new Map();
    this.seq = 100;
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
    return {
      key: i.key,
      summary: f.summary,
      status: f.status.name,
      worker: f[this.fields.worker] ?? null,
      lease: f[this.fields.lease] ?? null,
      branch: f[this.fields.branch] ?? null,
      pr: f[this.fields.pr] ?? null,
      retry: f[this.fields.retry] ?? 0,
      comments: this.comments.get(key) || [],
      description: typeof f.description === 'string' ? f.description : adfToText(f.description),
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

    if (this.requireAuth && !String(req.headers.authorization || '').startsWith('Basic ')) {
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

      // GET /rest/api/3/search
      if (req.method === 'GET' && path === '/rest/api/3/search') {
        const jql = url.searchParams.get('jql') || '';
        const statusMatch = jql.match(/status\s*=\s*"([^"]+)"/i);
        const projectMatch = jql.match(/project\s*=\s*(\w+)/i);
        const wantStatus = statusMatch ? statusMatch[1] : null;
        const wantProject = projectMatch ? projectMatch[1] : this.project;
        const issues = [...this.issues.values()].filter((i) => {
          const okProject = i.key.startsWith(`${wantProject}-`);
          const okStatus = !wantStatus || i.fields.status.name === wantStatus;
          return okProject && okStatus;
        });
        return send(200, { issues, total: issues.length });
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
