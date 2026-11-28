// The MCP webtrigger's HTTP half: auth, JSON-RPC parse, and the response
// envelope. Kept free of the Forge runtime so it can be served over real HTTP in
// tests, and so the only thing the backend entry wires is "make me a server".
//
// The webtrigger is unauthenticated by the Forge platform, so this is the only
// thing standing between the endpoint and the board. There is one webtrigger per
// installation and many project tokens, so the bearer is compared against every
// active project token; the match decides which project the session is bound to
// (grill D8). No MCP `project` argument is needed or honoured.
//
// A single installation-wide FLEET_MCP_TOKEN is still accepted — that is an
// install that has not opened the settings page yet — but it binds to the sole
// configured project, and disappears once the page is used.
import { parseJson } from './transports.js';

export function createMcpTrigger({
  store = null,
  makeServer,
  env = process.env,
  // An explicit override (tests); otherwise read per request, like env always was.
  legacyToken,
  logger = console,
}) {
  return async function mcpHandler(request) {
    const siteToken = legacyToken ?? env.FLEET_MCP_TOKEN ?? '';
    const auth = firstHeader(request?.headers || {}, 'authorization');
    const bearer = bearerValue(auth);
    const isGet = String(request?.method || 'POST').toUpperCase() === 'GET';

    // 1. Resolve the bearer to a project. Site-wide token first (legacy), then
    //    every configured project's secrets.
    let projectId = null;
    let siteWide = false;

    if (siteToken && bearer === siteToken) {
      siteWide = true;
    } else if (store) {
      try {
        const match = await resolveTokenProject({ store, bearer });
        projectId = match?.projectId || null;
      } catch (err) {
        logger.error?.(`mcp token lookup failed: ${err.message}`);
      }
    }

    const anyTokens = Boolean(siteToken) || (await hasAnyTokens(store, logger));

    if (!siteWide && !projectId) {
      if (!anyTokens) {
        return json(503, {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: 'no fleet is configured on this installation — open Project settings → Fleet settings',
          },
        });
      }
      // A client probing for a stream before it has sent the header.
      return json(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    }

    if (isGet) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': ['text/event-stream'], 'Cache-Control': ['no-store'] },
        body: '',
      };
    }

    const msg = parseJson(request?.body);
    if (msg === null) {
      return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }

    try {
      const server = await makeServer({ projectId, siteWide });
      const response = await server.handle(msg);
      if (!response) return { statusCode: 202, headers: {}, body: '' };
      return json(200, response);
    } catch (err) {
      logger.error?.(`mcp webtrigger failed: ${err.message}`);
      if (msg.method === 'tools/call') {
        return json(200, {
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: { content: [{ type: 'text', text: `error: ${err.message}` }], isError: true },
        });
      }
      return json(200, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: err.message } });
    }
  };
}

// Compare the bearer against every configured project's token values. Returns
// the project the token belongs to. The number of projects is small (one per
// Jira project using the fleet), so a linear scan is the honest implementation.
export async function resolveTokenProject({ store, bearer }) {
  if (!bearer) return null;
  const records = await store.listConfigs();
  for (const record of records) {
    const tokens = await store.getProjectTokens(record.projectId);
    if (tokens.some((t) => t.value === bearer)) {
      return { projectId: record.projectId, projectKey: record.projectKey };
    }
  }
  return null;
}

export async function hasAnyTokens(store, logger) {
  if (!store) return false;
  try {
    const records = await store.listConfigs();
    for (const record of records) {
      if (record.tokens.length) return true;
    }
  } catch (err) {
    logger.error?.(`mcp token count failed: ${err.message}`);
  }
  return false;
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': ['application/json'], 'Cache-Control': ['no-store'], ...extraHeaders },
    body: JSON.stringify(body),
  };
}

export function firstHeader(headers, name) {
  const wanted = String(name).toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === wanted) return Array.isArray(v) ? v[0] : v;
  }
  return null;
}

// Accept "Bearer <token>" and a bare token; the header is case-insensitive.
export function bearerValue(header) {
  if (!header) return '';
  const str = String(header).trim();
  const match = str.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : str;
}
