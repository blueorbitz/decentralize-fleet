// The settings service: everything the settings page can do, with no Forge
// runtime in sight.
//
// It takes a `store` (src/settings/store.js) and a `jira` client (or null when
// validation is not possible), plus the environment, so every method is a pure
// async function a test can drive. src/backend/settings.js wires the real ones
// and enforces the permission gate; this module enforces the rules.
//
// The rules it enforces, straight from the grill doc:
//   - one record per project is the source of truth (D7)
//   - precedence is record -> env -> default (D3)
//   - a save validates first and is refused with per-check detail (D5)
//   - tokens are per project, named, re-revealable, revocable (D8, D9)
//   - the worker gets a copy-paste .env, never a fetch (D4, D11)
import crypto from 'node:crypto';
import {
  defaultRecord,
  normalizeRecord,
  recordFromInput,
  toEffectiveConfig,
} from './schema.js';
import { validateConfig } from '../setup-check.js';

export class SettingsError extends Error {
  constructor(message, { status = 400, details } = {}) {
    super(message);
    this.name = 'SettingsError';
    this.status = status;
    this.details = details;
  }
}

export function createSettingsService({ store, env = process.env, jira = null, now = () => new Date() }) {
  if (!store) throw new Error('a settings store is required');

  return {
    // --- read -------------------------------------------------------------

    // The record as the page needs it. A project with no record is prefilled
    // from env vars (M1) rather than rendered empty.
    async getProject(projectId, { projectKey } = {}) {
      const stored = await store.getConfig(projectId);
      const record = stored
        ? normalizeRecord(stored, { projectId, projectKey })
        : defaultRecord({ projectId, projectKey, env });
      return {
        record,
        configured: Boolean(stored),
        provenance: stored ? 'record' : 'env',
      };
    },

    // The precedence rule, exposed for the panel, the reaper and the MCP server.
    async loadEffectiveConfig({ projectId } = {}) {
      if (projectId) {
        const { record } = await this.getProject(projectId);
        return toEffectiveConfig(record, { defaultWorker: env.FLEET_MCP_WORKER || 'mcp-client' });
      }
      const record = await resolveSoleProject({ store });
      if (!record) return null;
      return toEffectiveConfig(record, { defaultWorker: env.FLEET_MCP_WORKER || 'mcp-client' });
    },

    async listProjects() {
      return store.listConfigs();
    },

    // 0 -> null, 1 -> the record, many -> throw naming the projects (D7).
    async resolveSoleProject() {
      return resolveSoleProject({ store });
    },

    // --- write ------------------------------------------------------------

    // Validating save. `validate` defaults to on; turning it off exists only so
    // a "save anyway" path could be added later, and is not wired to the UI.
    async save(projectId, input, { projectKey, validate = true, jira: jiraOverride } = {}) {
      const record = recordFromInput(input, { projectId, projectKey });

      if (validate) {
        const result = await validateConfig({ jira: jiraOverride ?? jira, record });
        if (!result.ok) {
          throw new SettingsError('this configuration fails its checks; fix the failures and save again', {
            status: 422,
            details: result.checks,
          });
        }
      }

      // Preserve token metadata: tokens are managed by their own actions.
      const existing = await store.getConfig(projectId);
      const tokens = existing ? normalizeRecord(existing, { projectId, projectKey }).tokens : [];

      const next = { ...record, tokens, updatedAt: now().toISOString() };
      await store.setConfig(projectId, next);
      return next;
    },

    // Test connection: the same checks a save runs, without writing.
    async validate(projectId, input, { projectKey, jira: jiraOverride } = {}) {
      const record = input ? recordFromInput(input, { projectId, projectKey }) : (await this.getProject(projectId)).record;
      return validateConfig({ jira: jiraOverride ?? jira, record });
    },

    // --- tokens -----------------------------------------------------------

    // Server-generated, so a weak token is not an option (D10).
    async generateToken(projectId, name = 'token') {
      const id = crypto.randomBytes(6).toString('hex');
      const value = crypto.randomBytes(32).toString('hex');
      return this.addTokenValue(projectId, { id, name, value });
    },

    // Migration path: paste an existing token instead of generating one.
    async addToken(projectId, { id, name, value }) {
      if (!value) throw new SettingsError('a token value is required');
      return this.addTokenValue(projectId, { id: id || crypto.randomBytes(6).toString('hex'), name, value });
    },

    async addTokenValue(projectId, { id, name, value }) {
      const { record, configured } = await this.getProject(projectId);
      if (!configured) {
        throw new SettingsError('configure the fleet before adding a token', { status: 409 });
      }
      const createdAt = now().toISOString();
      const tokens = [...record.tokens, { id, name: String(name || 'token').trim() || 'token', createdAt }];
      await store.setToken(projectId, id, value);
      await store.setConfig(projectId, { ...record, tokens, updatedAt: createdAt });
      return { id, name: tokens.at(-1).name, createdAt, value };
    },

    // Metadata only. The values are never in this list.
    async listTokens(projectId) {
      const { record } = await this.getProject(projectId);
      return record.tokens;
    },

    // Re-revealable behind a click, because a token must be handed out (D9).
    async revealToken(projectId, tokenId) {
      const { record } = await this.getProject(projectId);
      if (!record.tokens.some((t) => t.id === tokenId)) {
        throw new SettingsError(`no token "${tokenId}" in this project`, { status: 404 });
      }
      const value = await store.getToken(projectId, tokenId);
      if (value == null) throw new SettingsError(`token "${tokenId}" has no stored value`, { status: 410 });
      return { id: tokenId, value };
    },

    async revokeToken(projectId, tokenId) {
      const { record, configured } = await this.getProject(projectId);
      if (!configured) throw new SettingsError('this project is not configured', { status: 409 });
      await store.deleteToken(projectId, tokenId);
      const tokens = record.tokens.filter((t) => t.id !== tokenId);
      await store.setConfig(projectId, { ...record, tokens, updatedAt: now().toISOString() });
      return { revoked: tokenId, tokens };
    },

    // --- generated artefacts ---------------------------------------------

    // The worker does not fetch: it reads a .env that an admin copies over.
    workerEnv(record, options) {
      return renderWorkerEnv(record, options);
    },

    // .mcp.json uses a specific token, so a client is bound to one named entry.
    mcpClientConfig(record, tokenValue) {
      return renderMcpClientConfig({ record, tokenValue });
    },
  };
}

// The 0 / 1 / many rule, shared by the service and the entry points.
export async function resolveSoleProject({ store }) {
  const records = await store.listConfigs();
  if (records.length === 0) return null;
  if (records.length === 1) return records[0];
  const names = records.map((r) => r.projectKey || r.projectId).join(', ');
  throw new SettingsError(`more than one project is configured (${names}); say which one`, { status: 409 });
}

// The .env a worker consumes. Only the values the fleet actually needs, so the
// block can be pasted over an existing .env without inventing settings.
export function renderWorkerEnv(record, { heartbeatUrl = null, heartbeatToken = null, intervalMs = 30_000 } = {}) {
  const lines = [
    '# Fleet worker configuration — generated by the Fleet settings page.',
    '# Changes take effect when the worker restarts.',
    '',
    `FLEET_PROJECT=${record.projectKey}`,
    `FLEET_FIELD_WORKER=${record.fields.worker}`,
    `FLEET_FIELD_LEASE=${record.fields.lease}`,
    `FLEET_FIELD_BRANCH=${record.fields.branch}`,
    `FLEET_FIELD_PR=${record.fields.pr}`,
    `FLEET_FIELD_RETRY=${record.fields.retry}`,
    '',
    `FLEET_LEASE_REFRESH_MS=${record.worker.leaseRefreshMs}`,
    `FLEET_LEASE_STALE_MS=${record.timings.leaseStaleMs}`,
    `FLEET_RETRY_BUDGET=${record.worker.retryBudget}`,
    '',
    '# Optional presence heartbeat — without it this machine is invisible on the Fleet page.',
  ];
  // The token is a secret. With no token chosen the whole block stays
  // commented: a copied URL without a token would be a worker that refuses to
  // start, which is a worse default than an invisible machine.
  const url = heartbeatUrl || '<your fleet-heartbeat webtrigger URL>';
  if (heartbeatToken) {
    lines.push(`FLEET_HEARTBEAT_URL=${url}`);
    lines.push(`FLEET_HEARTBEAT_INTERVAL_MS=${intervalMs}`);
    lines.push(`FLEET_HEARTBEAT_TOKEN=${heartbeatToken}`);
  } else {
    lines.push(`# FLEET_HEARTBEAT_URL=${url}`);
    lines.push(`# FLEET_HEARTBEAT_INTERVAL_MS=${intervalMs}`);
    lines.push('# FLEET_HEARTBEAT_TOKEN=<paste a Fleet token, then uncomment all three lines>');
  }
  lines.push('# FLEET_MACHINE=<optional friendly name>');
  if (record.updatedAt) lines.push('', `# Updated ${record.updatedAt}`);
  return lines.join('\n');
}

// A .mcp.json a local coding agent can paste. The URL cannot be known here (it
// is one webtrigger per installation), so it is a placeholder the admin fills.
export function renderMcpClientConfig({ record, tokenValue, url = '<your fleet-mcp webtrigger URL>' }) {
  const body = {
    mcpServers: {
      fleet: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${tokenValue || '<token>'}` },
      },
    },
  };
  return JSON.stringify(body, null, 2);
}
