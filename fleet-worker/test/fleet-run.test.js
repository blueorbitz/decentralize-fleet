import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { MockJira } from './helpers/mock-jira.js';
import { makeGitWorkspace } from './helpers/git-fixture.js';

// `bin/fleet-run.js` exists so an operator does not have to type five
// customfield ids. It resolves them from Jira, reads .env, and then hands argv
// to the normal CLI — so these tests assert the behaviour a person cares about:
// it finds the fields, it refuses when they are missing, and it actually runs.

const root = path.resolve(import.meta.dirname, '..');

function runFleetRun(args, { env = {}, cwd = root } = {}) {
  // These runs are meant to be fully offline. An operator's real FLEET_BB_* (or
  // FLEET_GIT_HOST) in the ambient environment made the wrapper resolve the real
  // Bitbucket host, so a run with no changes then failed against the live API
  // instead of the local host. Drop them unless a test sets them itself.
  const ambient = { ...process.env };
  for (const key of Object.keys(ambient)) {
    if (/^(FLEET_BB_|BITBUCKET_)/.test(key) || key === 'FLEET_GIT_HOST') delete ambient[key];
  }
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(root, 'bin', 'fleet-run.js'), ...args],
      // FLEET_NO_ENV keeps a developer's real .env out of these runs. Tests that
      // are about .env handling opt back in explicitly.
      { cwd, env: { ...ambient, FLEET_NO_ENV: '1', ...env } },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }),
    );
  });
}

async function withMock(fn) {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  try {
    return await fn({ mock, baseUrl });
  } finally {
    await mock.stop();
  }
}

test('resolves field ids from Jira and reports them, without a field flag', async () => {
  await withMock(async ({ mock, baseUrl }) => {
    mock.addTicket({ key: 'FLT-201', status: 'Ready for Build' });
    const { code, stdout } = await runFleetRun(['--check'], {
      env: {
        JIRA_URL: baseUrl,
        JIRA_EMAIL: 'bot@demo',
        JIRA_TOKEN: 't',
        JIRA_PROJECT: 'FLT',
        FLEET_REPO: 'C:/tmp/whatever',
        FLEET_ADAPTER: 'script',
      },
    });

    assert.equal(code, 0, stdout);
    // It names the fields it found...
    assert.match(stdout, /Fleet Worker\s+customfield_10001/);
    assert.match(stdout, /Fleet Lease\s+customfield_10002/);
    assert.match(stdout, /Fleet Retry\s+customfield_10005/);
    // ...and shows the command it would run, with the ids filled in.
    assert.match(stdout, /--field-worker customfield_10001/);
    // --check must not run anything.
    assert.match(stdout, /Would run:/);
    assert.equal(mock.transitionLog.length, 0);
  });
});

test('secrets are redacted in the printed command', async () => {
  await withMock(async ({ baseUrl }) => {
    const { stdout } = await runFleetRun(['--check'], {
      env: { JIRA_URL: baseUrl, JIRA_EMAIL: 'bot@demo', JIRA_TOKEN: 'super-secret-token' },
    });
    assert.doesNotMatch(stdout, /super-secret-token/);
    assert.match(stdout, /--token \*\*\*\*/);
  });
});

test('reads credentials from a .env file, not just the environment', async () => {
  await withMock(async ({ mock, baseUrl }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-dotenv-'));
    fs.writeFileSync(
      path.join(dir, '.env'),
      [
        '# fleet settings',
        `JIRA_URL="${baseUrl}"`,
        'JIRA_EMAIL=bot@demo',
        'JIRA_TOKEN=from-dotenv',
        'JIRA_PROJECT=FLT',
        'FLEET_ADAPTER=script',
        '',
      ].join('\n'),
    );
    try {
      mock.addTicket({ key: 'FLT-202', status: 'Ready for Build' });
      const { code, stdout } = await runFleetRun(['--check'], {
        cwd: dir,
        env: {
          FLEET_NO_ENV: '0',
          JIRA_URL: '',
          JIRA_EMAIL: '',
          JIRA_TOKEN: '',
          JIRA_PROJECT: '',
          FLEET_ADAPTER: '',
        },
      });

      assert.equal(code, 0, stdout);
      assert.match(stdout, /\.env/);
      assert.match(stdout, /Fleet Worker\s+customfield_10001/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('names the missing fields when provisioning was incomplete', async () => {
  // A tenant where provisioning stopped after the first field.
  const mock = new MockJira({
    fieldList: [{ id: 'customfield_10001', name: 'Fleet Worker' }],
  });
  const baseUrl = await mock.start();
  try {
    const { code, stderr } = await runFleetRun(['--check'], {
      env: { JIRA_URL: baseUrl, JIRA_EMAIL: 'bot@demo', JIRA_TOKEN: 't' },
    });
    assert.equal(code, 4, stderr);
    assert.match(stderr, /Fleet Lease/);
    assert.match(stderr, /provision\.mjs/);
  } finally {
    await mock.stop();
  }
});

test('refuses to start without credentials, and says what to set', async () => {
  const { code, stderr } = await runFleetRun([], {
    env: { JIRA_URL: '', JIRA_EMAIL: '', JIRA_TOKEN: '', FLEET_JIRA_URL: '', FLEET_JIRA_EMAIL: '', FLEET_JIRA_TOKEN: '' },
    cwd: os.tmpdir(),
  });
  assert.equal(code, 2);
  assert.match(stderr, /Missing required configuration/);
  assert.match(stderr, /JIRA_URL/);
  assert.match(stderr, /JIRA_TOKEN/);
});

test('explains a rejected token rather than printing a stack trace', async () => {
  const mock = new MockJira({ rejectAuth: true });
  const baseUrl = await mock.start();
  try {
    const { code, stderr } = await runFleetRun(['--check'], {
      env: { JIRA_URL: baseUrl, JIRA_EMAIL: 'bot@demo', JIRA_TOKEN: 'bad' },
    });
    assert.equal(code, 3, stderr);
    assert.match(stderr, /HTTP 401/i);
    assert.match(stderr, /same account/i);
  } finally {
    await mock.stop();
  }
});

test('a real poll cycle runs end to end through the wrapper', async () => {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  const ws = makeGitWorkspace();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-runner-'));
  const saved = { ...process.env };
  try {
    mock.addTicket({
      key: 'FLT-203',
      summary: 'Wrapper runs a real poll',
      status: 'Ready for Build',
      description: 'Do it.\n\nAcceptance criteria\n- the wrapper works',
    });

    const { code, stdout } = await runFleetRun([], {
      env: {
        JIRA_URL: baseUrl,
        JIRA_EMAIL: 'bot@demo',
        JIRA_TOKEN: 't',
        JIRA_PROJECT: 'FLT',
        FLEET_REPO: ws.workspace,
        FLEET_ADAPTER: 'script',
        FLEET_WORKER_ID: 'worker-wrapper',
        FLEET_LOG: path.join(tmp, 'run.log'),
        FLEET_SCRIPT_FILE: 'FLEET_OUTPUT.md',
        FLEET_SCRIPT_CONTENT: 'done\n',
      },
    });

    assert.equal(code, 0, stdout);
    const ticket = mock.plain('FLT-203');
    assert.equal(ticket.status, 'In Review', `status was ${ticket.status}; output:\n${stdout}`);
    assert.equal(ticket.worker, 'worker-wrapper');
    assert.ok(ticket.branch.startsWith('FLT-203-'));
  } finally {
    Object.keys(process.env).forEach((k) => {
      if (!(k in saved)) delete process.env[k];
    });
    await mock.stop();
    ws.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// A value in .env must reach the harness, which is a child process reading
// process.env. If the wrapper resolves config from .env but does not export it,
// the adapter silently does nothing and the run requeues.
test('.env values reach the adapter subprocess, not just the wrapper', async () => {
  const mock = new MockJira();
  const baseUrl = await mock.start();
  const ws = makeGitWorkspace();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-envexport-'));
  try {
    fs.writeFileSync(
      path.join(work, '.env'),
      [
        `JIRA_URL=${baseUrl}`,
        'JIRA_EMAIL=bot@demo',
        'JIRA_TOKEN=t',
        'JIRA_PROJECT=FLT',
        `FLEET_REPO=${ws.workspace}`,
        'FLEET_ADAPTER=script',
        'FLEET_SCRIPT_FILE=FLEET_OUTPUT.md',
        'FLEET_SCRIPT_CONTENT=done-by-env',
      ].join('\n'),
    );
    mock.addTicket({ key: 'FLT-204', summary: 'Env reaches the harness', status: 'Ready for Build' });

    const { code, stdout } = await runFleetRun([], {
      cwd: work,
      env: {
        FLEET_NO_ENV: '0',
        JIRA_URL: '',
        JIRA_EMAIL: '',
        JIRA_TOKEN: '',
        JIRA_PROJECT: '',
        FLEET_REPO: '',
        FLEET_ADAPTER: '',
        FLEET_SCRIPT_FILE: '',
        FLEET_SCRIPT_CONTENT: '',
      },
    });

    assert.equal(code, 0, stdout);
    assert.equal(mock.plain('FLT-204').status, 'In Review', `output:\n${stdout}`);
    assert.ok(fs.existsSync(path.join(ws.workspace, 'FLEET_OUTPUT.md')));
  } finally {
    await mock.stop();
    ws.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('the launchers exist and point at the wrapper', () => {
  for (const name of ['fleet-run.bat', 'fleet-run.ps1']) {
    const file = path.join(root, name);
    assert.ok(fs.existsSync(file), `${name} is missing`);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /fleet-run\.js/, `${name} does not invoke bin/fleet-run.js`);
    // cmd.exe mangles non-ASCII in REM lines; keep launchers ASCII.
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x00-\x7F]/.test(text), `${name} contains non-ASCII characters, which cmd.exe mishandles`);
  }
});

// There is one .env for the repo, at its root. Running the launcher from
// fleet-worker/ (or from anywhere else) must still find it.
test('a .env at the repo root is found from the worker directory', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-rootenv-'));
  const workerDir = path.join(repo, 'fleet-worker');
  fs.mkdirSync(workerDir, { recursive: true });
  // A mirror just big enough for the launcher to run.
  fs.mkdirSync(path.join(workerDir, 'bin'));
  fs.copyFileSync(path.join(root, 'bin', 'fleet-run.js'), path.join(workerDir, 'bin', 'fleet-run.js'));
  fs.cpSync(path.join(root, 'src'), path.join(workerDir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(workerDir, 'package.json'));

  await withMock(async ({ baseUrl }) => {
    // The .env lives at the REPO root, one level above the worker.
    fs.writeFileSync(
      path.join(repo, '.env'),
      [`JIRA_URL=${baseUrl}`, 'JIRA_EMAIL=bot@demo', 'JIRA_TOKEN=t', 'JIRA_PROJECT=FLT'].join('\n'),
    );
    try {
      const { code, stdout } = await new Promise((resolve) => {
        execFile(
          process.execPath,
          [path.join(workerDir, 'bin', 'fleet-run.js'), '--check'],
          {
            cwd: workerDir,
            env: { ...process.env, FLEET_NO_ENV: '0', JIRA_URL: '', JIRA_EMAIL: '', JIRA_TOKEN: '', JIRA_PROJECT: '' },
          },
          (err, out, errOut) => resolve({ code: err?.code ?? 0, stdout: out + errOut }),
        );
      });

      assert.equal(code, 0, stdout);
      assert.match(stdout, /Config: .*\.env/, 'the root .env should have been found');
      assert.match(stdout, /Fleet Worker\s+customfield_10001/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

test('the repo ships a .env.example covering every setting', () => {
  const example = fs.readFileSync(path.join(root, '..', '.env.example'), 'utf8');
  // The settings a first run cannot work without.
  for (const key of ['JIRA_URL', 'JIRA_EMAIL', 'JIRA_TOKEN', 'FLEET_REPO']) {
    assert.match(example, new RegExp(`^${key}=`, 'm'), `.env.example is missing ${key}`);
  }
  // And the ones that are easy to forget exist.
  for (const key of ['JIRA_ADMIN_TOKEN', 'FLEET_ADAPTER', 'FLEET_REMOTE', 'FLEET_BASE_BRANCH']) {
    assert.match(example, new RegExp(`^#?\\s*${key}=`, 'm'), `.env.example is missing ${key}`);
  }
});
