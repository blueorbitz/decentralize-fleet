# Testing the fleet — step by step

A walkthrough you can follow top to bottom. Levels 1-4 need **no Atlassian
account and no network**. Level 5 needs a Jira Cloud tenant and an admin.

Run everything from the repo root unless a step says otherwise:

```
decentralize-workload\
```

There are two halves: `fleet-worker\` (the daemon that claims tickets and builds
them) and `forge-app\` (the Jira panel, the lease reaper, the MCP endpoint).

---

## Contents

1. [Level 1 — the worker alone](#level-1--the-worker-alone)
2. [Level 2 — the Forge app alone](#level-2--the-forge-app-alone)
3. [Level 3 — build the panel UI](#level-3--build-the-panel-ui)
4. [Level 4 — drive the real worker CLI offline](#level-4--drive-the-real-worker-cli-offline)
5. [Level 5 — the real thing (Jira tenant)](#level-5--the-real-thing-jira-tenant)
6. [What to check in the panel](#what-to-check-in-the-panel)
7. [Troubleshooting](#troubleshooting)

---

## Level 1 — the worker alone

**Time:** ~10 seconds. **Needs:** Node 20+ and git.

### 1.1 Unit and integration tests

```powershell
cd fleet-worker
npm test
```

**You should see:** `# pass 35` and `# fail 0`.

These run the real worker against an in-process Jira mock that enforces real
transition rules, plus a throwaway git repo. Claim races, the retry path and the
reaper are genuinely exercised, not stubbed.

### 1.2 Watch the whole loop

```powershell
npm run demo
```

**You should see:** three phases, each printing the board before and after.

| Phase | What happens |
|---|---|
| 1 — happy path | FLT-101 goes `Ready for Build` -> `In Review`, with a branch and a PR |
| 2 — crash | a worker claims, dies; its lease goes stale; the reaper requeues it and comments |
| 3 — failure | the harness fails; retry budget 1/1 is spent and it requeues; a second failure moves it to `Failed` |

This is the fastest way to understand the protocol. If those three phases make
sense, everything below is variation on them.

**Checkpoint:** you have seen `Demo complete.`

---

## Level 2 — the Forge app alone

**Time:** ~5 seconds. **Needs:** Node 20+.

```powershell
cd ..\forge-app
npm install          # first time only
npm test
```

**You should see:** `# pass 72` and `# fail 0`.

What these cover, so you know what you are trusting:

| Test file | Covers |
|---|---|
| `jira.test.js` | claim-as-CAS, losing a claim race, dispatch, requeue, report |
| `reaper.test.js` | stale-lease detection and the self-heal |
| `mcp.test.js`, `mcp-http.test.js` | the five MCP tools, over real HTTP |
| `backend.test.js` | the three resolver functions the panel actually calls |
| `panel-model.test.js`, `panel-display.test.js` | what the panel renders |
| `scripts.test.js`, `scripts-cli.test.js` | the provisioning scripts, run as real processes |
| `contract.test.js` | **fails if the worker and this app disagree on a status, transition, field or timing** |
| `manifest.test.js` | **fails if the manifest wires a handler that is not exported** |
| `panel-styles.test.js` | **fails if a component renders a class the stylesheet does not style** |
| `packaging.test.js` | **fails if the known npm packaging traps come back** |

The four bold ones are the drift guards. They exist because these bugs are silent
otherwise — the app deploys fine and then does nothing.

**Checkpoint:** `# pass 72`.

---

## Level 3 — build the panel UI

**Time:** ~20-30 seconds on a clean tree. **Needs:** Node 20+.

```powershell
cd ..
npm run build:ui
```

**You should see:** `built in ...` and a `dist` folder created.

Verify it actually produced the panel — a build can succeed while shipping no
styles, which is the failure mode you cannot see:

```powershell
Test-Path src\static\issue-panel\dist\index.html
Get-ChildItem src\static\issue-panel\dist\assets\*.css | Select-Object Name, Length
```

**You should see:** `True`, and a CSS file of roughly 60-70 KB.

Confirm your panel classes are in the compiled CSS:

```powershell
Select-String -Path src\static\issue-panel\dist\assets\*.css -Pattern "fleet-root|fleet-pill--warning"
```

**You should see:** a match. If not, the build did not include your stylesheet.

**Checkpoint:** `index.html` exists and the CSS contains `fleet-root`.

> Do not use `npm --prefix` for this. It resolves the wrong package as the
> project and installs the Forge app into the panel as a recursive dependency.
> The script uses `cd` for exactly this reason.

---

## Level 4 — drive the real worker CLI offline

**Time:** ~2 minutes. **Needs:** Node 20+, git. **No Jira account.**

This is the level most people skip, and it is the one that proves the shipped
command line actually works — argv parsing, HTTP client, git, the adapter
subprocess — rather than just the library code the tests call.

### 4.1 Start an offline fleet

Open a **new PowerShell window** (you will need two):

```powershell
cd fleet-worker
npm run mock:fleet
```

**You should see:** an offline Jira URL, a scratch git repo path, and a board of
four seeded tickets. It prints the exact command to copy, already filled in with
the right URL and path.

Leave this window running. It reprints the board whenever anything changes.

### 4.2 Run the worker against it

In your **second** window, copy the `node bin/fleet-worker.js run ...` command
from the first window, and run it.

**You should see** a log like this:

```
claim -> transition Ready for Build -> In Build  (CAS)
verify ok — fleet_worker=worker-cli
git reset origin/main @ 4236f23a · branch FLT-101-add-csv-export-to-the-usage-report
adapter status=ok tests=1/1
pushed FLT-101-add-csv-export-to-the-usage-report · PR local://pull-requests/1 · transition In Build -> In Review
```

And in the **first** window, the board updates: the ticket moves to `In Review`
with a worker, a branch and a PR.

### 4.3 If it requeues instead of finishing

You will see this, and it is **correct behaviour**, not a bug:

```
failure (harness produced no file changes) -> requeue (retry 1/1)
```

The `script` adapter is a deterministic stand-in for a real coding agent: it does
no work unless you tell it what file to write. With no changes there is nothing
to commit, so the worker correctly refuses to open an empty PR.

Tell it to make a change, then run again:

```powershell
$env:FLEET_SCRIPT_FILE = 'FLEET_OUTPUT.md'
$env:FLEET_SCRIPT_CONTENT = '# done by the fleet'
```

Re-run the same `node bin/fleet-worker.js ...` command. It should now complete.

Clear those variables when you are done:

```powershell
Remove-Item Env:\FLEET_SCRIPT_FILE, Env:\FLEET_SCRIPT_CONTENT
```

### 4.4 Check the CLI's own behaviour

These need no server at all:

```powershell
node bin/fleet-worker.js --help      # usage text, exit 0
node bin/fleet-worker.js --version   # version, exit 0
node bin/fleet-worker.js run         # missing config -> exit 2 + help
node bin/fleet-worker.js run --once --adapter nope --jira http://x --email a@b --token t --repo .
```

That last one should report `unknown adapter "nope"` rather than crash — the
adapter runner turns a bad adapter into a failed result.

### 4.5 Stop the mock fleet

Press **Ctrl-C** in the first window. Confirm the port is free:

```powershell
Get-NetTCPConnection -LocalPort <the port it printed> -ErrorAction SilentlyContinue
```

**Checkpoint:** you have seen a ticket reach `In Review` through the real CLI.

---

## Level 5 — the real thing (Jira tenant)

**Time:** 30-45 minutes. **Needs:** a Jira Cloud site, an admin account, Forge CLI.

### 5.1 Prerequisites

```powershell
node --version          # 20 or higher
git --version
forge --version         # if missing: npm i -g @forge/cli
forge whoami            # must be logged in
```

You also need two API tokens from <https://id.atlassian.com/manage/api-tokens>:

- an **admin** token, to create fields and the project;
- a **Fleet Bot** token, for the worker and the app (can be the same account for
  a first pass, but a separate bot user is what the design intends).

### 5.2 Register the Forge app

```powershell
cd forge-app
npm install
npm run build:ui
forge register fleet-app
```

**You should see:** `manifest.yml` now contains your real app id in place of the
`00000000-...` placeholder.

> If you cloned this repo, `forge register` is the correct command. Do not run
> `forge create` — that starts a new app from a template and would overwrite the
> manifest.

### 5.3 Provision the Jira side

```powershell
$env:JIRA_ADMIN_TOKEN = '<your admin API token>'

node scripts/provision.mjs `
  --jira https://YOUR-SITE.atlassian.net `
  --email YOU@EXAMPLE.COM `
  --token $env:JIRA_ADMIN_TOKEN `
  --project FLT `
  --lead-account-id <your accountId>
```

Add `--dry-run` first if you want to see the plan without writing anything.

**You should see:** it creates the five `Fleet *` fields and the `FLT` Kanban
project, then prints a checklist. Existing fields are left alone, so re-running
it is safe.

To find your account id:

```powershell
Invoke-RestMethod -Uri https://YOUR-SITE.atlassian.net/rest/api/3/myself `
  -Headers @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("YOU@EXAMPLE.COM:$env:JIRA_ADMIN_TOKEN")) } |
  Select-Object -ExpandProperty accountId
```

### 5.4 Do the two manual steps

The script can create fields and projects, but it cannot attach fields to a
screen or author a workflow. These are admin-UI work, and skipping them is the
most common reason the fleet silently does nothing.

**a) Attach the five fields to the project's screen.** Jira settings > Issues >
Screens > the screen used by FLT > add `Fleet Worker`, `Fleet Lease`,
`Fleet Branch`, `Fleet PR`, `Fleet Retry`.

**b) Author the workflow with these exact transition names.** Both the worker
and the app look transitions up *by name*, so a typo is a silent failure.

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

`Finish` is human-only. `Failed -> Requeue` uses the same transition, so a
failed run can be requeued from the panel.

### 5.5 Point the app at the real field ids

The script printed the ids. On a live tenant they are `customfield_XXXXX`, not
the display names:

```powershell
$env:FLEET_MCP_TOKEN = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })

forge variables set FLEET_PROJECT FLT
forge variables set FLEET_FIELD_WORKER customfield_XXXXX
forge variables set FLEET_FIELD_LEASE customfield_XXXXX
forge variables set FLEET_FIELD_BRANCH customfield_XXXXX
forge variables set FLEET_FIELD_PR customfield_XXXXX
forge variables set FLEET_FIELD_RETRY customfield_XXXXX
forge variables set --encrypt FLEET_MCP_TOKEN $env:FLEET_MCP_TOKEN

forge deploy
forge install
```

**You should see:** `forge deploy` succeeds and `forge install` reports a
successful installation on your site.

Environment variables only take effect after `forge deploy`, so deploy last.

### 5.6 Prove the tenant is wired — do not skip this

```powershell
node scripts/verify-setup.mjs `
  --jira https://YOUR-SITE.atlassian.net `
  --email bot@EXAMPLE.COM `
  --token $env:FLEET_JIRA_TOKEN `
  --project FLT
```

**You should see:** a list of `ok` lines for the five fields, the project, each
status, and `Ready for Build -> Claim -> In Build`, ending in `Ready.`

This catches the two silent breakages that would otherwise look like application
bugs. Do not go further until it passes.

### 5.7 Run the loop

**a)** In Jira, create an issue in FLT. Move it to **Triaged**. Open the
**Fleet** panel and choose **Dispatch to fleet** — it moves to `Ready for Build`
and deliberately stays *unclaimed*; the panel never claims on a worker's behalf.

**b)** Start a worker:

```powershell
cd ..\fleet-worker

node bin/fleet-worker.js run `
  --jira https://YOUR-SITE.atlassian.net `
  --email bot@EXAMPLE.COM `
  --token $env:FLEET_JIRA_TOKEN `
  --project FLT `
  --repo "$HOME\.fleet\worker-01\app" `
  --remote git@bitbucket.org:YOUR-WORKSPACE/YOUR-REPO.git `
  --adapter cmdc `
  --bb-workspace YOUR-WORKSPACE --bb-repo YOUR-REPO `
  --bb-username YOUR-BITBUCKET-USER --bb-app-password $env:BB_APP_PASSWORD `
  --field-worker customfield_XXXXX --field-lease customfield_XXXXX `
  --field-branch customfield_XXXXX --field-pr customfield_XXXXX `
  --field-retry customfield_XXXXX
```

Use `--adapter script` instead of `cmdc` for a first run: it takes the whole
protocol through to a PR without needing a coding agent installed. Add `--once`
to do a single poll cycle and exit instead of looping.

**You should see:** within 30-60 seconds it claims the ticket (`Fleet Worker` and
`Fleet Lease` fill in on the issue), runs the harness, pushes a branch, opens a
PR, and moves the ticket to `In Review`.

**c)** Optional but recommended: exercise the MCP endpoint. Get its URL, then
call it:

```powershell
forge webtrigger create      # choose fleet-mcp
```

```powershell
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fleet_status","arguments":{}}}'

Invoke-RestMethod -Method Post -Uri '<the webtrigger url>' `
  -Headers @{ Authorization = "Bearer $env:FLEET_MCP_TOKEN" } `
  -ContentType 'application/json' -Body $body |
  Select-Object -ExpandProperty result
```

**You should see:** a JSON-RPC result whose content includes `active`, `queued`,
`failed`. A `401` means the token does not match; a `503` means
`FLEET_MCP_TOKEN` was never set (or was set after the last deploy).

**d)** Exercise the self-heal. Kill the worker mid-run with **Ctrl-C**. After 15
minutes the scheduled reaper requeues the ticket and leaves a comment. To test
the same transition immediately, use **Abort & requeue** in the panel.

**Checkpoint:** a ticket you created reached `In Review` with a real PR.

---

## What to check in the panel

Open any FLT issue and look at the **Fleet** panel. It is read-mostly by design:
two writes, both of which you could do by hand.

| Field | Should show |
|---|---|
| Header | `Fleet`, a status pill, the issue key |
| Worker | the worker id that holds the claim, or `—` |
| Lease | a live countdown (`13:12 left of 15m`), or `expired` |
| Branch | `FLT-123-some-slug` once a run has pushed |
| Pull request | a link, shown as `pull request #42` |
| Retry budget | `0 used`, then `1 used` after a failure |
| Acceptance criteria | the list from the ticket description, ticked when `Done` |
| Run log | the tail of the fleet's comments on the ticket |
| Buttons | **Dispatch to fleet** when Triaged/Ready; **Abort & requeue** when In Build |

Things that should *not* happen:

- the panel never claims a ticket;
- the panel never runs or merges anything;
- the reaper never does anything unless a ticket is already `In Build`.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Worker: `no transition "Claim" available` | workflow names do not match 5.4b — run `verify-setup.mjs` |
| Worker: `harness produced no file changes` | correct behaviour; the harness did nothing. Set `FLEET_SCRIPT_FILE` (4.3) or use a real adapter |
| Worker claims nothing | ticket is not `Ready for Build`, or the app never dispatched it |
| Panel blank or unstyled | `npm run build:ui` was not run before `forge deploy` (Level 3) |
| Panel: "The Fleet panel could not load this ticket" | field variables are display names, not `customfield_*` (5.5) |
| Panel shows a stale lease forever | the reaper is not running — check the scheduled trigger deployed |
| MCP returns 401 | `FLEET_MCP_TOKEN` does not match the bearer header |
| MCP returns 503 | `FLEET_MCP_TOKEN` unset, or set after the last deploy |
| `forge deploy` fails on the app id | run `forge register` (5.2) |
| `npm run build:ui` errors after a reinstall | the panel's `package.json` gained a `fleet-forge-app: file:../../..` entry. Tests catch this; remove it and rebuild |
| `forge lint` says "app could not be found" | expected before `forge register`; the manifest itself is valid |

---

## Quick reference

```powershell
# Level 1
cd fleet-worker;  npm test;  npm run demo

# Level 2
cd ..\forge-app;  npm test

# Level 3
npm run build:ui

# Level 4
cd ..\fleet-worker;  npm run mock:fleet      # window 1
<run the command it prints>                  # window 2

# Level 5
cd ..\forge-app
forge register fleet-app
node scripts/provision.mjs --jira ... --email ... --token ... --project FLT --lead-account-id ...
# ... manual screen + workflow steps ...
forge variables set ... ; forge deploy ; forge install
node scripts/verify-setup.mjs --jira ... --email ... --token ...
```

## What has actually been verified here

Stated plainly so you know what to trust:

- Levels 1-4 have been run and pass in this repo (35 worker tests, 72 app tests,
  panel build, real CLI against the offline fleet).
- Level 5 has **not** been run against a live tenant — nothing was registered or
  installed during development. The commands and the admin steps are the parts
  that need your account.
