// Transports: the only place the app touches HTTP.
//
// The Jira client takes a transport, so the identical client code runs on the
// Forge runtime (`api.asApp().requestJira` with the `route` tagged template)
// and in tests/scripts (plain fetch with an explicit Basic-auth pair). Keeping
// the split here means no other module knows which one it is running under, and
// `node --test` never has to import the Forge runtime.

// Build a transport from a Forge-shaped API object, e.g. the `@forge/api`
// default export. `route` blocks path traversal and encodes query parameters,
// which is why the Jira client passes a tagged-template function.
export function forgeTransport(api) {
  return {
    async request(method, pathFn, body) {
      const path = pathFn(api.route);
      const res = await api.asApp().requestJira(path, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      return { status: res.status, text, json: parseJson(text) };
    },
  };
}

// Basic-auth transport for scripts and the test mock.
export function basicTransport({ baseUrl, email, token, fetchImpl = globalThis.fetch }) {
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  const root = String(baseUrl).replace(/\/+$/, '');
  return {
    async request(method, pathFn, body) {
      const path = pathFn(plainTag);
      const res = await fetchImpl(`${root}${path}`, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: auth },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      return { status: res.status, text, json: parseJson(text) };
    },
  };
}

export function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function plainTag(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + encodeURIComponent(values[i] ?? ''), '');
}
