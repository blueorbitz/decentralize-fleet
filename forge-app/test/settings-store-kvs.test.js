import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgeStore } from '../src/settings/store.js';
import { configKey, tokenKey, normalizeRecord, defaultRecord } from '../src/settings/schema.js';

// forgeStore is the one part of the settings surface that talks to @forge/kvs.
// This drives it against a fake that implements the KVS shape the package
// documents — get/set/delete, getSecret/setSecret/deleteSecret, and a
// query().where(cursor).getMany() pager — so a wrong API assumption fails here
// rather than at first use on a tenant.

function fakeKvs() {
  const plain = new Map();
  const secrets = new Map();
  return {
    plain,
    secrets,
    async get(key) {
      return plain.get(key);
    },
    async set(key, value) {
      plain.set(key, value);
    },
    async delete(key) {
      plain.delete(key);
    },
    async getSecret(key) {
      return secrets.get(key);
    },
    async setSecret(key, value) {
      secrets.set(key, value);
    },
    async deleteSecret(key) {
      secrets.delete(key);
    },
    query() {
      const state = { prefix: '', cursor: null };
      const builder = {
        where(_property, condition) {
          if (condition?.condition !== 'BEGINS_WITH') throw new Error(`unexpected condition ${condition}`);
          state.prefix = condition.values[0];
          return builder;
        },
        cursor(value) {
          state.cursor = value;
          return builder;
        },
        limit() {
          return builder;
        },
        // Two pages of one entry each, to exercise nextCursor handling.
        async getMany() {
          const matches = [...plain.keys()].filter((k) => k.startsWith(state.prefix)).sort();
          const start = state.cursor ? Number(state.cursor) : 0;
          const page = matches.slice(start, start + 1).map((key) => ({ key, value: plain.get(key) }));
          const next = start + 1 < matches.length ? String(start + 1) : undefined;
          return { results: page, nextCursor: next };
        },
      };
      return builder;
    },
  };
}

test('forgeStore reads and writes through the documented KVS API', async () => {
  const kvs = fakeKvs();
  const store = forgeStore(kvs);

  const record = normalizeRecord(defaultRecord({ projectId: '7', projectKey: 'OPS' }));
  await store.setConfig('7', { ...record, updatedAt: '2026-01-01T00:00:00Z' });

  assert.equal(kvs.plain.has(configKey('7')), true);
  const got = await store.getConfig('7');
  assert.equal(got.projectKey, 'OPS');
  assert.equal(got.updatedAt, '2026-01-01T00:00:00Z');

  assert.equal(await store.getConfig('missing'), null);
});

test('listConfigs follows nextCursor across pages', async () => {
  const kvs = fakeKvs();
  const store = forgeStore(kvs);
  for (const id of ['1', '2', '3']) {
    await store.setConfig(id, normalizeRecord(defaultRecord({ projectId: id, projectKey: `P${id}` })));
  }
  const all = await store.listConfigs();
  assert.deepEqual(all.map((r) => r.projectId).sort(), ['1', '2', '3']);
});

test('token values go to the secret store, never the plain one', async () => {
  const kvs = fakeKvs();
  const store = forgeStore(kvs);

  // The record carries the metadata; the secret carries the value.
  await store.setConfig('7', {
    ...normalizeRecord(defaultRecord({ projectId: '7', projectKey: 'OPS' })),
    tokens: [{ id: 'abc', name: 'ci', createdAt: '2026-01-01T00:00:00Z' }],
  });
  await store.setToken('7', 'abc', 'super-secret');
  assert.equal(kvs.plain.has(tokenKey('7', 'abc')), false, 'a token must not land in the queryable store');
  assert.equal(kvs.secrets.get(tokenKey('7', 'abc')), 'super-secret');

  assert.equal(await store.getToken('7', 'abc'), 'super-secret');
  const listed = await store.listTokens('7');
  assert.deepEqual(listed, [{ tokenId: 'abc' }]);

  const values = await store.getProjectTokens('7');
  assert.deepEqual(values, [{ tokenId: 'abc', value: 'super-secret' }]);

  await store.deleteToken('7', 'abc');
  assert.equal(await store.getToken('7', 'abc'), null);
});
