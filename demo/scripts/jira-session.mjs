// A small Jira REST client that authenticates with the saved *browser session*
// instead of an API token.
//
// The demo scripts need to read and nudge tickets, and the browser session is
// already required for the takes. Using one credential for both means a revoked
// or rotated API token cannot block the recording.
//
// Credentials come from demo/.auth/jira.json, the same file the capture scripts
// use. Tokens are never printed.
import { loadSession } from './capture-lib.mjs';

const SITE = 'https://captain-sage.atlassian.net';

export function sessionClient({ site = SITE } = {}) {
  const state = loadSession();
  if (!state) throw new Error('no saved session — run `node scripts/capture-login.mjs` first');

  // Atlassian's site scopes its own cookies; the api gateway accepts the same
  // session cookies the browser sends.
  const cookie = state.cookies
    .filter((c) => c.domain.includes('atlassian'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  async function request(method, endpoint, body) {
    const res = await fetch(`${site}${endpoint}`, {
      method,
      headers: {
        Cookie: cookie,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* leave null */
    }
    if (!res.ok) {
      const detail = json?.errorMessages?.join('; ') || json?.message || text.slice(0, 220);
      throw new Error(`${method} ${endpoint} -> HTTP ${res.status} ${detail}`);
    }
    return json;
  }

  return {
    request,
    async issue(key, fields = 'summary,status,labels') {
      return request('GET', `/rest/api/3/issue/${key}?fields=${fields}`);
    },
    async status(key) {
      const json = await request('GET', `/rest/api/3/issue/${key}?fields=status,labels`);
      return { status: json.fields?.status?.name, labels: json.fields?.labels || [] };
    },
    async transitions(key) {
      const json = await request('GET', `/rest/api/3/issue/${key}/transitions`);
      return json.transitions || [];
    },
    async transition(key, name) {
      const list = await this.transitions(key);
      const match = list.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (!match) {
        throw new Error(`no transition "${name}"; available: ${list.map((t) => t.name).join(', ') || '(none)'}`);
      }
      await request('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: match.id } });
      return match.to?.name;
    },
    async setFields(key, fields) {
      await request('PUT', `/rest/api/3/issue/${key}`, { fields });
    },
    async search(jql, maxResults = 30) {
      const json = await request(
        'GET',
        `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status`,
      );
      return json.issues || [];
    },
  };
}
