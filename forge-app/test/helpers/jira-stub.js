// A stand-in Jira for driving the operator CLI scripts end to end.
//
// `node scripts/provision.mjs` and `node scripts/verify-setup.mjs` are what a
// human actually runs, so they are exercised as processes against this server
// rather than only imported by tests. It records every write so a dry run can
// be checked for "did it change anything".
import http from 'node:http';
import { adfToText } from '../../src/adf.js';

export function startJiraStub({ fieldList, project = 'FLT', viaEmail = true, isAdmin = true, rejectAuth = false } = {}) {
  const state = {
    fieldList: fieldList ?? [{ id: 'customfield_10101', name: 'Fleet Worker' }],
    isAdmin,
    writes: [],
    requests: [],
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname;
      let body = null;
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      } catch {
        body = null;
      }
      state.requests.push({ method: req.method, path, body });

      const send = (code, payload) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(payload === undefined ? '' : JSON.stringify(payload));
      };

      if (rejectAuth || !String(req.headers.authorization || '').startsWith('Basic ')) {
        return send(401, { errorMessages: ['authentication required'] });
      }

      if (path === '/rest/api/3/myself') {
        return send(200, {
          accountId: '557058:stub-account',
          displayName: 'Stub Admin',
          emailAddress: 'admin@acme.com',
        });
      }
      if (path === '/rest/api/3/mypermissions') {
        return send(200, { permissions: { ADMINISTER: { havePermission: state.isAdmin, id: '0' } } });
      }

      if (path === '/rest/api/3/field' && req.method === 'GET') return send(200, state.fieldList);
      if (path === '/rest/api/3/field' && req.method === 'POST') {
        if (!state.isAdmin) {
          return send(400, { errorMessages: ['Only Jira administrators can perform this operation.'] });
        }
        const created = { id: `customfield_${30000 + state.fieldList.length}`, name: body?.name };
        state.fieldList.push(created);
        state.writes.push({ path, body });
        return send(201, created);
      }

      if (path === '/rest/api/3/project/search') return send(200, { values: [] });
      if (path === '/rest/api/3/project' && req.method === 'POST') {
        state.writes.push({ path, body });
        return send(201, { key: body.key });
      }

      return send(404, { errorMessages: [`no stub for ${req.method} ${path}`] });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        state,
        email: viaEmail ? 'admin@acme.com' : undefined,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

export { adfToText };
