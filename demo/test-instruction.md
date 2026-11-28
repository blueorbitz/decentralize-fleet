# Trying Decentralize Fleet

Six steps from a fresh Jira site to watching an AI coding agent pick up a ticket, write code, and open a pull request.

The Jira app is installed from the link. The only thing that runs on your side is the worker — one small Node process per machine.

## Before you start

| What | Why |
|---|---|
| **The app, installed** | Click the installation link on the submission page. **Settings → Apps → Manage apps** confirms it is listed |
| **A Jira Cloud site** | You need *Administer Jira* to create fields and edit workflows |
| **A Jira project** | Any company-managed project. The examples use the key `FLT` |
| **A Bitbucket Cloud account** | For the repository the agent pushes to |
| **A computer to run the worker** | Node 20+ and git. A spare laptop is fine — that is the point of the project |

Once the app is installed, the project has a **Fleet** panel on every ticket, a **Fleet** page in the project navigation, and **Fleet settings** under **Project settings → Apps**. They stay empty until step 4.

Two Jira API tokens are involved, and they are not interchangeable:

| Token | Create it from | Used for |
|---|---|---|
| **Admin token** | an account with *Administer Jira* | creating the five custom fields, once |
| **Fleet Bot token** | a normal user in your project | the worker |

A Jira API token inherits its permissions from the account that created it, so a token made by a non-admin is still a non-admin token. Create both at <https://id.atlassian.com/manage/api-tokens>.

For the Fleet Bot, use a dedicated user with **Browse projects**, **Edit issues** and **Transition issues** on this one project.

---

## Step 1 — Create the repository the fleet works on

The fleet needs a git repository it can clone, branch and push to. **Use a small test repository, not your real codebase** — the agent will be committing to it.

Create a new **empty** repository in Bitbucket, for example `fleet-test`. No README, no `.gitignore`.

Then create a tiny JavaScript project locally and push it. A repository with a working test suite makes the round trip visible, because the worker reports the test result in the pull request.

```sh
mkdir fleet-test && cd fleet-test
git init
```

**`package.json`**

```json
{
  "name": "fleet-test",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

**`usage.js`**

```js
// Usage-report helpers.

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function toCsvRow(fields) {
  return fields.map((field) => `"${String(field ?? '').replace(/"/g, '""')}"`).join(',');
}
```

**`usage.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sum, toCsvRow } from './usage.js';

test('sum adds the usage figures together', () => {
  assert.equal(sum([2, 3]), 5);
});

test('sum of an empty report is zero', () => {
  assert.equal(sum([]), 0);
});

test('toCsvRow quotes every field', () => {
  assert.equal(toCsvRow(['a', 1]), '"a","1"');
});
```

Then push it:

```sh
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@bitbucket.org:YOUR-WORKSPACE/fleet-test.git
git push -u origin main
```

Make sure `main` is the **default branch** in Bitbucket. The worker asks the remote which branch to cut from, so `master` or `develop` work too, but the repository must have a default.

You do not need to clone it anywhere for the worker — it clones into its own scratch workspace on first run.

## Step 2 — Create the five Fleet fields

The fleet tracks its own state in five custom fields. Create each under **Settings → Issues → Custom fields → Create new field**:

| Field name | Type | What it holds |
|---|---|---|
| `Fleet Worker` | **Text field (single line)** | which worker claimed the ticket |
| `Fleet Lease` | **Date time picker** | its last heartbeat; stale after 15 minutes |
| `Fleet Branch` | **Text field (single line)** | the branch the agent pushed |
| `Fleet PR` | **URL field** | the pull request, for a human to merge |
| `Fleet Retry` | **Number field** | retry budget used (0, then 1) |

Spelling matters — both the app and the worker look these fields up by name.

When you create each field, Jira asks which screens it belongs on. **Tick every screen used by your project's tickets.** A field that exists but is not on the screen is invisible to the worker and the panel, and the failure is silent.

Note down each field's id, which you need in step 4:

```sh
curl -s -u "YOU@EXAMPLE.COM:$ADMIN_TOKEN" \
  'https://YOUR-SITE.atlassian.net/rest/api/3/field' |
  jq -r '.[] | select(.name | startswith("Fleet ")) | "\(.name)\t\(.id)"'
```

```powershell
$auth = 'Basic ' + [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes("YOU@EXAMPLE.COM:$env:ADMIN_TOKEN"))

Invoke-RestMethod -Uri 'https://YOUR-SITE.atlassian.net/rest/api/3/field' `
  -Headers @{ Authorization = $auth } |
  Where-Object { $_.name -like 'Fleet *' } |
  Select-Object name, id
```

You get five lines like `Fleet Worker  customfield_10213`.

## Step 3 — Build the Fleet workflow

The fleet moves tickets through a fixed set of statuses, and **both halves find transitions by name**. This is where a typo turns into a fleet that silently does nothing.

Open **Project settings → Issues → Workflows** and edit the workflow your project uses.

**Add these statuses:**

`Backlog` · `Triaged` · `Ready for Build` · `In Build` · `In Review` · `Done` · `Failed`

**Add these transitions.** Match the names exactly, including the spaces:

| From | Transition name | To |
|---|---|---|
| Backlog | `Triage` | Triaged |
| Triaged | `Mark Ready` | Ready for Build |
| Ready for Build | `Claim` | In Build |
| In Build | `Requeue` | Ready for Build |
| In Build | `Reject` | Failed |
| In Build | `Report PR` | In Review |
| Failed | `Requeue` | Ready for Build |
| In Review | `Finish` | Done |

Two things to keep in mind:

- **`Finish` is for humans only.** It is how a person merges. Nothing automated ever calls it.
- **`Failed → Requeue` reuses the same transition name** as the requeue above, which is what lets a failed ticket be sent back by hand from the panel.

Publish the workflow.

> **Optional but recommended:** add `Fleet Worker` and `Fleet Lease` to the screen of the **Claim** transition, and `Fleet Branch` and `Fleet PR` to **Report PR**. This makes a claim a single atomic request. Without it the worker still works — it detects Jira's *"cannot be set. It is not on the appropriate screen"* response and does the two steps separately.

## Step 4 — Configure Fleet settings

Open your project → **Project settings → Apps → Fleet settings**. This page is the fleet's configuration for the project; everything else reads it.

1. Enter the **project key** — for example `FLT`.
2. Paste the five **field ids** from step 2 into the matching boxes.
3. Click **Test connection**. It checks that the fields exist, that the statuses exist, and that the `Claim` transition is reachable, naming whatever is missing.
4. Click **Save**.

Saving is validated on purpose: a missing field or an unreachable `Claim` transition **blocks the save**. Those are the two failures that would otherwise leave you with a fleet that runs and never claims anything.

Only a project administrator can change this page. Everyone else sees it read-only.

## Step 5 — Install the worker on your machine

This is the only thing you install. The worker polls Jira, claims a ticket, runs your coding agent in a git checkout, and opens a pull request. Run one per machine — a spare laptop, a build box, a desktop with a GPU.

It is plain Node with **no dependencies**, so cloning it is the whole install:

```sh
git clone <this-repository-url>
cd decentralize-workload/fleet-worker
```

The worker contains no AI of its own. It hands a ticket to whichever agent CLI is installed **on this machine** and reads the result back, so pick one with `FLEET_ADAPTER`:

| `FLEET_ADAPTER` | Harness it drives | Notes |
|---|---|---|
| `cmdc` | **Command Code** — `cmdc -p --output-format json` | the default |
| `opencode` | **OpenCode** — `opencode run --model <model> --format json --auto` | free `opencode/beam-free` model by default |
| `copilot` | **GitHub Copilot CLI** — `copilot -p` | reference implementation; check flags against your installed CLI |
| `kiro` | **Kiro CLI** | not implemented |
| `script` | no agent — a deterministic stand-in | for checking your wiring before you involve an agent |

Install the agent CLI on this machine only, and confirm it runs on its own before you point the fleet at it.

Now create a file named `.env` inside `fleet-worker`:

```ini
JIRA_URL=https://YOUR-SITE.atlassian.net
JIRA_EMAIL=bot@YOUR-DOMAIN.com        # the Fleet Bot, not the admin
JIRA_TOKEN=
JIRA_PROJECT=FLT

FLEET_REPO=/absolute/path/to/a/workspace
FLEET_REMOTE=git@bitbucket.org:YOUR-WORKSPACE/fleet-test.git
FLEET_WORKER_ID=worker-01
FLEET_ADAPTER=cmdc
```

Two things worth knowing:

- **`FLEET_REPO` is a scratch directory, not a clone you manage.** Point it at an empty folder or a path that does not exist yet, and the worker clones `FLEET_REMOTE` into it. Use an absolute path. `FLEET_REMOTE` must be pushable by this machine — that is a separate credential from the Bitbucket API token.
- **You do not type any field ids here.** The worker asks Jira for `Fleet Worker`, `Fleet Lease` and friends by name and resolves the ids itself.

The **Worker .env** action on the Fleet settings page generates this same block, prefilled with your project key and timings, if you would rather copy it.

To have the worker open real pull requests, add a Bitbucket **Repository access token** (**Repository settings → Access tokens**, with *Pull requests: write* and *Repositories: write*):

```ini
FLEET_BB_WORKSPACE=YOUR-WORKSPACE
FLEET_BB_REPO=fleet-test
FLEET_BB_APP_PASSWORD=<the access token>
```

A repository access token (`ATCT…` / `ATBB…`) is sent as `Bearer`; an app password is sent as `Basic` with a username. They are not interchangeable, and sending one as the other is a silent 401. Without any Bitbucket credentials the worker still runs, and records the pull request on the ticket as a `local://` link instead.

Start it:

```sh
node bin/fleet-run.js --check    # show what it resolved, claim nothing
node bin/fleet-run.js --loop     # keep polling
```

`--check` prints which Jira account it authenticated as, the field ids it resolved, the base branch it detected, and the command it would run. If something is wrong, the exit code says what kind: `2` missing configuration, `3` Jira rejected the credentials, `4` the Fleet fields are not on the site.

## Step 6 — File a ticket and watch it build

Leave the worker running in loop mode, then in Jira:

1. **Create a ticket.** Give it a clear summary, and put the requirements in the description under an **Acceptance Criteria** heading as a bulleted list — that list is extracted at claim time and carried into the pull request.

   Against the repository from step 1, something like:

   > **Summary:** Add a `total` helper to the usage report
   >
   > **Description:** Add `total(rows)` to `usage.js`. It should sum the `calls` field across all rows and return `0` for an empty list. Add tests for both cases.
   >
   > **Acceptance Criteria**
   > - `total(rows)` returns the sum of every row's `calls` value
   > - `total([])` returns `0`
   > - a test covers both cases

2. **Move it to Triaged**, then to **Ready for Build** — through the workflow buttons, or by opening the **Fleet** panel and clicking **Dispatch to fleet**.

3. **Watch the panel.** The worker picks it up within a poll cycle (30–60 seconds). The log shows the claim, the branch, the agent run and the push:

```
claim -> transition Ready for Build -> In Build  (CAS)
verify ok — fleet_worker=worker-01
git reset origin/main @ 4236f23a · branch FLT-12-add-a-total-helper
adapter status=ok tests=5/5
pushed · PR #1 · transition In Build -> In Review
```

4. **The ticket is now In Review**, with a branch and a pull request. Open the pull request, read the diff, and merge it yourself. The fleet never merges.

The **Fleet** panel on the ticket shows the worker holding the claim, a live lease countdown, the branch, the pull request link, the retry budget used, and the tail of the fleet's comments as a run log.

If you run a second worker on another machine, the race resolves itself: one logs `verify ok`, the other logs `lost the claim race (now "In Build") — moving on`.
