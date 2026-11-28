import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../src/settings/store.js';
import { createSettingsService, resolveSoleProject, SettingsError, renderWorkerEnv } from '../src/settings/service.js';
import { createSettingsResolver, projectFromContext, DEFAULT_PROTOCOL } from '../src/settings/resolver.js';
import { defaultRecord, normalizeRecord, configKey, tokenKey } from '../src/settings/schema.js';
import { DEFAULT_FIELDS } from '../src/config.js';

// The settings surface, driven the way the page drives it: a memory store and a
// resolver with an injected permission probe. No Forge runtime, no @forge/react.

const NOW = new Date('2026-01-01T12:00:00Z');
const fixedNow = () => NOW;

// A Jira that answers every readiness check. This double is about the settings
// plumbing, so it resolves both display-name defaults and the customfield ids a
// test might save.
function passingJira(fieldIds = {}) {
  const names = Object.values(DEFAULT_FIELDS);
  const fieldList = Object.entries(fieldIds).map(([key, id]) => ({ id, name: DEFAULT_FIELDS[key] }));
  names.forEach((name, i) => {
    fieldList.push({ id: `customfield_${10000 + i}`, name });
    fieldList.push({ id: `customfield_${i + 1}`, name });
  });
  const plain = (s, ...v) => s.reduce((a, x, i) => a + x + (v[i] ?? ''), '');
  return {
    fieldList,
    request: async (method, pathFn) => {
      const path = pathFn(plain);
      // Any customfield id the record names resolves: this double is about the
      // settings plumbing, not about which ids a tenant actually has.
      if (path.includes('/rest/api/3/field') && !path.includes('/issue')) return fieldList;
      if (path.includes('/project/search')) {
        // Echo whichever key was asked for, so a second project also validates.
        const key = decodeURIComponent((path.match(/query=([^&]+)/) || [])[1] || 'FLT');
        return { values: [{ key, projectTypeKey: 'software' }] };
      }
      if (path.includes('/transitions')) {
        return {
          transitions: [
            { id: '1', name: 'Claim', to: { name: 'In Build' }, hasScreen: true, fields: {} },
          ],
        };
      }
      return {};
    },
    search: async (jql = '') => {
      const key = (jql.match(/project\s*=\s*(\w+)/i) || [])[1] || 'FLT';
      return [{ key: `${key}-1`, status: 'Ready for Build' }];
    },
    getTransitions: async () => [{ id: '1', name: 'Claim' }],
  };
}

function service(store, extra = {}) {
  // A passing validation, so saves can be exercised without a Jira tenant. The
  // readiness checks themselves are covered by setup-check.test.js.
  return createSettingsService({ store, env: {}, now: fixedNow, jira: passingJira(extra.fieldIds), ...extra });
}

function resolver({ store, canEdit = true, service: svc, heartbeatUrl } = {}) {
  return createSettingsResolver({
    service: svc || service(store),
    isProjectAdmin: async () => canEdit,
    ...(heartbeatUrl ? { heartbeatUrl } : {}),
  });
}

const project = { id: '10001', key: 'FLT' };
const context = (extra = {}) => ({ context: { extension: { project, ...extra } } });

test('an unconfigured project is prefilled from env, not rendered empty', async () => {
  const svc = createSettingsService({
    store: memoryStore(),
    env: { FLEET_FIELD_WORKER: 'customfield_90001', FLEET_LEASE_STALE_MS: '600000' },
    now: fixedNow,
  });
  const { record, configured, provenance } = await svc.getProject(project.id, { projectKey: project.key });

  assert.equal(configured, false);
  assert.equal(provenance, 'env');
  assert.equal(record.projectId, project.id);
  assert.equal(record.projectKey, 'FLT');
  assert.equal(record.fields.worker, 'customfield_90001');
  assert.equal(record.timings.leaseStaleMs, 600000);
  assert.deepEqual(record.tokens, []);
});

test('saving creates one record per project and the worker env reflects it', async () => {
  const store = memoryStore();
  const svc = service(store);

  const saved = await svc.save(project.id, {
    projectKey: 'FLT',
    fields: { worker: 'customfield_1', lease: 'customfield_2', branch: 'customfield_3', pr: 'customfield_4', retry: 'customfield_5' },
    timings: { leaseStaleMs: 900000 },
    worker: { leaseRefreshMs: 300000, retryBudget: 2 },
  }, { projectKey: project.key });

  assert.equal(saved.updatedAt, NOW.toISOString());
  const stored = await store.getConfig(project.id);
  assert.equal(stored.fields.worker, 'customfield_1');
  assert.equal(stored.timings.leaseStaleMs, 900000);

  assert.match(renderWorkerEnv(stored), /FLEET_FIELD_WORKER=customfield_1/);
  assert.match(renderWorkerEnv(stored), /FLEET_LEASE_STALE_MS=900000/);
  assert.match(renderWorkerEnv(stored), /FLEET_RETRY_BUDGET=2/);
});

test('a failing save is refused with per-check detail and writes nothing', async () => {
  const store = memoryStore();
  // Every Jira call fails, so the save must be refused before it writes.
  const failingJira = {
    request: async () => {
      throw new Error('nope');
    },
  };
  const svc = createSettingsService({ store, env: {}, now: fixedNow, jira: failingJira });

  await assert.rejects(
    () => svc.save(project.id, { projectKey: 'FLT' }, { projectKey: project.key }),
    (err) => {
      assert.ok(err instanceof SettingsError);
      assert.equal(err.status, 422);
      assert.ok(Array.isArray(err.details) && err.details.length > 0);
      return true;
    },
  );
  assert.equal(await store.getConfig(project.id), null, 'a refused save must not write');
});

test('the 0 / 1 / many rule: none is null, one is that record, many names them', async () => {
  assert.equal(await resolveSoleProject({ store: memoryStore() }), null);

  const one = memoryStore({ configs: [normalizeRecord(defaultRecord({ projectId: '1', projectKey: 'FLT' }))] });
  const sole = await resolveSoleProject({ store: one });
  assert.equal(sole.projectKey, 'FLT');

  const many = memoryStore({
    configs: [
      normalizeRecord(defaultRecord({ projectId: '1', projectKey: 'FLT' })),
      normalizeRecord(defaultRecord({ projectId: '2', projectKey: 'OPS' })),
    ],
  });
  await assert.rejects(
    () => resolveSoleProject({ store: many }),
    (err) => err.status === 409 && /FLT, OPS/.test(err.message),
  );
});

test('tokens are generated, listed as metadata only, re-revealed and revoked', async () => {
  const store = memoryStore();
  const svc = service(store);
  await svc.save(project.id, { projectKey: 'FLT' }, { projectKey: project.key });

  const created = await svc.generateToken(project.id, 'alice-laptop');
  assert.equal(created.name, 'alice-laptop');
  assert.equal(created.value.length, 64, 'a generated token is 32 random bytes as hex');

  // The list is metadata only: no values anywhere in it.
  const listed = await svc.listTokens(project.id);
  assert.equal(listed.length, 1);
  assert.deepEqual(Object.keys(listed[0]).sort(), ['createdAt', 'id', 'name']);
  assert.ok(!JSON.stringify(listed).includes(created.value));

  const revealed = await svc.revealToken(project.id, created.id);
  assert.equal(revealed.value, created.value);

  const { tokens } = await svc.revokeToken(project.id, created.id);
  assert.deepEqual(tokens, []);
  await assert.rejects(() => svc.revealToken(project.id, created.id), (err) => err.status === 404);
});

test('a token cannot be added before the fleet is configured', async () => {
  const svc = service(memoryStore());
  await assert.rejects(
    () => svc.generateToken(project.id, 'early'),
    (err) => err.status === 409 && /configure the fleet/i.test(err.message),
  );
});

test('the webtrigger can resolve a bearer to the project it belongs to', async () => {
  const store = memoryStore();
  const svc = service(store);
  await svc.save(project.id, { projectKey: 'FLT' }, { projectKey: project.key });
  const token = await svc.generateToken(project.id, 'ci');
  await svc.save('20002', { projectKey: 'OPS' }, { projectKey: 'OPS' });

  const { resolveTokenProject } = await import('../src/mcp-trigger.js');
  const match = await resolveTokenProject({ store, bearer: token.value });
  assert.equal(match.projectId, project.id);

  const none = await resolveTokenProject({ store, bearer: `${token.value}-not-it` });
  assert.equal(none, null);
  assert.equal(await resolveTokenProject({ store, bearer: '' }), null);
});

test('the resolver refuses every write for a non-admin but still reads', async () => {
  const store = memoryStore();
  const svc = service(store);
  await svc.save(project.id, { projectKey: 'FLT' }, { projectKey: project.key });
  const token = await svc.generateToken(project.id, 'readable');
  const defs = resolver({ store, canEdit: false, service: svc });

  const got = await defs['fleet.settings.get'](context());
  assert.equal(got.canEdit, false);
  // Read-only everything: the same content, including the copyable .env.
  assert.match(got.workerEnv, /FLEET_PROJECT=FLT/);

  // Reads a non-admin may do: list metadata, reveal a value, run Test connection.
  const listed = await defs['fleet.settings.tokens.list'](context());
  assert.equal(listed.tokens.length, 1);
  const revealed = await defs['fleet.settings.tokens.reveal']({ ...context(), payload: { tokenId: token.id } });
  assert.equal(revealed.value, token.value);

  for (const call of ['fleet.settings.save', 'fleet.settings.tokens.generate', 'fleet.settings.tokens.add', 'fleet.settings.tokens.revoke']) {
    await assert.rejects(() => defs[call]({ ...context(), payload: {} }), (err) => err.status === 403);
  }
});

test('an admin round-trips through the resolver', async () => {
  const store = memoryStore();
  const svc = service(store);
  const defs = resolver({ store, canEdit: true, service: svc });

  const saved = await defs['fleet.settings.save']({
    ...context(),
    payload: {
      record: {
        projectKey: 'FLT',
        fields: { worker: 'customfield_1' },
        timings: { leaseStaleMs: 1234 },
        worker: { leaseRefreshMs: 5678, retryBudget: 3 },
      },
    },
  });
  assert.equal(saved.ok, true);
  assert.match(saved.workerEnv, /FLEET_LEASE_STALE_MS=1234/);

  const generated = await defs['fleet.settings.tokens.generate']({ ...context(), payload: { name: 'x' } });
  const revealed = await defs['fleet.settings.tokens.reveal']({ ...context(), payload: { tokenId: generated.id } });
  assert.equal(revealed.value, generated.value);

  const got = await defs['fleet.settings.get'](context());
  assert.equal(got.canEdit, true);
  assert.equal(got.configured, true);
  assert.equal(got.record.tokens.length, 1);
});

test('the resolver requires a project and accepts either context shape', async () => {
  assert.deepEqual(projectFromContext({ extension: { project: { id: 7, key: 'FLT' } } }), { id: '7', key: 'FLT' });
  assert.deepEqual(projectFromContext({ extension: { projectId: 7, projectKey: 'FLT' } }), { id: '7', key: 'FLT' });
  assert.throws(() => projectFromContext({ extension: {} }), /must be opened in a project/);
});

test('the generated worker env carries the heartbeat endpoint and an optional token', async () => {
  const store = memoryStore();
  const svc = service(store);
  await svc.save(project.id, { projectKey: 'FLT' }, { projectKey: project.key });
  const token = await svc.generateToken(project.id, 'worker');

  const url = 'https://example.atlassian.com/gateway/api/webtrigger/abc';
  const withoutToken = renderWorkerEnv(await store.getConfig(project.id), { heartbeatUrl: url });
  // No token chosen: the whole block is commented, so a straight copy still runs.
  assert.match(withoutToken, /^# FLEET_HEARTBEAT_URL=https:\/\/example/m);
  assert.match(withoutToken, /^# FLEET_HEARTBEAT_INTERVAL_MS=30000/m);
  assert.match(withoutToken, /^# FLEET_HEARTBEAT_TOKEN=<paste a Fleet token/m);
  assert.doesNotMatch(withoutToken, /^FLEET_HEARTBEAT_URL=/m);

  const withToken = renderWorkerEnv(await store.getConfig(project.id), {
    heartbeatUrl: url,
    heartbeatToken: token.value,
  });
  assert.match(withToken, /^FLEET_HEARTBEAT_URL=https:\/\/example/m);
  assert.match(withToken, new RegExp(`^FLEET_HEARTBEAT_TOKEN=${token.value}`, 'm'));
});

test('the resolver injects the heartbeat URL and can reveal a token into the env', async () => {
  const store = memoryStore();
  const svc = service(store);
  await svc.save(project.id, { projectKey: 'FLT' }, { projectKey: project.key });
  const token = await svc.generateToken(project.id, 'worker');
  const defs = resolver({
    store,
    service: svc,
    heartbeatUrl: async () => 'https://heartbeat.example/fleet',
  });

  const got = await defs['fleet.settings.get'](context());
  assert.equal(got.heartbeatUrl, 'https://heartbeat.example/fleet');
  assert.match(got.workerEnv, /^# FLEET_HEARTBEAT_URL=https:\/\/heartbeat\.example\/fleet/m);

  const env = await defs['fleet.settings.env']({ ...context(), payload: { tokenId: token.id } });
  assert.match(env.env, new RegExp(`FLEET_HEARTBEAT_TOKEN=${token.value}`));
});

test('the record shape and its KVS keys are fixed', () => {
  assert.equal(configKey('10001'), 'fleet:config:project:10001');
  assert.equal(tokenKey('10001', 'abcd'), 'fleet:token:10001:abcd');

  const record = normalizeRecord({ projectKey: 'FLT', fields: { worker: 'w' }, extra: 'dropped' }, { projectId: '1' });
  assert.equal(record.projectId, '1');
  assert.equal(record.fields.worker, 'w');
  assert.equal(record.fields.lease, DEFAULT_FIELDS.lease, 'missing fields fall back to the defaults');
  assert.equal(record.extra, undefined);
});

test('the protocol block is the names the fleet resolves', () => {
  assert.ok(DEFAULT_PROTOCOL.transitions.includes('Claim'));
  assert.ok(DEFAULT_PROTOCOL.statuses.includes('Ready for Build'));
  assert.equal(DEFAULT_PROTOCOL.readyLabel, 'fleet-ready');
});
