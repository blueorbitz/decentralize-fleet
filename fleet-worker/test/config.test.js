import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError, jqlFor, parseArgs } from '../src/config.js';

const baseEnv = {
  FLEET_JIRA_URL: 'https://x.atlassian.net',
  FLEET_JIRA_EMAIL: 'bot@x.com',
  FLEET_JIRA_TOKEN: 'tok',
  FLEET_REPO: '/tmp/repo',
};

test('loadConfig reads required values from env', () => {
  const cfg = loadConfig([], { ...baseEnv });
  assert.equal(cfg.jira.baseUrl, 'https://x.atlassian.net');
  assert.equal(cfg.worker.adapter, 'cmdc');
  // Left undefined on purpose: the git client asks the remote for its default
  // branch. Defaulting here is what produced "couldn't find remote ref main".
  assert.equal(cfg.repo.baseBranch, undefined);
  assert.equal(cfg.retryBudget, 1);
  assert.equal(cfg.timings.leaseStaleMs, 15 * 60_000);
});

test('a configured base branch is passed through', () => {
  const cfg = loadConfig([], { ...baseEnv, FLEET_BASE_BRANCH: 'master' });
  assert.equal(cfg.repo.baseBranch, 'master');

  const flagged = loadConfig(['--base-branch', 'develop'], { ...baseEnv });
  assert.equal(flagged.repo.baseBranch, 'develop');
});

test('flags override env', () => {
  const cfg = loadConfig(['--project', 'OPS', '--adapter', 'script'], { ...baseEnv });
  assert.equal(cfg.jira.project, 'OPS');
  assert.equal(cfg.worker.adapter, 'script');
});

test('missing required config throws ConfigError', () => {
  assert.throws(() => loadConfig([], {}), ConfigError);
});

test('jqlFor builds the documented claimable query', () => {
  const cfg = loadConfig([], { ...baseEnv });
  assert.equal(jqlFor(cfg), 'project = FLT AND status = "Ready for Build" ORDER BY priority DESC, created ASC');
});

test('parseArgs handles --k=v, boolean flags and positionals', () => {
  const a = parseArgs(['reap', '--once', '--project=OPS']);
  assert.deepEqual(a._, ['reap']);
  assert.equal(a.once, true);
  assert.equal(a.project, 'OPS');
});

test('heartbeat is disabled without a URL', () => {
  const cfg = loadConfig([], { ...baseEnv });
  assert.equal(cfg.heartbeat.url, undefined);
  assert.equal(cfg.heartbeat.intervalMs, 30_000);
  assert.ok(cfg.heartbeat.machine, 'machine name defaults to the hostname');
});

test('heartbeat reads its URL, token and interval from env', () => {
  const cfg = loadConfig([], {
    ...baseEnv,
    FLEET_HEARTBEAT_URL: 'https://heartbeat.example',
    FLEET_HEARTBEAT_TOKEN: 'fleet-token',
    FLEET_HEARTBEAT_INTERVAL_MS: '15000',
    FLEET_MACHINE: 'BUILD-BOX-2',
  });
  assert.equal(cfg.heartbeat.url, 'https://heartbeat.example');
  assert.equal(cfg.heartbeat.token, 'fleet-token');
  assert.equal(cfg.heartbeat.intervalMs, 15000);
  assert.equal(cfg.heartbeat.machine, 'BUILD-BOX-2');
});

test('the legacy MCP token can authenticate a heartbeat', () => {
  const cfg = loadConfig([], { ...baseEnv, FLEET_HEARTBEAT_URL: 'https://h', FLEET_MCP_TOKEN: 'legacy' });
  assert.equal(cfg.heartbeat.token, 'legacy');
});

test('a heartbeat URL without a token is a configuration error', () => {
  assert.throws(
    () => loadConfig([], { ...baseEnv, FLEET_HEARTBEAT_URL: 'https://h' }),
    /FLEET_HEARTBEAT_TOKEN/,
  );
});
