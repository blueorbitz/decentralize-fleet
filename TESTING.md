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

**You should see:** `# pass 116` and `# fail 0`.

What these cover, so you know what you are trusting:

| Test file | Covers |
|---|---|
| `jira.test.js` | claim-as-CAS, losing a claim race, dispatch, requeue, report |
| `reaper.test.js`, `reaper-multi.test.js` | stale-lease detection, the self-heal, and one pass per configured project |
| `mcp.test.js`, `mcp-http.test.js`, `mcp-trigger-auth.test.js` | the five MCP tools, over real HTTP, and bearer → project |
| `backend.test.js` | the three resolver functions the panel actually calls |
| `settings.test.js`, `settings-ui.test.js` | the settings store/service/resolver, tokens, the permission gate, and the page model |
| `setup-check.test.js` | the readiness checks a save and **Test connection** share |
| `panel-model.test.js`, `panel-display.test.js` | what the panel renders |
| `scripts.test.js`, `scripts-cli.test.js` | the provisioning scripts, run as real processes |
| `contract.test.js` | **fails if the worker and this app disagree on a status, transition, field or timing** |
| `manifest.test.js` | **fails if the manifest wires a handler that is not exported, or the settings page is not UI Kit** |
| `panel-styles.test.js` | **fails if a component renders a class the stylesheet does not style** |
| `packaging.test.js` | **fails if the known npm packaging traps come back** |

The bold ones are the drift guards. They exist because these bugs are silent
otherwise — the app deploys fine and then does nothing.

**Checkpoint:** `# pass 116`.

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

You need **two** API tokens, and the difference between them is the single most
common reason step 5.3 fails:

| Token | Whose account | Why |
|---|---|---|
| **Admin token** | an account with *Administer Jira* | creates the custom fields and the project |
| **Fleet Bot token** | a normal user in the project | what the worker and the app run as |

A token does not grant permissions — it **inherits them from the account that
created it**. A brand-new token from a non-admin account is still a non-admin
token. That is what the error in 5.3 means.

#### Creating the admin token

1. Open <https://id.atlassian.com/manage/api-tokens>.
2. **Check the account first.** The page belongs to whoever is signed in; if
   that is not a Jira administrator, making a token here will not help.
3. Choose **Create API token**, name it something obvious like
   `fleet-provisioning`, and set an expiry you can live with (7 days is fine for
   setup; you only use it once).
4. **Copy the token now.** It is shown once and cannot be retrieved later.
5. Put it in a variable for this session only — do not paste it into a file:

```powershell
$env:JIRA_ADMIN_TOKEN = 'paste-the-token-here'
```

#### Confirm the account is actually an admin

Do this before running anything else. It takes two seconds and saves the exact
failure you already hit:

```powershell
$pair = "YOU@EXAMPLE.COM:$env:JIRA_ADMIN_TOKEN"
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))

Invoke-RestMethod -Uri 'https://captain-sage.atlassian.net/rest/api/3/mypermissions?permissions=ADMINISTER' `
  -Headers @{ Authorization = $auth } |
  Select-Object -ExpandProperty permissions |
  Select-Object -ExpandProperty ADMINISTER
```

`havePermission : True` means you are a Jira administrator. `False` means you
are not, and no amount of re-creating the token will change that — see below.

You can also check *who the token belongs to*, which catches the case of a token
made under the wrong account:

```powershell
Invoke-RestMethod -Uri 'https://captain-sage.atlassian.net/rest/api/3/myself' `
  -Headers @{ Authorization = $auth } |
  Select-Object accountId, displayName, emailAddress
```

#### If `havePermission` is False

You need an account that has the right. Two ways:

**Use an existing admin account.** Ask whoever administers the site which
account has it, sign in as that account, and create the token there. Usually the
person who set up the site is the admin.

**Or grant your account the permission.** A Jira admin does this once:

> **Settings (gear)** > **System** > **Global permissions** > find **Administer
> Jira** > **Add** > search your account > **Add**.

On newer Jira Cloud the path may be **Administration** > **Global permissions**
instead of **Settings** > **System**. If you cannot see Global permissions at
all, you are not an admin and need someone who is.

Note that *Jira administrator* is not the same right as *site administrator* — a
site admin does not automatically have the *Administer Jira* global permission,
and vice versa.

#### You only need the admin token for step 5.3

Once the fields and project exist, everything else uses the Fleet Bot token.
Keep the admin token scoped narrowly and let it expire.

Suggested Fleet Bot setup: create a normal user (e.g. `fleet-bot@yourdomain`),
give it **Browse projects**, **Edit issues** and **Transition issues** on `FLT`
only, and create a token from that account. No admin, no other projects — that
is the least-privilege posture the design calls for.

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

Uses the **admin** token from 5.1.

```powershell
node scripts/provision.mjs `
  --jira https://YOUR-SITE.atlassian.net `
  --email YOU@EXAMPLE.COM `
  --token $env:JIRA_ADMIN_TOKEN `
  --project FLT `
  --lead-account-id <your accountId>
```

Add `--dry-run` first if you want to see the plan without writing anything.

**You should see** it name your account and confirm the permission, then create
the five `Fleet *` fields and the `FLT` Kanban project, then print a checklist:

```
Fleet provisioning — project FLT

Account: Your Name (you@example.com) — Jira administrator

Fleet custom fields
  + Fleet Worker   customfield_10101  (created)
  ...
```

Existing fields are left alone, so re-running it is safe.

To find your account id:

```powershell
$pair = "YOU@EXAMPLE.COM:$env:JIRA_ADMIN_TOKEN"
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))

Invoke-RestMethod -Uri 'https://YOUR-SITE.atlassian.net/rest/api/3/myself' `
  -Headers @{ Authorization = $auth } |
  Select-Object -ExpandProperty accountId
```

#### If it exits 3

The script now checks the permission *before* writing anything, so an exit code
of `3` means a permissions problem, not a bug:

```
Your Name (you@example.com) cannot administer Jira, so it cannot create custom fields.

A Jira API token inherits its permissions from the account that made it.
Making a new token will not help — the account itself needs the right.
...
```

Go back to 5.1 and either create the token from an admin account, or have an
admin grant your account *Administer Jira* under **Global permissions**.

Before this preflight existed, the same situation surfaced as a raw, translated
400 — `只有JIRA管理员权限的用户才能执行此操作` ("only users with Jira administrator
permission can perform this operation"). That was Jira telling you the truth; it
was the presentation that needed fixing.

### 5.4 Do the two manual steps

The script can create fields and projects, but it cannot attach fields to a
screen or author a workflow. These are admin-UI work, and skipping them is the
most common reason the fleet silently does nothing.

**a) Attach the five fields to the project's screen.** Jira settings > Issues >
Screens > the screen used by FLT > add `Fleet Worker`, `Fleet Lease`,
`Fleet Branch`, `Fleet PR`, `Fleet Retry`.

**b) Transition screens (recommended, not required).** Adding the fields to the
`Claim` transition screen makes the claim a single atomic request. It is not
required: if the fields are missing, the worker detects Jira's
`cannot be set. It is not on the appropriate screen` response and falls back to
transition-then-update automatically.

| Transition | Fields it benefits from |
|---|---|
| Claim | `Fleet Worker`, `Fleet Lease` |
| Report PR | `Fleet Branch`, `Fleet PR` |

The trade-off: with the screen configured, a crash mid-claim cannot leave a
ticket `In Build` with no worker. Without it, the transition still happens first
and the fields are written immediately after — if the process dies in between,
the lease is empty, which the reaper treats as stale and requeues.

`npm run verify:env` reports which mode a tenant is in.

**c) Author the workflow with these exact transition names.** Both the worker
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

### 5.5 Configure the app — Project settings → Fleet settings

The app does **not** hold a Jira API token. It calls Jira through Forge:

```js
api.asApp().requestJira(...)   // Forge injects an installation-scoped token
```

Those tokens come from the scopes declared in `manifest.yml`
(`read:jira-work`, `write:jira-work`, `storage:app`) and are minted per
installation. There is nothing to paste in, and nothing to rotate.

What the app *does* need is **configuration** — the `customfield_XXXXX` ids of
the five Fleet fields, because it has to know which field is "Fleet Worker".
Those are now set on a page, not with `forge variables set`:

1. `forge deploy` and `forge install` (below).
2. Open the project → **Project settings → Apps → Fleet settings**.
3. Fill in the project key and the five field ids the provisioning script
   printed, then **Test connection** and **Save**.

That page is the source of truth. It stores the config in Forge's key-value
store (`storage:app`), the panel and the reaper read it per invocation, and it
generates the worker's `.env` for you to copy. A project with no saved config is
prefilled from environment variables, so an existing install keeps working until
someone saves.

#### CI/automation fallback

The page is the normal path. For automation you can still supply the same values
as app environment variables; they prefill a project that has never been saved.

```powershell
forge variables set FLEET_PROJECT FLT
forge variables set FLEET_FIELD_WORKER customfield_XXXXX
forge variables set FLEET_FIELD_LEASE customfield_XXXXX
forge variables set FLEET_FIELD_BRANCH customfield_XXXXX
forge variables set FLEET_FIELD_PR customfield_XXXXX
forge variables set FLEET_FIELD_RETRY customfield_XXXXX

forge deploy
forge install --site YOUR-SITE.atlassian.net --product Jira --confirm-scopes
```

The MCP tokens are **not** environment variables: create them on the settings
page (`MCP tokens → Generate token`), which keeps each one per project and
revocable. The old single `FLEET_MCP_TOKEN` variable is accepted until the page
is used, then per-project tokens replace it.

There are three different things called "token" in this system. Only one is an
Atlassian credential:

| Name | What it is | Used by |
|---|---|---|
| *(none)* | Forge-minted installation token via `asApp()` | the app: panel, reaper, MCP tools |
| `JIRA_ADMIN_TOKEN` | a real Jira API token from an admin account | `provision.mjs` only |
| `FLEET_JIRA_TOKEN` | a real Jira API token from the Fleet Bot | the worker and `fleet-run` |
| *(MCP token)* | **not** an Atlassian credential — generated on the Fleet settings page, one per project | clients authenticating to the MCP webtrigger |

> **`forge deploy` does not read `.env`** — and neither does `forge install`. The
> app reads `forge variables set` at runtime; those are stored on Atlassian's
> servers, not on your disk. If you keep secrets in the root `.env`, load them
> into the shell first:
>
> ```powershell
> Get-Content .env | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object {
>   $name, $value = $_ -split '=', 2
>   Set-Item -Path "Env:$($name.Trim())" -Value $value.Trim()
> }
> ```
>
> Then reference `$env:FLEET_MCP_TOKEN` etc. as below.

**You should see:** `forge deploy` ends with `Deployed`. If the app was already
installed, Forge prints:

```
We've detected new scopes or egress URLs in your app.
Run forge install --upgrade and restart your tunnel to put them into effect.
```

That is not an error — the deploy succeeded. It happens because a **dynamic**
webtrigger counts as egress, which is a major version change. Run:

```powershell
forge install --upgrade --site YOUR-SITE.atlassian.net --product Jira
```

If the app is not installed yet (`forge install list` says so), use plain
`forge install` instead; `--upgrade` is only for replacing an existing install.

Environment variables only take effect after a deploy, so always deploy last.

### 5.6 Prove the tenant is wired — do not skip this

Easiest, reusing the `.env` you will use for the worker anyway:

```powershell
cd forge-app
npm run verify:env
```

Or with explicit flags (for a Fleet Bot token that is *not* in `.env`):

```powershell
node scripts/verify-setup.mjs `
  --jira https://YOUR-SITE.atlassian.net `
  --email bot@EXAMPLE.COM `
  --token $env:FLEET_JIRA_TOKEN `
  --project FLT
```

**You should see:** `ok` for the five fields, the project, each status, the
`Claim` transition, and this at the end:

```
Transition screens
  ok    "Claim" accepts Fleet Worker
  ok    "Claim" accepts Fleet Lease
Ready.
```

That last block reports whether the Claim transition screen accepts the fields.
`FAIL` there no longer blocks you — the worker falls back — but adding them makes
the claim atomic, so it is worth doing.

### 5.7 Run the loop

**a)** In Jira, create an issue in FLT. Move it to **Triaged**. Open the
**Fleet** panel and choose **Dispatch to fleet** — it moves to `Ready for Build`
and deliberately stays *unclaimed*; the panel never claims on a worker's behalf.

**b)** Start a worker. You do not type the customfield ids — `fleet-run` asks Jira
for them.

**There is one `.env` for the whole repo, at its root.** Copy the example and
fill it in:

```powershell
cd C:\path\to\decentralize-workload
Copy-Item .env.example .env
```

The file documents every setting, grouped by what needs it. The four that matter
for a first run:

```ini
JIRA_URL=https://YOUR-SITE.atlassian.net
JIRA_EMAIL=bot@EXAMPLE.COM          # the Fleet Bot, not the admin
JIRA_TOKEN=
FLEET_REPO=C:\Users\you\.fleet\worker-01\app
```

Why one file and not two: only the **worker** reads a `.env`. The Forge app runs
inside Atlassian's cloud and reads `forge variables set` instead — it cannot see
your disk, so a `forge-app\.env` would do nothing. That is also why `forge
deploy` appears to "ignore" `.env`.

Then, from `fleet-worker\` (or the repo root — the search covers both):

```powershell
cd fleet-worker
.\fleet-run.ps1 --check      # resolve config + field ids + base branch
.\fleet-run.ps1              # one poll cycle, then exit
.\fleet-run.ps1 --loop       # poll forever (Ctrl-C to stop)
```

`fleet-run.bat` is identical if you prefer cmd. Both are thin wrappers around
`bin/fleet-run.js`, which:

1. finds `.env` by searching from the current directory upward, then the repo
   root, then beside the worker package (set `FLEET_NO_ENV=1` to ignore it);
2. calls `/rest/api/3/myself` so it can print **which account** it is running as;
3. calls `/rest/api/3/field` and resolves `Fleet Worker` -> `customfield_10213`
   and the rest;
4. asks the git remote for its default branch;
5. hands the equivalent argv to the normal `fleet-worker run`, so it cannot drift
   from the hand-typed command.

**You should see:**

```
Config: environment + .env
Jira:   https://your-site.atlassian.net as Fleet Bot (project FLT)
Fields:
  Fleet Worker  customfield_10213
  Fleet Lease   customfield_10214
  ...
PR host: bitbucket
```

followed by the worker log. Within 30-60 seconds it claims the ticket
(`Fleet Worker` and `Fleet Lease` fill in on the issue), runs the harness, pushes
a branch, opens a PR, and moves the ticket to `In Review`.

Exit codes are deliberate, so a wrapper script can react:

| Code | Meaning |
|---|---|
| 0 | ran (or `--check` passed) |
| 2 | missing configuration |
| 3 | Jira rejected the credentials (401) |
| 4 | the Fleet fields do not exist — run the provisioning script |

On a first run use `--adapter script` in `.env` instead of `cmdc`: it takes the
whole protocol through to a PR without needing a coding agent installed.

> The full hand-typed command still works and is what `--check` prints — see
> `fleet-run.ps1 --verbose` if you want to see it. Use it if you prefer explicit
> flags, or when scripting on a machine without this wrapper.


**c)** Optional but recommended: exercise the MCP endpoint. Get its URL, then
call it. The token comes from **Fleet settings → MCP tokens → Generate token**
(open **.mcp.json** on the row to copy it):

```powershell
forge webtrigger create      # choose fleet-mcp
```

```powershell
$token = '<the token you generated on the settings page>'
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fleet_status","arguments":{}}}'

Invoke-RestMethod -Method Post -Uri '<the webtrigger url>' `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType 'application/json' -Body $body |
  Select-Object -ExpandProperty result
```

**You should see:** a JSON-RPC result whose content includes `active`, `queued`,
`failed`. A `401` means the token is not one this installation knows; a `503`
means no project has been configured on the settings page yet.

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
| `provision.mjs` exits 3 / "cannot administer Jira" | the token's account lacks *Administer Jira*. Create the token from an admin account, or have an admin grant it (5.1) |
| `只有JIRA管理员权限的用户才能执行此操作` | same thing in Chinese: "only Jira administrators can perform this operation". Do not make a new token — the account needs the right |
| `provision.mjs` exits 3 / "Authentication failed (HTTP 401)" | email and token are from different accounts, or the token was revoked. Recreate it from the same account as `--email` |
| Worker: `HTTP 410 ... migrate to the /rest/api/3/search/jql API` | your `fleet-worker` is older than the Atlassian API change. Pull the current code — `search()` now POSTs to `/search/jql` |
| `couldn't find remote ref main` | the repo's default branch is not `main`. The worker now detects it; if you still see this, set `FLEET_BASE_BRANCH` |
| `cannot determine the base branch` | the remote has no recognisable default. The error lists the branches it does have — set `FLEET_BASE_BRANCH` from that list |
| `cannot be set. It is not on the appropriate screen` | the transition screen is not configured (5.4b). The worker now falls back automatically; add the fields to make claims atomic |
| Worker: `no transition "Claim" available` | workflow names do not match 5.4c — run `verify:env` |
| Worker: `harness produced no file changes` | correct behaviour; the harness did nothing. Set `FLEET_SCRIPT_FILE` (4.3) or use a real adapter |
| Worker claims nothing | ticket is not `Ready for Build`, or the app never dispatched it |
| `fleet-run` exits 2 | credentials missing — check the root `.env` or your shell |
| `fleet-run` exits 3 | Jira rejected the token; `JIRA_EMAIL` and `JIRA_TOKEN` must be the same account |
| `fleet-run` exits 4 | the Fleet fields are missing on the tenant — run `provision.mjs` |
| `fleet-run` says "PR host: local" unexpectedly | Bitbucket credentials are incomplete, so PRs are recorded locally instead of opened |
| Bitbucket returns `401` for a repository access token | access tokens (`ATCT…`/`ATBB…`) must be sent as `Bearer`; only app passwords use `Basic username:password`. Auto-detected from the token, and a mismatch names it — force with `FLEET_BB_AUTH=bearer\|basic` |
| `git push` fails although PR creation works | `FLEET_BB_*` authenticates the REST API, not git. Use an SSH remote (`git@bitbucket.org:...`) with a key, or a remote URL carrying a token |
| Panel blank or unstyled | `npm run build:ui` was not run before `forge deploy` (Level 3) |
| Panel: "The Fleet panel could not load this ticket" | field variables are display names, not `customfield_*` (5.5) |
| Panel shows a stale lease forever | the reaper is not running — check the scheduled trigger deployed |
| MCP returns 401 | the bearer is not a token on **Fleet settings → MCP tokens** (or it was revoked) |
| MCP returns 503 | no project has been configured on the settings page yet |
| Settings page says "Read-only" | your account lacks *Administer projects* on this project — a project admin can change it |
| Save is refused with field/transition failures | **Test connection** shows the same checks; the ids or workflow are wrong (5.4) |
| Panel or reaper ignores a saved setting | the panel and reaper read per invocation, but a running **worker** keeps its `.env` until it restarts |
| `forge deploy` fails: "Function ... defines timeoutSeconds but is used by webtrigger" | only `consumer` and `scheduledTrigger` functions may set a timeout. Remove `timeoutSeconds` from the webtrigger function in `manifest.yml` |
| `forge deploy` prints "new scopes or egress URLs" then exits 1 | not a failure — run `forge install --upgrade --site ... --product Jira` (5.5) |
| `forge deploy` seems to ignore `.env` | it does not read `.env`. Load the values into the shell, then `forge variables set` from `$env:...` (5.5) |
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
forge deploy ; forge install
# open Project settings → Fleet settings, enter the ids, Test connection, Save
node scripts/verify-setup.mjs --jira ... --email ... --token ...

# Level 5.7 — run a worker (settings in fleet-worker\.env)
cd ..\fleet-worker
.\fleet-run.ps1 --check      # what it will do
.\fleet-run.ps1              # one poll cycle
.\fleet-run.ps1 --loop       # daemon
```

## What has actually been verified here

Stated plainly so you know what to trust:

- Levels 1-4 have been run and pass in this repo (53 worker tests, 116 app tests,
  panel build, real CLI against the offline fleet). The non-admin and
  bad-token diagnoses are covered by tests against a stub that refuses both.
- The Fleet settings surface is verified offline: the store/service/resolver
  against an in-memory store (tokens, the 0/1/many rule, the `ADMINISTER_PROJECTS`
  gate), the readiness checks against the Jira mock, the multi-project reaper, and
  the MCP bearer → project resolution. The UI Kit page compiles (esbuild) and
  `forge lint` reports no errors; it has **not** been rendered in a live Jira.
- The base branch is detected from the remote; verified end to end on a repo
  whose default is `master`, with no branch configured.
- The claim fallback for unconfigured transition screens is covered at both
  levels: the client alone, and a full run on a tenant whose screens reject
  every field (still reaches `In Review`).
- `npm run verify:env` and the transition-screen check have been exercised
  against the mock in both states: fields present (passes) and absent (fails
  with the exact field name).
- `fleet-run` (`bin/fleet-run.js`, `fleet-run.bat`, `fleet-run.ps1`) has been run
  end to end through the `.bat` launcher with settings coming only from `.env`,
  and a ticket reached `In Review`.
- `forge deploy` has been run once against a real app registration and succeeds
  after the `timeoutSeconds` fix; `forge install` has not been run.
- **Bitbucket PR host (C7) verified live** against `captain-sage/fleet-test`:
  a real scratch branch was pushed and PR #2 opened through `BitbucketClient`
  directly; then the worker's own `runTicket` protocol ran end to end with the
  live host, pushing `FLT-429359-…` and landing PR #3 with the ticket
  `In Review`. A second `createPullRequest` for the same branch reused the open
  PR instead of hitting Bitbucket's 409. The credential is a repository access
  token, which only works as `Bearer` — the previous Basic-only client 401'd.
- **OpenCode adapter (`opencode`) verified live** against opencode v2.3.2 with the
  free `opencode/beam-free` model: the adapter ran the real CLI on the JSON
  contract (status `ok`, one file edited), and `npm run smoke:opencode` drove the
  whole protocol — opencode fixed a seeded bug in a scratch repo, the repo's
  tests went green, and the ticket reached `In Review` with a PR. A bad model
  reports `failed` with opencode's own message instead of crashing.
- Level 5 has **not** been run against a live Jira tenant — the live runs above
  used the in-process Jira mock for the board half. Nothing was registered or
  installed during development. The commands and the admin steps are the parts
  that need your account.
