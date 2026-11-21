// The MCP webtrigger's HTTP half: auth, JSON-RPC parse, and the response
// envelope. Kept free of the Forge runtime so it can be served over real HTTP in
// tests, and so the only thing the backend entry wires is "make me a server".
//
// The webtrigger is unauthenticated by the Forge platform, so this is the only
// thing standing between the endpoint and the board: FLEET_MCP_TOKEN must be
// configured and must match the Authorization header, or the request is refused.
import { parseJson } from './transports.js';

export function createMcpTrigger({ makeServer, env = process.env, logger = console }) {
  return async function mcpHandler(request) {
    const token = env.FLEET_MCP_TOKEN || '';
    const auth = firstHeader(request?.headers || {}, 'authorization');
    const isGet = String(request?.method || 'POST').toUpperCase() === 'GET';

    if (!token) {
      return json(503, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'FLEET_MCP_TOKEN is not set on this app environment' },
      });
    }
    if (auth !== `Bearer ${token}`) {
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
      const server = makeServer();
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

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': ['application/json'], 'Cache-Control': ['no-store'], ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function firstHeader(headers, name) {
  const wanted = String(name).toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === wanted) return Array.isArray(v) ? v[0] : v;
  }
  return null;
}
