# forge-app

The Forge half of the **decentralized AI development fleet** (Codegeist 2026).

It is deliberately thin: Jira is the queue, and every ticket movement is a Jira
write. This app does not schedule, dispatch, or execute agent runs. It owns the
fleet's *coordination surface* — the live issue panel, the repair loop for dead
workers, and the MCP endpoint a local coding agent can read the board through.

The worker half is [`../fleet-worker`](../fleet-worker). Read
[`../docs/grill/codegeist-jira-ai-fleet.md`](../docs/grill/codegeist-jira-ai-fleet.md)
for the design and [`../fleet-worker/README.md`](../fleet-worker/README.md) for the
run protocol.

## What ships

| Module | Key | What it does |
|---|---|---|
| `jira:issuePanel` | `fleet-issue-panel` | The "Fleet" panel: worker, lease countdown, branch, PR, run log. Two buttons: **Dispatch to fleet** and **Abort & requeue**. |
| `jira:projectPage` | `fleet-page` | The project **Fleet** page: online/busy/idle counts from worker heartbeats, the machine roster, and hover detail (machine name, worker id, current ticket, last seen). Auto-refreshes every 10s. |
| `jira:projectSettingsPage` | `fleet-settings` | The "Fleet settings" page: project key, the five field ids, worker timings, Fleet tokens, and the generated worker `.env` / `.mcp.json`. |
| `scheduledTrigger` | `fleet-lease-reaper` | Every 5 minutes, requeue any `In Build` ticket whose lease is older than 15 minutes, once per configured project. A crashed worker self-heals; no orphan state leaves Jira. |
| `webtrigger` | `fleet-mcp` | Streamable-HTTP MCP server behind a per-project bearer token. Five tools plus the `fleet://status` resource, tool-for-tool the same as `fleet-mcp` in the worker package. |
| `webtrigger` | `fleet-heartbeat` | Worker presence beats into Forge KVS behind the same per-project bearer tokens. Opt-in per worker; the Fleet page reads it. |

Three resolver functions back the panel: `fleet.panel`, `fleet.dispatch`,
`fleet.requeue`. The panel never claims a ticket — claiming is the worker's
status-transition compare-and-swap, and the panel must not compete for it.

## Configuration

Open **Project settings → Fleet settings**. That page is the source of truth: it
stores one record per project in Forge's key-value store (`storage:app`), and
everything else reads it — the panel, the reaper, the MCP endpoint. A project
with no record is prefilled from the environment, and the first save creates the
record, so an existing install keeps working with no migration step.

The page also generates a copy-paste **worker `.env`** and an **`.mcp.json`**,
because the worker and a local MCP client run outside Forge and cannot read the
store. A changed setting takes effect on the worker's next restart; the page
shows the record's `updatedAt` so drift is visible. The `.env` includes the
**heartbeat** endpoint (`webTrigger.getUrl('fleet-heartbeat')`) and, when you
choose a token, its value — that is what puts the machine on the Fleet page.

### Presence

The Fleet page answers "how many machines are connected right now?", which a
Jira-derived count cannot: an idle worker holds no ticket. Workers therefore
POST a small heartbeat every 30s to the `fleet-heartbeat` webtrigger:

```json
{ "workerId": "worker-04", "machine": "DESKTOP-A3", "state": "idle", "ticket": null }
```

The trigger resolves the bearer to a project, stamps the server time, and writes
`fleet:presence:<projectId>:<workerId>` to KVS. A worker is **online** for 90s
after its last beat (three missed beats), then appears under **Recently seen** for
an hour. The scheduled reaper prunes records older than a day. Machine names and
worker ids are visible to anyone who can open the project page; tokens and ticket
content are never part of a beat.

Only a project administrator (`ADMINISTER_PROJECTS`) can change anything. Forge
does not gate `jira:projectSettingsPage`, so the resolver checks the permission
itself and refuses every write for anyone else.

### Environment variables (CI/automation fallback)

The page is the normal way to configure the fleet. Environment variables remain
supported as a fallback for CI and automation, and as the prefill source for a
project that has never been saved:

```sh
forge variables set FLEET_PROJECT FLT
forge variables set FLEET_FIELD_WORKER customfield_10101
...
```

| Variable | What it is |
|---|---|
| `FLEET_PROJECT` | project key, default `FLT` |
| `FLEET_FIELD_WORKER` / `_LEASE` / `_BRANCH` / `_PR` / `_RETRY` | the `customfield_XXXXX` ids of the five Fleet fields |
| `FLEET_LEASE_STALE_MS` / `FLEET_LEASE_REFRESH_MS` / `FLEET_RETRY_BUDGET` | timings; the first is app-consumed, the other two are emitted to the worker |
| `FLEET_MCP_TOKEN` | **deprecated** single shared token; accepted until the page is used, then per-project tokens replace it |

The precedence is **saved record → environment variable → built-in default**.

Jira itself is reached through `api.asApp().requestJira()`, so the app holds no
Jira API token — Forge mints one per installation from the scopes in
`manifest.yml`.

The **worker** is a separate local process and does use a `.env`; there is one at
the repo root. See [`../.env.example`](../.env.example) and
[`../TESTING.md`](../TESTING.md) step 5.7.

## Install

Requires the Forge CLI (`npm i -g @forge/cli`) and Node 20+.

```sh
cd forge-app
npm install
npm run build:ui          # builds the Custom UI panel into src/static/issue-panel/dist
forge register fleet-app  # writes your real app id into manifest.yml
```

Then deploy and install:

```sh
forge deploy
forge install
```

Open **Project settings → Fleet settings** and fill in the project key and the
five field ids. That save is what the panel, reaper and MCP endpoint read.

```sh
forge variables set FLEET_PROJECT FLT               # optional prefill
forge variables set FLEET_FIELD_WORKER customfield_10101   # your real ids
forge variables set FLEET_FIELD_LEASE  customfield_10102
forge variables set FLEET_FIELD_BRANCH customfield_10103
forge variables set FLEET_FIELD_PR     customfield_10104
forge variables set FLEET_FIELD_RETRY  customfield_10105
```

The panel appears on every issue as the **Fleet** panel. The panel is shown to
users who can edit the issue, which is Jira's rule for issue panels.

## Set up the Jira side

Jira Cloud's REST API creates custom fields and a project, but attaching fields
to a screen and authoring a workflow are admin-UI work. The provisioning script
does the automatable half and then prints the exact checklist for the rest.

```sh
node scripts/provision.mjs \
  --jira https://acme.atlassian.net --email admin@acme.com --token "$ADMIN_TOKEN" \
  --project FLT
```

That creates the five `Fleet *` fields and the `FLT` Kanban project (idempotent:
existing fields are left alone), then prints:

1. the five field ids — enter them on **Project settings → Fleet settings** (or,
   for CI, the `forge variables set` lines above);
2. the workflow to author — every transition name must match, because both the
   worker and the app resolve transitions by name:

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

   `Finish` is human-only. `Failed -> Requeue` is the same transition, so a
   failed run can be requeued from the panel.

Then check it:

```sh
node scripts/verify-setup.mjs \
  --jira https://acme.atlassian.net --email fleet-bot@acme.com --token "$JIRA_TOKEN"
```

The same checks are on the settings page as **Test connection**, and a save runs
them too: a missing field or a missing `Ready for Build -> Claim` transition
blocks the save. Both are the silent ways to break the fleet, and both now fail
where an admin can see them.

## The MCP endpoint

The webtrigger URL is unauthenticated by the platform, so a request must present
a token from **Fleet settings → MCP tokens** as `Authorization: Bearer <token>`.
There is one webtrigger per installation and one token per project, so the token
decides which project the session is bound to — no MCP `project` argument is
needed. A request with no recognisable token gets 401; an installation that has
never opened the settings page gets 503.

Generate a token on the settings page, open its **.mcp.json** action, and paste
that into a local coding agent:

```json
{
  "mcpServers": {
    "fleet": {
      "type": "http",
      "url": "https://<your-installation>.webtrigger.atlassian.app/public/<trigger-id>",
      "headers": { "Authorization": "Bearer <your-project-token>" }
    }
  }
}
```

Tokens are named, so several people or agents can be revoked one at a time. They
live in the KVS secret store, which is why the list shows names and dates only
and a value is re-revealed behind a click.

Tools: `fleet_status`, `list_claimable_tickets`, `claim_ticket`,
`report_run_result`, `reset_claim`. Resource: `fleet://status`.

Workers never call this. Delete the webtrigger and the fleet is unchanged — the
MCP layer is for humans and local agents, not part of the run protocol.

## Layout

```
manifest.yml                  modules, scopes, runtime
src/backend/index.js          Forge wiring: resolver, scheduledTrigger, webtrigger
src/backend/settings.js       Forge wiring for the settings resolver + permission gate
src/resolver.js               the three panel resolver functions
src/client.js                 project-aware, async makeJiraClient
src/setup-check.js            the tenant readiness checks (page + verify-setup share them)
src/settings/schema.js        record shape and KVS keys (runtime-free)
src/settings/store.js         the store contract: KVS on Forge, in-memory in tests
src/settings/service.js       save/validate/tokens/resolution rules
src/settings/resolver.js      the settings resolver functions
src/jira.js                   Jira REST v3 client (transport-injected)
src/transports.js             asApp/route on Forge; Basic auth in tests and scripts
src/reaper.js                 stale-lease repair loop
src/mcp.js                    five MCP tools + fleet://status
src/mcp-trigger.js            bearer -> project, then the JSON-RPC envelope
src/panel-model.js            ticket -> what the panel renders
src/config.js                 the fleet constants (must match fleet-worker)
src/presence/schema.js        presence keys, beat validation, online window (runtime-free)
src/presence/store.js         presence store: KVS on Forge, in-memory in tests
src/presence/service.js       record/list/prune rules and server-side ages
src/presence/trigger.js       the heartbeat webtrigger: bearer -> project
src/presence/resolver.js      fleet.page.get
src/static/issue-panel/       Custom UI on the Atlassian Design System
src/static/fleet-page/        Custom UI presence page (model.js is the testable half)
src/static/settings/          UI Kit settings page (model.js is the testable half)
scripts/provision.mjs         create fields + project, print the admin checklist
scripts/verify-setup.mjs      check a tenant is wired correctly
```

## Testing

```sh
npm test
```

150 tests, no network and no Forge login. They run the real client, reaper, MCP
server, settings service and resolver functions against an in-process Jira mock
with real transition/precondition semantics, so claim races and the self-heal path
are exercised rather than asserted about. The settings store is an injected
interface, so the whole settings surface is driven against an in-memory double.
The operator scripts are run as processes against a stub Jira, and the panel's
stylesheet is checked against the classes the components actually render.

Four of them exist to stop silent drift:

- `test/contract.test.js` fails if this app and `fleet-worker` disagree on a
  status name, a transition name, a field or a lease timing.
- `test/manifest.test.js` fails if a module wires a function that is not
  declared, a handler that is not exported, a panel resource that was never
  built, or the settings page is not UI Kit.
- `test/panel-styles.test.js` fails if a component renders a class the
  stylesheet does not style.
- `test/scripts.test.js` fails if the provisioning script creates fields the
  verifier does not look for, or documents a workflow Jira does not enforce.

The settings page has its own set: `settings.test.js` (store/service/resolver,
tokens, the 0/1/many rule, the permission gate), `settings-ui.test.js` (the
page's view model — `@forge/react` cannot load under `node --test`, so the JSX is
a thin render of what is tested there), `setup-check.test.js` (the readiness
checks a save and Test connection share), `reaper-multi.test.js` and
`mcp-trigger-auth.test.js` (the multi-project and bearer->project paths).

Presence has `presence.test.js` (validation, the online window, grouping,
pruning), `presence-trigger.test.js` (bearer -> project, 401/503/400/405), and
`fleet-page-model.test.js` (the page's tiles, roster and hover details).

## Design notes

- **The panel is read-mostly.** Two writes, both of which a human could do in
  Jira by hand. No claim, no run, no merge.
- **The reaper repairs; it does not schedule.** It only looks at tickets already
  `In Build`. If no worker is running, the reaper does nothing.
- **The settings page is the single source of truth.** One KVS record per
  project; panel, reaper and MCP read it. A worker never fetches config — it gets
  a generated `.env`. Precedence is record → env → default, so an existing
  env-var install keeps working until someone saves.
- **Secrets are per project and separate from the record.** Token metadata lives
  in the queryable record; values live in the KVS secret store. A non-admin can
  open the page (Forge does not gate it) but every write is refused in the
  resolver, and the copyable artefacts are not returned to them.
- **Tokens, not hexes.** The panel uses Atlassian Design System custom
  properties (`--ds-*`) and enables theming before first paint, so it themes
  itself in light and dark mode. `test/panel-styles.test.js` fails on a
  hard-coded colour, an invented token name, or a class the stylesheet does not
  define.
- **The status pill is built from tokens, not `@atlaskit/lozenge`.** The
  published lozenge tarball installs without its `dist` in some npm caches,
  which takes the whole panel build down with it. The pill is the same visual
  and needs no extra package; Button, SectionMessage, Spinner, `css-reset` and
  the token system all still come from the design system.
- **Custom UI for the panel and the Fleet page, UI Kit for settings.** Both
  Custom UI apps need the prototype's layout and hover behaviour, hence the Vite
  build step (`npm run build:ui` builds both). The settings page is a form, so it
  is UI Kit (`render: native`) and renders from source — no build step, and
  `@forge/react` never has to load under `node --test`.
- **Presence relaxes "workers never call Forge", narrowly.** The heartbeat is the
  one worker→Forge call, it is opt-in (`FLEET_HEARTBEAT_URL` unset means no
  heartbeat), and it writes presence only. It never touches scheduling, claims or
  ticket state; a heartbeat outage cannot stall a run.
