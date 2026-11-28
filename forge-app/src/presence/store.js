// Where presence records live.
//
// The store is an interface, not an import of @forge/kvs, exactly like
// src/settings/store.js: the service runs under `node --test` against
// memoryPresenceStore(), and src/backend/index.js passes forgePresenceStore(kvs)
// on Forge.
import { WhereConditions } from '@forge/kvs';
import { MAX_WORKERS, presenceKey, presencePrefix } from './schema.js';

export function forgePresenceStore(kvs) {
  return {
    async get(projectId, workerId) {
      return (await kvs.get(presenceKey(projectId, workerId))) || null;
    },

    async set(projectId, record) {
      await kvs.set(presenceKey(projectId, record.workerId), record);
      return record;
    },

    async delete(projectId, workerId) {
      await kvs.delete(presenceKey(projectId, workerId));
    },

    // Every record for one project. The key prefix is the project boundary, so
    // a heartbeat token for project A can never surface project B's workers.
    async list(projectId) {
      const seen = new Map();
      let cursor;
      for (let page = 0; page < 10; page += 1) {
        const query = kvs.query().where('key', WhereConditions.beginsWith(presencePrefix(projectId)));
        if (cursor) query.cursor(cursor);
        const batch = await query.getMany();
        for (const item of batch?.results || []) seen.set(item.key, item.value);
        cursor = batch?.nextCursor;
        if (!cursor) break;
      }
      return [...seen.values()].filter(Boolean).slice(0, MAX_WORKERS);
    },
  };
}

export function memoryPresenceStore() {
  const plain = new Map();

  return {
    async get(projectId, workerId) {
      return plain.get(presenceKey(projectId, workerId)) || null;
    },
    async set(projectId, record) {
      plain.set(presenceKey(projectId, record.workerId), record);
      return record;
    },
    async delete(projectId, workerId) {
      plain.delete(presenceKey(projectId, workerId));
    },
    async list(projectId) {
      const prefix = presencePrefix(projectId);
      const out = [];
      for (const [key, value] of plain) {
        if (key.startsWith(prefix)) out.push(value);
      }
      return out.slice(0, MAX_WORKERS);
    },
  };
}
