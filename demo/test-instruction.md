# Trying Decentralize Fleet

This guide takes you from a fresh Jira site to watching an AI agent pick up a ticket, write code in your own repository, and open a pull request — without you touching a terminal during the build.

About 20 minutes of setup. Nothing here requires you to build or deploy anything: the app is already published, and the worker is plain Node with no dependencies.

## What you'll end up with

- A Jira project with a **Fleet** panel on every ticket
- A small git repository that the fleet builds against
- A worker running on your machine, polling Jira for work
- One ticket that goes from **Ready for Build** → **In Review** on its own, with a pull request attached

## What you need

| What | Why |
|---|---|
| **A Jira Cloud site** | You need *Administer Jira* to create fields and edit workflows |
| **A Jira project** | Any company-managed project. The examples use the key `FLT` |
| **A Bitbucket Cloud account** | For the repository the agent will push to. GitHub works too, but then pull requests are recorded on the ticket instead of being opened for you |
| **A computer to run the worker** | Node 20+ and git. A spare laptop is fine — that is the point of the project |
| **A coding agent CLI** | Command Code or OpenCode. See step 6 for the full list |

You also need two Jira API tokens. They are not interchangeable, and using the wrong one is the most common way this setup fails:

| Token | Create it from | Used for |
|---|---|---|
| **Admin token** | an account with *Administer Jira* | creating the five custom fields, once |
| **Fleet Bot token** | a normal user in your project | the worker, every day |

A Jira API token inherits its permissions from the account that created it — a fresh token made by a non-admin is still a non-admin token. Create both at <https://id.atlassian.com/manage/api-tokens>.

For the Fleet Bot, use a dedicated user with **Browse projects**, **Edit issues** and **Transition issues** on this one project. No admin rights, no other projects.

---

## Step 1 — Install the app

Install Decentralize Fleet into your Jira site using the installation link on the submission page.

Then open **Settings → Apps → Manage apps** and confirm it is listed. In your project you should now see:

- **Fleet** — an issue panel on every ticket
- **Fleet** — a page in the project's left navigation
- **Fleet settings** — under **Project settings → Apps**

The panel and pages will ask you to configure the fleet until step 5. That is expected.

## Step 2 — Create the repository the fleet will work on

The fleet needs a git repository it can clone, branch, and push to. **Use a small test repository, not your real codebase** — the agent will be committing to it.

1. In Bitbucket, create a new **empty** repository, for example `fleet-test`. No README, no `.gitignore`.
2. This project ships a ready-made scratch repo you can use as the starting point: the `fleet-repo/fleet-test` folder. It is a tiny JavaScript project with a real test suite and no dependencies.

Push that folder to your new repository:

```sh
cd fleet-repo/fleet-test
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@bitbucket.org:YOUR-WORKSPACE/fleet-test.git
git push -u origin main
```

Make sure `main` is the **default branch** in Bitbucket. The worker asks the remote which branch to cut from, so `master` or `develop` work too — but the repository must have a default branch.

You do not need to clone it anywhere by hand. The worker clones it into its own scratch workspace the first time it runs.

> **Why a repository with tests?** The worker refuses to open a pull request when the agent produced no file changes, and the pull request body reports the test result. A repository with a working `npm test` makes the whole loop visible.

## Step 3 — Create the five Fleet fields

The fleet tracks its own state in five custom fields. Create each one under **Settings → Issues → Custom fields → Create new field**:

| Field name | Type | What it holds |
|---|---|---|
| `Fleet Worker` | **Text field (single line)** | which worker claimed the ticket |
| `Fleet Lease` | **Date time picker** | its last heartbeat; stale after 15 minutes |
| `Fleet Branch` | **Text field (single line)** | the branch the agent pushed |
| `Fleet PR` | **URL field** | the pull request, for a human to merge |
| `Fleet Retry` | **Number field** | retry budget used (0, then 1) |

Spelling matters — the app and the worker look these fields up by name.

When you create each field, Jira asks which screens it belongs on. **Tick every screen used by your project's tickets.** A field that exists but is not on the screen is invisible to the worker and the panel, and the failure is silent.

Then note down each field's id, which you need in step 5:

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

You will get five lines like `Fleet Worker  customfield_10213`.

> **Shortcut:** this project ships a script that creates all five fields (and a project, if you want one) over the API — `node forge-app/scripts/provision.mjs`, run with `--jira`, `--email`, `--token` and `--project`. It prints the ids at the end. It cannot attach fields to screens or build the workflow, so you still do those here and in step 4.

## Step 4 — Build the Fleet workflow

The fleet moves tickets through a fixed set of statuses, and **both the app and the worker find transitions by name**. This is the step where a typo turns into a fleet that silently does nothing.

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
- **`Failed → Requeue` reuses the same transition name** as the requeue above, so a ticket that failed can be sent back by hand from the panel.

Publish the workflow when you are done.

> **Optional but recommended:** add `Fleet Worker` and `Fleet Lease` to the screen of the **Claim** transition, and `Fleet Branch` and `Fleet PR` to **Report PR**. This makes a claim a single atomic request. Without it the worker still works — it detects Jira's *"cannot be set. It is not on the appropriate screen"* response and does the two steps separately.

## Step 5 — Configure Fleet settings

Open your project → **Project settings → Apps → Fleet settings**. This page is the fleet's configuration for this project; everything else reads it.

1. Enter the **project key** — for example `FLT`.
2. Paste the five **field ids** from step 3 into the matching boxes.
3. Click **Test connection**. It checks that the fields exist, that the statuses exist, and that the `Claim` transition is reachable — and it names whatever is missing.
4. Click **Save**.

Saving is validated on purpose: a missing field or an unreachable `Claim` transition **blocks the save**. Those are the two failures that would otherwise leave you with a fleet that runs and never claims anything.

Only a project administrator can change this page. Everyone else sees it read-only.

## Step 6 — Start a worker on your machine

A worker is a small process that polls Jira, claims a ticket, runs your coding agent in a git checkout, and opens a pull request. Run it on any machine you already own.

### Get the worker

Clone this project and use the `fleet-worker` folder. It has **no dependencies** — there is nothing to install:

```sh
git clone <this-repository-url>
cd decentralize-workload/fleet-worker
```

### Pick your coding agent

The worker contains no AI of its own. It hands a ticket to whichever agent CLI is installed on your machine and reads the result back, so you choose with `FLEET_ADAPTER`:

| `FLEET_ADAPTER` | Harness it drives | Notes |
|---|---|---|
| `cmdc` | **Command Code** — `cmdc -p --output-format json` | the default |
| `opencode` | **OpenCode** — `opencode run --model <model> --format json --auto` | defaults to the free `opencode/beam-free` model |
| `copilot` | **GitHub Copilot CLI** — `copilot -p` | reference implementation; check the flags against your installed CLI |
| `kiro` | **Kiro CLI** | not implemented |
| `script` | no agent — a deterministic stand-in | for checking your wiring before you involve an agent |

Install whichever one you plan to use, and confirm it runs on its own before you point the fleet at it. You can tune the harness from the same config file:

```ini
CMDC_PERMISSION_MODE=yolo      # the fleet runs in an isolated workspace
CMDC_MODEL=

OPENCODE_MODEL=opencode/beam-free
OPENCODE_AGENT=
```

### Write the worker's configuration

Create a file named `.env` inside `fleet-worker`:

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

Three things worth knowing:

- **`FLEET_REPO` is a scratch directory, not a clone you manage.** Point it at an empty folder or a path that does not exist yet, and the worker clones `FLEET_REMOTE` into it. Use an absolute path.
- **You do not type any field ids here.** The worker asks Jira for `Fleet Worker`, `Fleet Lease` and friends by name and resolves the ids itself. If one is missing it tells you which and stops.
- **`FLEET_REMOTE` must be pushable** by the machine running the worker. That is a separate credential from the Bitbucket API token — see below.

The **Worker .env** action on the Fleet settings page generates this same block for you, prefilled with your project key and timings, if you would rather copy it than type it.

### Let the worker open pull requests (optional)

Without Bitbucket credentials the worker still does everything, but records the pull request on the ticket as a `local://` link instead of opening a real one. To open real pull requests, create a **Repository access token** in Bitbucket (**Repository settings → Access tokens**, with *Pull requests: write* and *Repositories: write*):

```ini
FLEET_BB_WORKSPACE=YOUR-WORKSPACE
FLEET_BB_REPO=fleet-test
FLEET_BB_APP_PASSWORD=<the access token>
FLEET_BB_AUTH=auto
```

Two credential shapes exist and they are **not interchangeable** — a repository access token (`ATCT…` / `ATBB…`) is sent as `Bearer`, an app password as `Basic` with a username. Sending one as the other is a silent 401. `auto` detects the shape from the token itself.

Separately, `git push` needs its own credential: either an SSH key for a `git@bitbucket.org:` remote, or a remote URL that carries the token.

### Optional — show this machine on the Fleet page

Copy `FLEET_HEARTBEAT_URL` and a token from the **Worker .env** block. With them set, this machine appears on the project's **Fleet** page even while it is idle. Without them the worker behaves exactly as before.

### Start it

Still in `fleet-worker`:

```sh
node bin/fleet-run.js --check    # show what it resolved, claim nothing
node bin/fleet-run.js            # one poll cycle, then exit
node bin/fleet-run.js --loop     # keep polling
```

On Windows, `.\fleet-run.ps1` does the same thing.

`--check` is the one to run first. It prints which Jira account it authenticated as, the field ids it resolved, the base branch it detected, and the exact command it would run — and claims nothing.

If something is wrong, the exit code tells you what kind of wrong: `2` missing configuration, `3` Jira rejected the credentials, `4` the Fleet fields are not on the site.

## Step 7 — File a ticket and watch it build

Start the worker in loop mode and leave it running:

```sh
node bin/fleet-run.js --loop
```

Then, in Jira:

1. **Create a ticket** in your project. Give it a clear summary, and put the requirements in the description under an **Acceptance Criteria** heading as a bulleted list. That list is extracted at claim time and carried into the pull request.

   For the scratch repo, something like:

   > **Summary:** Add a `totalTokens` helper to the usage report
   >
   > **Description:** Add `totalTokens(rows)` to `usage.js`. It should sum the `tokens` field across all rows and return `0` for an empty list. Add tests for both.
   >
   > **Acceptance Criteria**
   > - `totalTokens` returns the sum of every row's `tokens` value
   > - `totalTokens([])` returns `0`
   > - a test covers both cases

2. **Move it to Triaged**, then to **Ready for Build** — either through the workflow buttons, or by opening the **Fleet** panel and clicking **Dispatch to fleet**.

3. **Watch the panel.** The worker picks it up within a poll cycle (30–60 seconds). Its log shows the claim, the branch, the agent run and the push:

```
claim -> transition Ready for Build -> In Build  (CAS)
verify ok — fleet_worker=worker-01
git reset origin/main @ 4236f23a · branch FLT-12-add-a-totaltokens-helper
adapter status=ok tests=8/8
pushed · PR #1 · transition In Build -> In Review
```

4. **The ticket is now In Review**, with a branch and a pull request. Open the pull request, read the diff, and merge it yourself. The fleet never merges.

If you run a second worker on another machine, you will see the race resolve itself: one logs `verify ok`, the other logs `lost the claim race (now "In Build") — moving on`.

### What the panel should show

| Field | What it means |
|---|---|
| Status pill | the ticket's current status |
| Worker | the worker that holds the claim — or `—` if nobody does |
| Lease | a live countdown (`13:12 left of 15m`), or `expired` |
| Branch | `FLT-12-add-a-totaltokens-helper` once the work is pushed |
| Pull request | a link once the pull request is open |
| Retry budget | `0 used`, then `1 used` after a failure |
| Run log | the tail of the fleet's comments on the ticket |
| Buttons | **Dispatch to fleet** when Triaged or Ready; **Abort & requeue** when In Build |

Three things should never happen: the panel never claims a ticket on a worker's behalf, the panel never runs or merges anything, and the repair loop never touches a ticket that is not In Build.

### Try the repair loop

Kill the worker mid-run with **Ctrl-C**. Its lease goes stale after 15 minutes, and the scheduled repair moves the ticket back to **Ready for Build** with a comment explaining why — no orphaned state left in Jira. To see the same transition immediately, click **Abort & requeue** in the panel.

## If something does not work

| Symptom | Cause |
|---|---|
| Worker exits `2` | credentials missing from `.env` — check `JIRA_TOKEN` is set |
| Worker exits `3` | `JIRA_EMAIL` and `JIRA_TOKEN` are from different accounts |
| Worker exits `4` | the five `Fleet *` fields do not exist, or are misspelled |
| Worker claims nothing | no ticket is in **Ready for Build**, or it never got there |
| Save on Fleet settings is refused | **Test connection** shows the same checks — a field id or the `Claim` transition is wrong |
| `no transition "Claim" available` | the workflow's transition names do not match step 4 |
| `cannot be set. It is not on the appropriate screen` | the transition screens are not configured (the optional block in step 4) — this only makes the claim two steps instead of one, and the worker handles it |
| `harness produced no file changes` | the agent did nothing. If you are on `FLEET_ADAPTER=script`, that is expected — set a real agent |
| Panel is blank | the field ids on the settings page are display names, not `customfield_*` values |
| `git push` fails although the pull request opened | `FLEET_BB_*` is the API credential, not the git one. Use an SSH remote or a token-bearing remote URL |
| Panel shows a stale lease forever | the ticket is not In Build, so the repair loop correctly ignores it |

## Optional — read the board from your coding agent

The app exposes an MCP server so a local coding agent can read the fleet without a browser. Generate a token on **Fleet settings → MCP tokens → Generate token**, then open its **.mcp.json** action — it gives you a ready-made config block whose URL is your installation's `fleet-mcp` endpoint. Paste that into your agent's `.mcp.json`.

Tools available: `fleet_status`, `list_claimable_tickets`, `claim_ticket`, `report_run_result`, `reset_claim`, plus the `fleet://status` resource. Workers never use this endpoint — it exists for humans and local agents, and removing it leaves the fleet unchanged.
