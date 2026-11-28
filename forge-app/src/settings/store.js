// Where a project's configuration and its token secrets live.
//
// The store is an interface, not an import of @forge/kvs. The service takes a
// store, so it runs under `node --test` against memoryStore() with no Forge
// runtime, and src/backend/settings.js passes forgeStore(kvs) on Forge. This is
// the same trick src/transports.js uses for HTTP.
//
// Two methods carry the security boundary: listTokens() returns metadata only
// (the record already holds it), and the secret methods are the only way a raw
// token is ever read or written.
import { WhereConditions } from '@forge/kvs';
import { CONFIG_PREFIX, configKey, tokenKey, normalizeRecord } from './schema.js';

export const PROJECT_PREFIX = CONFIG_PREFIX;

/**
 * The store contract. `kvs` is the object from `@forge/kvs`; passing it in is
 * the only place the Forge-specific API is touched.
 */
export function forgeStore(kvs) {
  return {
    async getConfig(projectId) {
      const raw = await kvs.get(configKey(projectId));
      return raw ? normalizeRecord(raw, { projectId }) : null;
    },

    async setConfig(projectId, record) {
      await kvs.set(configKey(projectId), record);
      return record;
    },

    async deleteConfig(projectId) {
      await kvs.delete(configKey(projectId));
    },

    // Every configured project. Used by the reaper (one pass per project) and by
    // the context-less consumers' 0 / 1 / many rule.
    async listConfigs() {
      const seen = new Map();
      let cursor;
      for (let page = 0; page < 100; page += 1) {
        const query = kvs.query().where('key', WhereConditions.beginsWith(PROJECT_PREFIX));
        if (cursor) query.cursor(cursor);
        const batch = await query.getMany();
        for (const item of batch?.results || []) {
          const projectId = String(item.key).slice(PROJECT_PREFIX.length);
          seen.set(projectId, normalizeRecord(item.value, { projectId }));
        }
        cursor = batch?.nextCursor;
        if (!cursor) break;
      }
      return [...seen.values()];
    },

    async setToken(projectId, tokenId, value) {
      await kvs.setSecret(tokenKey(projectId, tokenId), value);
    },

    async getToken(projectId, tokenId) {
      const value = await kvs.getSecret(tokenKey(projectId, tokenId));
      return value == null ? null : String(value);
    },

    async deleteToken(projectId, tokenId) {
      await kvs.deleteSecret(tokenKey(projectId, tokenId));
    },

    // Metadata of every secret token for a project, so the webtrigger can
    // compare an inbound bearer against all of them and bind the session to a
    // project without the caller naming one.
    //
    // Read from the record, not a query: `kvs.query` deliberately does not
    // return secret values, and the metadata is in the record for exactly this
    // reason. Each id's value is still fetched with `getSecret`.
    async listTokens(projectId) {
      const record = await this.getConfig(projectId);
      return (record?.tokens || []).map((t) => ({ tokenId: t.id }));
    },

    // Read every active token value for a project. Used to resolve a bearer to a
    // project; only ever called from the server side.
    async getProjectTokens(projectId) {
      const listed = await this.listTokens(projectId);
      const values = [];
      for (const { tokenId } of listed) {
        const value = await this.getToken(projectId, tokenId);
        if (value) values.push({ tokenId, value });
      }
      return values;
    },
  };
}

// The in-memory double the tests and the service's examples use. Same contract,
// including the secret/unencrypted split, so a test cannot accidentally pass by
// reading a secret through the plain API.
export function memoryStore({ configs = [], tokens = {} } = {}) {
  const plain = new Map();
  const secrets = new Map();

  for (const record of configs) plain.set(configKey(record.projectId), record);
  for (const [key, value] of Object.entries(tokens)) secrets.set(key, value);

  return {
    async getConfig(projectId) {
      const raw = plain.get(configKey(projectId));
      return raw ? normalizeRecord(raw, { projectId }) : null;
    },
    async setConfig(projectId, record) {
      plain.set(configKey(projectId), record);
      return record;
    },
    async deleteConfig(projectId) {
      plain.delete(configKey(projectId));
    },
    async listConfigs() {
      const out = [];
      for (const [key, value] of plain) {
        if (!key.startsWith(PROJECT_PREFIX)) continue;
        out.push(normalizeRecord(value, { projectId: key.slice(PROJECT_PREFIX.length) }));
      }
      return out;
    },
    async setToken(projectId, tokenId, value) {
      secrets.set(tokenKey(projectId, tokenId), value);
    },
    async getToken(projectId, tokenId) {
      const value = secrets.get(tokenKey(projectId, tokenId));
      return value == null ? null : String(value);
    },
    async deleteToken(projectId, tokenId) {
      secrets.delete(tokenKey(projectId, tokenId));
    },
    async listTokens(projectId) {
      // Same rule as forgeStore: the record holds the metadata, the secrets
      // hold the values.
      const record = plain.get(configKey(projectId));
      return (record?.tokens || []).map((t) => ({ tokenId: t.id }));
    },
    async getProjectTokens(projectId) {
      const out = [];
      for (const { tokenId } of await this.listTokens(projectId)) {
        const value = await this.getToken(projectId, tokenId);
        if (value) out.push({ tokenId, value });
      }
      return out;
    },
  };
}
