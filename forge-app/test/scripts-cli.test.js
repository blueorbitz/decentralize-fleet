import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { startJiraStub } from './helpers/jira-stub.js';

// Run the operator scripts as processes, the way a human does, against a stub
// Jira. This is the only test that would catch a script that crashes on startup,
// has a bad argv signature, or exits with the wrong code.

const root = path.resolve(import.meta.dirname, '..');

function run(script, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout, stderr });
    });
  });
}

const auth = (stub) => ['--jira', stub.url, '--email', stub.email, '--token', 'token'];

test('provision.mjs reports what it created and prints the admin checklist', async () => {
  const stub = await startJiraStub({ fieldList: [{ id: 'customfield_10101', name: 'Fleet Worker' }] });
  try {
    const { code, stdout } = await run('provision.mjs', [...auth(stub), '--project', 'FLT']);
    assert.equal(code, 0, stdout);

    // Fleet Worker already existed, so four were created.
    assert.match(stdout, /= Fleet Worker\s+customfield_10101\s+\(already exists\)/);
    assert.equal((stdout.match(/\(created\)/g) || []).length, 4);
    assert.equal(stub.state.fieldList.length, 5);

    // The checklist is the point of the script: field ids and transitions.
    assert.match(stdout, /forge variables set FLEET_FIELD_WORKER/);
    assert.match(stdout, /Ready for Build\s+->\s+Claim\s+->\s+In Build/);
    assert.match(stdout, /Failed\s+->\s+Requeue\s+->\s+Ready for Build/);
    assert.match(stdout, /verify-setup\.mjs/);
  } finally {
    await stub.close();
  }
});

test('provision.mjs --dry-run changes nothing', async () => {
  const stub = await startJiraStub({ fieldList: [] });
  try {
    const { code, stdout } = await run('provision.mjs', [...auth(stub), '--dry-run']);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /would create/);
    assert.equal(stub.state.writes.length, 0);
    assert.equal(stub.state.fieldList.length, 0);
  } finally {
    await stub.close();
  }
});

test('provision.mjs explains a missing lead instead of failing', async () => {
  const stub = await startJiraStub({});
  try {
    const { code, stdout } = await run('provision.mjs', [...auth(stub), '--project', 'FLT']);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /not created: pass --lead-account-id/);
    assert.equal(stub.state.writes.filter((w) => w.path === '/rest/api/3/project').length, 0);
  } finally {
    await stub.close();
  }
});

test('both scripts refuse to run without credentials', async () => {
  for (const script of ['provision.mjs', 'verify-setup.mjs']) {
    const { code, stderr } = await run(script, []);
    assert.equal(code, 2, `${script} should exit 2 on missing config`);
    assert.match(stderr, /missing --jira, --email and --token/);
  }
});

// A Jira API token inherits its permissions from the account that created it.
// A non-admin gets a 400 with a localised message, which is unreadable; the
// script must say what is actually wrong and whose token it is.
test('provision.mjs explains a non-admin account instead of a raw 400', async () => {
  const stub = await startJiraStub({ isAdmin: false });
  try {
    const { code, stderr } = await run('provision.mjs', [...auth(stub), '--project', 'FLT']);

    assert.equal(code, 3, 'a permission problem is its own exit code');
    assert.match(stderr, /Stub Admin \(admin@acme\.com\) cannot administer Jira/);
    assert.match(stderr, /Making a new token will not help/);
    assert.match(stderr, /Global permissions > Administer Jira/);
    // The raw, translated Jira error must not be the whole story.
    assert.doesNotMatch(stderr, /^provisioning failed:/m);
    // And nothing was written.
    assert.equal(stub.state.writes.length, 0);
  } finally {
    await stub.close();
  }
});

test('provision.mjs explains a rejected token rather than a Jira bug', async () => {
  const stub = await startJiraStub({ rejectAuth: true });
  try {
    const { code, stderr } = await run('provision.mjs', [...auth(stub), '--project', 'FLT']);

    assert.equal(code, 3);
    assert.match(stderr, /Authentication failed \(HTTP 401\)/);
    assert.match(stderr, /same account as --email/);
    assert.doesNotMatch(stderr, /^provisioning failed:/m);
  } finally {
    await stub.close();
  }
});
