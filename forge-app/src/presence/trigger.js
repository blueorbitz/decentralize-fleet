// The heartbeat webtrigger's HTTP half: bearer auth, JSON body, envelope.
//
// Same shape as src/mcp-trigger.js. The Forge platform serves webtriggers
// unauthenticated, so the bearer is the only gate. A project token is matched
// across every configured project and decides which project the beat belongs
// to; an installation-wide env token binds to the sole configured project.
import { parseJson } from '../transports.js';
import { bearerValue, firstHeader, hasAnyTokens, resolveTokenProject } from '../mcp-trigger.js';
import { resolveSoleProject } from '../settings/service.js';
import { PresenceError } from './schema.js';

export function createHeartbeatTrigger({
  settingsStore = null,
  presence,
  env = process.env,
  legacyToken,
  logger = console,
}) {
  if (!presence) throw new Error('createHeartbeatTrigger needs a presence service');

  return async function heartbeatHandler(request) {
    const method = String(request?.method || 'POST').toUpperCase();
    if (method !== 'POST') {
      return json(405, { error: 'method not allowed' }, { Allow: ['POST'] });
    }

    if (!settingsStore) {
      return json(503, { error: 'no fleet is configured on this installation — open Project settings → Fleet settings' });
    }

    const siteToken = legacyToken ?? env.FLEET_HEARTBEAT_TOKEN ?? env.FLEET_MCP_TOKEN ?? '';
    const bearer = bearerValue(firstHeader(request?.headers || {}, 'authorization'));

    let projectId = null;

    if (siteToken && bearer === siteToken) {
      try {
        const record = await resolveSoleProject({ store: settingsStore });
        if (!record) {
          return json(503, {
            error: 'no fleet is configured on this installation — open Project settings → Fleet settings',
          });
        }
        projectId = record.projectId;
      } catch (err) {
        return json(409, { error: err.message });
      }
    } else if (settingsStore && bearer) {
      try {
        const match = await resolveTokenProject({ store: settingsStore, bearer });
        projectId = match?.projectId || null;
      } catch (err) {
        logger.error?.(`heartbeat token lookup failed: ${err.message}`);
      }
    }

    if (!projectId) {
      const anyTokens = Boolean(siteToken) || (await hasAnyTokens(settingsStore, logger));
      if (!anyTokens) {
        return json(503, {
          error: 'no fleet is configured on this installation — open Project settings → Fleet settings',
        });
      }
      return json(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    }

    const body = parseJson(request?.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(400, { error: 'expected a JSON object' });
    }

    try {
      const record = await presence.record(projectId, body);
      return json(200, { ok: true, workerId: record.workerId, lastSeen: record.lastSeen });
    } catch (err) {
      if (err instanceof PresenceError) return json(err.status, { error: err.message });
      logger.error?.(`heartbeat failed: ${err.message}`);
      return json(500, { error: 'heartbeat could not be recorded' });
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
