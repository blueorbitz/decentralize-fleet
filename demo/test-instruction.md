# Testing instructions for judges

There are three levels. **Levels 1 and 2 need no Atlassian account, no Forge login and no network** — start there, because they prove the whole protocol. Level 3 is the full Jira tenant install.

Everything below runs from the repo root unless a step says otherwise.

Prerequisites: **Node 20+** and **git**. Level 3 additionally needs the **Forge CLI** (`npm i -g @forge/cli`) and a **Jira Cloud site where you can administer Jira**.

> **No credentials are shipped with this project.** Every token below is one you create for your own account — this is deliberate, since the design's whole trust model is least-privilege, per-project credentials. Nothing in the repo contains a secret.

## Level 1 — the worker, offline (~15 seconds)

```sh
cd fleet-worker
npm test          # expect: pass 77, fail 0
npm run demo      # the whole loop: happy path, crash/reaper, retry budget
```

`npm test` runs the real worker against an in-process Jira mock with real transition-precondition semantics and a throwaway git repo — claim races, the retry path and the reaper are genuinely exercised, not stubbed.

`npm run demo` prints the board before and after each of three phases:

| Phase | What you should see |
|---|---|
| 1 — happy path | `FLT-101` goes `Ready for Build` → `In Review`, with a branch and a PR |
| 2 — crash | a worker claims, dies; its lease goes stale; the reaper requeues it and comments |
| 3 — failure | the harness fails; the retry budget (1/1) is spent and it requeues; a second failure moves it to `Failed` |

If those three phases make sense, you understand the protocol.

## Level 2 — the Forge app, offline (~5 seconds)

```sh
cd forge-app
npm install       # first time only
npm test          # expect: pass 153, fail 0
```

This runs the real client, reaper, MCP server, settings service and resolver functions against an in-process Jira mock, with the settings store swapped for an in-memory double. No Forge login, no network.

Four of these tests exist purely as **drift guards**, and they are the ones worth looking at: `contract.test.js` fails if the app and the worker disagree on a status, transition, field or lease timing; `manifest.test.js` fails if the manifest wires a handler that isn't exported; `panel-styles.test.js` fails if a component renders a class the stylesheet doesn't style; `packaging.test.js` fails if the known npm packaging traps come back.

To see the panel UI actually build:

```sh
cd forge-app
npm run build:ui
```

**Checkpoint:** `src/static/issue-panel/dist/index.html` exists, and the compiled CSS in `dist/assets/` contains `fleet-root` (a build can succeed while shipping no styles, which is the failure you can't see by eye).

## Level 2b — a real claim race, through the real CLI (~2 minutes, no Jira account)

This is the demo's core claim, reproducible offline. You need two terminals.

**Terminal 1** — start an offline fleet:

```sh
cd fleet-worker
npm run mock:fleet
```

It prints a mock Jira URL, a scratch git repo path, and a ready-to-paste `node bin/fleet-worker.js run ...` command. It reprints the four-ticket board whenever anything changes.

**Terminal 2** — paste that command. It looks like this (the URL and path come from Terminal 1 — use those, not these):

```sh
node bin/fleet-worker.js run --once --verbose \
  --jira <MOCK_JIRA_URL> --email bot@demo --token demo --project FLT \
  --repo "<MOCK_REPO>" --git-host local --worker-id worker-cli \
  --adapter script --field-worker "Fleet Worker" --field-lease "Fleet Lease" \
  --field-branch "Fleet Branch" --field-pr "Fleet PR" --field-retry "Fleet Retry"
```

Run it again with `--worker-id worker-cli-2` while the first still holds a ticket, and you get the race: one worker logs `verify ok — fleet_worker=…`, the other logs `lost the claim race (now "In Build") — moving on`.

A run that ends in `failure (harness produced no file changes) -> requeue (retry 1/1)` is **correct behaviour, not a bug**: the `script` adapter deliberately does no work unless you tell it what to write. To make it finish:

```powershell
$env:FLEET_SCRIPT_FILE = 'FLEET_OUTPUT.md'
$env:FLEET_SCRIPT_CONTENT = '# done by the fleet'
```

(Rebash: `export FLEET_SCRIPT_FILE=... FLEET_SCRIPT_CONTENT=...`.) Clear them when done.

**Checkpoint:** a ticket reaches `In Review` through the real CLI, with a branch and a PR recorded.

## Level 3 — the full install on a Jira tenant (30–45 minutes)

You need **two Jira API tokens**, and confusing them is the single most common failure:

| Token | Whose account | Used for |
|---|---|---|
| **Admin token** | an account with *Administer Jira* | creating the custom fields and the project, once |
| **Fleet Bot token** | a normal user in the project | the worker and the operator scripts |

A Jira API token **inherits its permissions from the account that created it**. A fresh token from a non-admin account is still non-admin.

### 3.1 Confirm your account is actually a Jira administrator

Do this first — it takes two seconds and saves a confusing failure later:

```powershell
$pair = "YOU@EXAMPLE.COM:$env:JIRA_ADMIN_TOKEN"
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))

Invoke-RestMethod -Uri 'https://YOUR-SITE.atlassian.net/rest/api/3/mypermissions?permissions=ADMINISTER' `
  -Headers @{ Authorization = $auth } |
  Select-Object -ExpandProperty permissions |
  Select-Object -ExpandProperty ADMINISTER
```

`havePermission : True` means you're a Jira admin. If it's `False`, no amount of recreating the token will help — an admin has to grant your account *Administer Jira* under **Settings → System → Global permissions** (or **Administration → Global permissions** on newer sites).

### 3.2 Register, build, deploy the Forge app

```sh
cd forge-app
npm install
npm run build:ui
forge register fleet-app     # writes your real app id into manifest.yml
forge deploy
forge install
```

Use `forge register`, not `forge create` — the latter scaffolds from a template and would overwrite the manifest.

If `forge deploy` prints *"We've detected new scopes or egress URLs"* and exits non-zero, that is **not a failure**: a dynamic webtrigger counts as egress. Run `forge install --upgrade --site YOUR-SITE.atlassian.net --product Jira`.

### 3.3 Provision the Jira side

Uses the **admin** token. Add `--dry-run` first if you want to see the plan without writing.

```sh
node scripts/provision.mjs \
  --jira https://YOUR-SITE.atlassian.net \
  --email YOU@EXAMPLE.COM \
  --token $env:JIRA_ADMIN_TOKEN \
  --project FLT \
  --lead-account-id <your-accountId>
```

To find your account id: `GET /rest/api/3/myself` → `accountId`.

This creates the five `Fleet *` custom fields and the `FLT` Kanban project (idempotent — existing fields are left alone), then prints the checklist of what it cannot do. It exits `3` if your account lacks *Administer Jira*, which is a permissions problem, not a bug.

### 3.4 The two steps only an admin UI can do

The REST API cannot attach fields to a screen or author a workflow. **Skipping these is the most common reason the fleet silently does nothing.**

**a) Attach the five fields to the project's screen.** Jira settings → Issues → Screens → the screen used by `FLT` → add `Fleet Worker`, `Fleet Lease`, `Fleet Branch`, `Fleet PR`, `Fleet Retry`.

**b) Author the workflow with these exact transition names.** Both the worker and the app resolve transitions *by name*, so a typo is a silent failure.

| From | Transition | To |
|---|---|---|
| Backlog | Triage | Triaged |
| Triaged | Mark Ready | Ready for Build |
| Ready for Build | Claim | In Build |
| In Build | Requeue | Ready for Build |
| In Build | Reject | Failed |
| In Build | Report PR | In Review |
| Failed | Requeue | Ready for Build |
| In Review | Finish | Done |

`Finish` is human-only. `Failed → Requeue` reuses the same transition name, so a failed run can be requeued from the panel.

**Recommended, not required:** add `Fleet Worker` + `Fleet Lease` to the **Claim** transition screen (and `Fleet Branch` + `Fleet PR` to **Report PR**). This makes the claim a single atomic request. Without it, the worker detects Jira's *"cannot be set. It is not on the appropriate screen"* response and falls back to transition-then-update automatically.

### 3.5 Configure the app — Project settings → Fleet settings

The app holds **no** Jira API token; it calls Jira through `api.asApp()`, and Forge mints an installation token from the manifest scopes. What it does need is the field ids:

1. Open your project → **Project settings → Apps → Fleet settings**.
2. Enter the project key and the five `customfield_XXXXX` ids the provisioning script printed.
3. Click **Test connection**, then **Save**.

That page is the source of truth (one record per project in Forge KVS). **A missing field or a missing `Ready for Build → Claim` transition blocks the save** — those are the two silent ways to break the fleet, and they now fail where an admin can see them. Only a project administrator (`ADMINISTER_PROJECTS`) can write; everyone else gets a read-only page, because Forge does not gate `jira:projectSettingsPage` itself.

### 3.6 Prove the tenant is wired — do not skip this

```sh
node scripts/verify-setup.mjs \
  --jira https://YOUR-SITE.atlassian.net \
  --email bot@EXAMPLE.COM \
  --token $env:FLEET_JIRA_TOKEN \
  --project FLT
```

Expect `ok` for the five fields, the project, each status and the `Claim` transition, ending with `Ready.`

### 3.7 Run a worker

There is **one `.env` for the whole repo, at its root** — the worker reads it, the Forge app cannot (it runs in Atlassian's cloud). Copy the example and fill in the four that matter:

```powershell
Copy-Item .env.example .env
```

```ini
JIRA_URL=https://YOUR-SITE.atlassian.net
JIRA_EMAIL=bot@EXAMPLE.COM          # the Fleet Bot, not the admin
JIRA_TOKEN=
FLEET_REPO=C:\Users\you\.fleet\worker-01\app
```

Then, from `fleet-worker`:

```sh
cd fleet-worker
./fleet-run.ps1 --check    # resolve .env + field ids + base branch, run nothing
./fleet-run.ps1            # one poll cycle, then exit
./fleet-run.ps1 --loop     # daemon (Ctrl-C to stop)
```

`fleet-run.bat` is identical for cmd; both wrap `bin/fleet-run.js`. The wrapper logs which account it runs as, resolves the field ids from Jira, and detects the repo's default branch — so you never type a `customfield_` id.

**For a first run, set `FLEET_ADAPTER=script` in `.env`** — it takes the whole protocol through to a PR without any coding agent installed. Switch to `cmdc` or `opencode` afterwards.

Exit codes are deliberate: `0` ran/passed, `2` missing configuration, `3` Jira rejected the credentials, `4` the Fleet fields don't exist.

### 3.8 The full loop

1. Create an issue in `FLT`, move it to **Triaged**.
2. Open the **Fleet** panel → **Dispatch to fleet**. It moves to `Ready for Build` and deliberately stays *unclaimed* — the panel never claims on a worker's behalf.
3. Start a worker. Within 30–60 seconds it claims the ticket, runs the harness, pushes a branch, opens a PR and moves the ticket to `In Review`. The **Fleet** panel shows the worker, a live lease countdown, the branch, the PR link and the run log.

### 3.9 Optional — test the self-heal

Kill the worker mid-run with **Ctrl-C**. After 15 minutes the scheduled reaper transitions the ticket back to `Ready for Build` and leaves a comment. To see the same transition immediately, use **Abort & requeue** in the panel.

### 3.10 Optional — the MCP endpoint

```sh
forge webtrigger create     # choose fleet-mcp
```

Get a token from **Fleet settings → MCP tokens → Generate token**, then:

```sh
curl -X POST '<the webtrigger url>' \
  -H "Authorization: Bearer <your-project-token>" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fleet_status","arguments":{}}}'
```

Expect a JSON-RPC result containing `active`, `queued`, `failed`. `401` means the bearer isn't a token this installation knows; `503` means no project has been configured on the settings page yet.

## What to look at in the panel

Open any `FLT` issue and read the **Fleet** panel. It is read-mostly by design: two writes, both of which you could do by hand in Jira.

| Field | Should show |
|---|---|
| Header | `Fleet`, a status pill, the issue key |
| Worker | the worker id holding the claim, or `—` |
| Lease | a live countdown (`13:12 left of 15m`), or `expired` |
| Branch / Pull request | `FLT-123-some-slug`, and `pull request #42` as a link |
| Retry budget | `0 used`, then `1 used` after a failure |
| Run log | the tail of the fleet's comments on the ticket |
| Buttons | **Dispatch to fleet** when Triaged/Ready; **Abort & requeue** when In Build |

Things that should **not** happen, and are the claims worth testing: the panel never claims a ticket, the panel never runs or merges anything, and the reaper does nothing unless a ticket is already `In Build`.

## Fastest path if you only have five minutes

```sh
cd fleet-worker && npm test && npm run demo
cd ../forge-app && npm install && npm test
```

That exercises the claim-as-CAS race, the lease reaper, the retry budget, the MCP tools and the settings rules with **no account, no network and no Forge login**. Level 3 is the real install, and `TESTING.md` at the repo root is the long-form version of every step above, including a troubleshooting table keyed by symptom.

## Known gaps, stated plainly

So you know what you're looking at:

- **Nothing is deployed.** The Forge app is verified locally; `forge register` / `forge deploy` / `forge install` are your steps (3.2). Level 3 has not been run against a live tenant by us.
- **The `copilot` adapter is a reference implementation** and `kiro` is a stub — the live, tested harnesses are `cmdc` and `opencode`.
- **The Rovo modules (`rovo:agent`, `rovo:action`, `rovo:skill`) are not declared in the manifest.** They require Rovo entitlement on the tenant and would make a plain `forge deploy` fail, so they're listed under *What's next*.
- **The Fleet settings page compiles and lints clean but has not been rendered in a live Jira** — its store, service, resolver, permission gate and view model are all covered offline.
- **Sandboxing is demo-level**: a dedicated workspace, a filtered environment for the agent, and a human reading every PR. No containers.
