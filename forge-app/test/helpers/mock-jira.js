// A local stand-in for Jira Cloud's REST v3 — the slice the Forge app uses.
//
// Copied from fleet-worker/test/helpers/mock-jira.js on purpose: the app must
// speak the same API the worker does, and a shared mock is how we prove it. The
// one behaviour that matters is that a transition is only valid from the
// ticket's current status, which is the compare-and-swap the fleet relies on.
import http from 'node:http';
import { adfToText } from '../../src/adf.js';

export const FIELDS = {
  worker: 'Fleet Worker',
  lease: 'Fleet Lease',
  branch: 'Fleet Branch',
  pr: 'Fleet PR',
  retry: 'Fleet Retry',
};

// The board workflow (grill doc High #4): which transitions exist per status.
// `Done` is deliberately absent: a finished ticket has no outbound transitions,
// but it is still a valid status a JQL query may name.
export const KNOWN_STATUSES = ['Backlog', 'Triaged', 'Ready for Build', 'In Build', 'In Review', 'Failed', 'Done'];

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
  constructor({ project = 'FLT', fields = FIELDS, fieldList, isAdmin = true, transitionFields } = {}) {
    this.project = project;
    this.fields = fields;
    // Fields the transition screen accepts, by display name. Defaults to the two
    // the worker writes during a claim.
    this.transitionFields = transitionFields;
    // Whether the calling account holds the Administer Jira global permission.
    // Scripts probe this before attempting field creation.
    this.isAdmin = isAdmin;
    // What GET /rest/api/3/field reports. Provisioning and verification both
    // read it, so it is seeded explicitly by the test that cares.
    this.fieldList = fieldList ?? [
      { id: 'customfield_10101', name: 'Fleet Worker' },
      { id: 'customfield_10102', name: 'Fleet Lease' },
      { id: 'customfield_10103', name: 'Fleet Branch' },
      { id: 'customfield_10104', name: 'Fleet PR' },
      { id: 'customfield_10105', name: 'Fleet Retry' },
    ];
    this.issues = new Map();
    this.comments = new Map();
    this.seq = 100;
    this.transitionLog = [];
    this.server = http.createServer((req, res) => this.#handle(req, res));
  }

  addTicket({
    key,
    summary = 'A ticket',
    status = 'Ready for Build',
    description = '',
    priority = 'Medium',
    labels = [],
    fields = {},
  }) {
    this.issues.set(key, {
      key,
      id: String(this.seq++),
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
  }

  #handle(req, res) {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

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

      // GET /rest/api/3/myself — who the token belongs to.
      if (req.method === 'GET' && path === '/rest/api/3/myself') {
        return send(200, {
          accountId: '557058:mock-account',
          displayName: 'Mock User',
          emailAddress: 'mock@example.com',
        });
      }

      // GET /rest/api/3/mypermissions — the caller's global permissions.
      if (req.method === 'GET' && path === '/rest/api/3/mypermissions') {
        return send(200, {
          permissions: {
            ADMINISTER: { havePermission: this.isAdmin, id: '0' },
          },
        });
      }

      // GET /rest/api/3/field — what provisioning reads and creates.
      if (req.method === 'GET' && path === '/rest/api/3/field') {
        return send(200, this.fieldList);
      }
      if (req.method === 'POST' && path === '/rest/api/3/field') {
        if (!this.isAdmin) {
          // A real tenant returns 400, not 403, and localises the message.
          return send(400, { errorMessages: ['Only Jira administrators can perform this operation.'] });
        }
        const created = { id: `customfield_${20000 + this.fieldList.length}`, name: body?.name };
        this.fieldList.push(created);
        return send(201, created);
      }

      // GET /rest/api/3/project/search — what verification looks up.
      if (req.method === 'GET' && path === '/rest/api/3/project/search') {
        return send(200, { values: [{ key: this.project, projectTypeKey: 'software' }] });
      }

      // Atlassian removed the legacy search endpoint; it answers 410. Reproduce
      // that so a client that regresses to it fails loudly here too.
      if (path === '/rest/api/3/search') {
        return send(410, {
          errorMessages: [
            'The requested API has been removed. Please migrate to the /rest/api/3/search/jql API.',
          ],
        });
      }

      // POST /rest/api/3/search/jql
      if (req.method === 'POST' && path === '/rest/api/3/search/jql') {
        const jql = body?.jql || '';
        const statusMatch = jql.match(/status\s*=\s*"([^"]+)"/i);
        const projectMatch = jql.match(/project\s*=\s*(\w+)/i);
        const wantStatus = statusMatch ? statusMatch[1] : null;
        const wantProject = projectMatch ? projectMatch[1] : this.project;

        // A real tenant rejects a status that is not on the project's workflow.
        const knownStatuses = new Set(KNOWN_STATUSES);
        if (wantStatus && !knownStatuses.has(wantStatus)) {
          return send(400, { errorMessages: [`The value '${wantStatus}' does not exist for the field 'status'.`] });
        }
        const issues = [...this.issues.values()].filter((i) => {
          const okProject = i.key.startsWith(`${wantProject}-`);
          const okStatus = !wantStatus || i.fields.status.name === wantStatus;
          return okProject && okStatus;
        });
        return send(200, { issues, total: issues.length });
      }

      let m = path.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment$/);
      if (m && req.method === 'POST') {
        const key = decodeURIComponent(m[1]);
        const raw = typeof body?.body === 'string' ? body.body : adfToText(body?.body);
        const list = this.comments.get(key) || [];
        list.push({ id: String(this.seq++), author: { displayName: 'Fleet' }, created: new Date().toISOString(), body: raw.trim() });
        this.comments.set(key, list);
        return send(201, { id: String(this.seq++) });
      }

      m = path.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment$/);
      if (m && req.method === 'GET') {
        const key = decodeURIComponent(m[1]);
        const list = this.comments.get(key) || [];
        return send(200, {
          comments: list.map((c) => ({
            id: c.id,
            author: c.author,
            created: c.created,
            body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: c.body }] }] },
          })),
        });
      }

      m = path.match(/^\/rest\/api\/3\/issue\/([^/]+)(?:\/(transitions))?$/);
      if (!m) return send(404, { errorMessages: ['not found'] });
      const key = decodeURIComponent(m[1]);
      const sub = m[2];
      const issue = this.issues.get(key);
      if (!issue) return send(404, { errorMessages: [`issue ${key} not found`] });

      if (sub === 'transitions' && req.method === 'GET') {
        const available = FLOW[issue.fields.status.name] || [];
        const expand = url.searchParams.get('expand');
        const withFields = String(expand || '').includes('transitions.fields');
        return send(200, {
          transitions: available.map((t) => ({
            id: t.id,
            name: t.name,
            to: { name: t.to },
            // When expanded, report the fields this transition's screen accepts.
            // `claimFields` on the mock controls it, so a test can simulate the
            // common misconfiguration where the screen lacks the Fleet fields.
            ...(withFields
              ? {
                  hasScreen: true,
                  fields: Object.fromEntries(
                    (this.transitionFields || ['Fleet Worker', 'Fleet Lease']).map((name, i) => [
                      `customfield_${20000 + i}`,
                      { name, required: false, operations: ['set'] },
                    ]),
                  ),
                }
              : {}),
          })),
        });
      }

      if (sub === 'transitions' && req.method === 'POST') {
        const wanted = body?.transition?.id;
        const fromStatus = issue.fields.status.name;
        const match = (FLOW[fromStatus] || []).find((t) => t.id === wanted);
        if (!match) {
          this.transitionLog.push({ key, from: fromStatus, id: wanted, ok: false });
          return send(400, { errorMessages: ['Transition is not valid for the current status'] });
        }
        if (body.fields) this.#applyFields(key, body.fields);
        issue.fields.status = { name: match.to };
        this.transitionLog.push({ key, from: fromStatus, to: match.to, ok: true, name: match.name });
        return send(204);
      }

      if (!sub && req.method === 'GET') return send(200, issue);

      if (!sub && req.method === 'PUT') {
        if (body?.fields) this.#applyFields(key, body.fields);
        return send(204);
      }

      return send(405, { errorMessages: ['method not allowed'] });
    });
  }
}
