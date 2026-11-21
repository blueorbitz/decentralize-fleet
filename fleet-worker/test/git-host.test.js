import test from 'node:test';
import assert from 'node:assert/strict';
import { BitbucketClient, BitbucketError, LocalGitHost, createGitHost, bitbucketAuthHeader } from '../src/git-host.js';

// A fetch stand-in that records the request and replays one response.
function stubFetch(reply, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), ...init });
    const { status = 200, json = null } = typeof reply === 'function' ? reply(String(url), init) : reply;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (json == null ? '' : JSON.stringify(json)),
    };
  };
}

const prBody = {
  id: 7,
  links: { html: { href: 'https://bitbucket.org/acme/app/pull-requests/7' } },
  source: { branch: { name: 'FLT-1-do-it' } },
  destination: { branch: { name: 'main' } },
};

// The configured credential on a real tenant is usually a repository access
// token, which Bitbucket only accepts as Bearer. Sent as Basic it 401s, and that
// was the bug: every live PR write failed with no useful message.
test('an access token is sent as Bearer, an app password as Basic', () => {
  assert.equal(bitbucketAuthHeader({ appPassword: 'ATCTexample', username: 'me' }), 'Bearer ATCTexample');
  assert.equal(bitbucketAuthHeader({ appPassword: 'ATBBworkspace' }), 'Bearer ATBBworkspace');

  const basic = bitbucketAuthHeader({ username: 'me', appPassword: 'app-password' });
  assert.match(basic, /^Basic /);
  assert.equal(Buffer.from(basic.slice(6), 'base64').toString(), 'me:app-password');

  // An operator can always force the shape when the token is unusual.
  assert.equal(bitbucketAuthHeader({ username: 'me', appPassword: 'ATCTx', mode: 'basic' }).slice(0, 5), 'Basic');
  assert.equal(bitbucketAuthHeader({ appPassword: 'legacy-app-pass', mode: 'bearer' }), 'Bearer legacy-app-pass');
});

test('a missing credential says what to set rather than sending an empty header', () => {
  assert.throws(
    () => bitbucketAuthHeader({ username: 'me', appPassword: '' }),
    /FLEET_BB_APP_PASSWORD/,
  );
  assert.throws(() => bitbucketAuthHeader({ appPassword: 'app-password' }), /FLEET_BB_USERNAME/);
});

test('createPullRequest posts the documented Bitbucket v2 payload with the Bearer header', async () => {
  const calls = [];
  const client = new BitbucketClient({
    workspace: 'acme',
    repoSlug: 'app',
    username: 'me',
    appPassword: 'ATCTexample',
    fetchImpl: stubFetch({ json: prBody }, calls),
  });

  const pr = await client.createPullRequest({
    title: 'FLT-1: Do it',
    description: 'body',
    sourceBranch: 'FLT-1-do-it',
    destinationBranch: 'main',
  });

  assert.equal(pr.id, 7);
  assert.equal(pr.url, 'https://bitbucket.org/acme/app/pull-requests/7');
  assert.equal(pr.reused, false);

  // One lookup first (reuse-existing), then the POST.
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'expected a POST');
  assert.equal(post.headers.Authorization, 'Bearer ATCTexample');
  assert.equal(
    post.url,
    'https://api.bitbucket.org/2.0/repositories/acme/app/pullrequests',
  );
  const body = JSON.parse(post.body);
  assert.equal(body.title, 'FLT-1: Do it');
  assert.equal(body.source.branch.name, 'FLT-1-do-it');
  assert.equal(body.destination.branch.name, 'main');
});

// A run can be retried (the retry budget requeues once). Bitbucket answers a
// duplicate POST with 409, so the worker must reuse the open PR instead of
// turning a good run into a failure.
test('an already-open PR for the branch is reused instead of duplicated', async () => {
  const calls = [];
  const client = new BitbucketClient({
    workspace: 'acme',
    repoSlug: 'app',
    appPassword: 'ATCTexample',
    fetchImpl: stubFetch({ json: { values: [prBody] } }, calls),
  });

  const pr = await client.createPullRequest({
    title: 'FLT-1: Do it',
    description: 'body',
    sourceBranch: 'FLT-1-do-it',
    destinationBranch: 'main',
  });

  assert.equal(pr.id, 7);
  assert.equal(pr.reused, true);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'must not POST over an open PR');
});

test('a 409 with no matching lookup still re-checks before failing', async () => {
  const calls = [];
  const client = new BitbucketClient({
    workspace: 'acme',
    repoSlug: 'app',
    appPassword: 'ATCTexample',
    fetchImpl: stubFetch((url, init) => {
      if (init.method === 'POST') return { status: 409, json: { error: { message: 'exists' } } };
      return { status: 200, json: { values: [prBody] } };
    }, calls),
  });

  const pr = await client.createPullRequest({
    title: 't',
    description: 'd',
    sourceBranch: 'FLT-1-do-it',
    destinationBranch: 'main',
  });
  assert.equal(pr.reused, true);
});

test('a 401 names the credential shape and how to change it', async () => {
  const client = new BitbucketClient({
    workspace: 'acme',
    repoSlug: 'app',
    appPassword: 'ATCTexample',
    fetchImpl: stubFetch({ status: 401, json: { error: { message: 'Unauthorized' } } }),
  });

  await assert.rejects(
    () => client.createPullRequest({ title: 't', description: 'd', sourceBranch: 'b', destinationBranch: 'main' }),
    (err) => {
      assert.ok(err instanceof BitbucketError);
      assert.equal(err.status, 401);
      assert.match(err.message, /Bearer access token/);
      assert.match(err.message, /FLEET_BB_AUTH/);
      return true;
    },
  );
});

test('createGitHost builds a Bitbucket host from config and a local one on request', async () => {
  const host = createGitHost({ kind: 'bitbucket', workspace: 'acme', repoSlug: 'app', appPassword: 'ATCTx', authMode: 'auto' });
  assert.ok(host instanceof BitbucketClient);
  assert.equal(host.auth, 'Bearer ATCTx');

  const local = createGitHost({ kind: 'local' });
  assert.ok(local instanceof LocalGitHost);
  const pr = await local.createPullRequest({ title: 't', description: 'd', sourceBranch: 'b', destinationBranch: 'main' });
  assert.equal(pr.url, 'local://pull-requests/1');
});

test('an incomplete Bitbucket config fails loudly instead of half-working', () => {
  assert.throws(() => new BitbucketClient({ workspace: 'acme' }), /FLEET_BB_REPO/);
});
