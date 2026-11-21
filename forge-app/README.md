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
| `scheduledTrigger` | `fleet-lease-reaper` | Every 5 minutes, requeue any `In Build` ticket whose lease is older than 15 minutes. A crashed worker self-heals; no orphan state leaves Jira. |
| `webtrigger` | `fleet-mcp` | Streamable-HTTP MCP server behind a bearer token. Five tools plus the `fleet://status` resource, tool-for-tool the same as `fleet-mcp` in the worker package. |

Three resolver functions back the panel: `fleet.panel`, `fleet.dispatch`,
`fleet.requeue`. The panel never claims a ticket — claiming is the worker's
status-transition compare-and-swap, and the panel must not compete for it.

## Configuration

The app reads **no `.env` file**. It runs inside Atlassian's cloud, so its
settings are deployed with the app:

```sh
forge variables set FLEET_PROJECT FLT
forge variables set FLEET_FIELD_WORKER customfield_10101
...
```

| Variable | What it is |
|---|---|
| `FLEET_PROJECT` | project key, default `FLT` |
| `FLEET_FIELD_WORKER` / `_LEASE` / `_BRANCH` / `_PR` / `_RETRY` | the `customfield_XXXXX` ids of the five Fleet fields |
| `FLEET_MCP_TOKEN` | a shared secret you invent, checked on every MCP request (not an Atlassian credential) |

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

Then the two environment values Jira needs:

```sh
forge variables set FLEET_PROJECT FLT
forge variables set FLEET_FIELD_WORKER customfield_10101   # your real ids
forge variables set FLEET_FIELD_LEASE  customfield_10102
forge variables set FLEET_FIELD_BRANCH customfield_10103
forge variables set FLEET_FIELD_PR     customfield_10104
forge variables set FLEET_FIELD_RETRY  customfield_10105
forge variables set --encrypt FLEET_MCP_TOKEN "$(openssl rand -hex 32)"
```

```sh
forge deploy
forge install
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

1. the five field ids, and the `forge variables set` lines above;
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

`verify-setup` reads the same endpoints the app does and fails loudly on a
missing field or a missing `Ready for Build -> Claim` transition — the two
silent ways to break the fleet.

## The MCP endpoint

The webtrigger URL is unauthenticated by the platform, so the handler requires
`Authorization: Bearer $FLEET_MCP_TOKEN` and refuses everything else (503 if the
token is not configured at all).

Point a local coding agent at it, e.g. in `.mcp.json`:

```json
{
  "mcpServers": {
    "fleet": {
      "type": "http",
      "url": "https://<your-installation>.webtrigger.atlassian.app/public/<trigger-id>",
      "headers": { "Authorization": "Bearer <FLEET_MCP_TOKEN>" }
    }
  }
}
```

Tools: `fleet_status`, `list_claimable_tickets`, `claim_ticket`,
`report_run_result`, `reset_claim`. Resource: `fleet://status`.

Workers never call this. Delete the webtrigger and the fleet is unchanged — the
MCP layer is for humans and local agents, not part of the run protocol.

## Layout

```
manifest.yml                  modules, scopes, runtime
src/backend/index.js          Forge wiring: resolver, scheduledTrigger, webtrigger
src/resolver.js               the three panel resolver functions
src/jira.js                   Jira REST v3 client (transport-injected)
src/transports.js             asApp/route on Forge; Basic auth in tests and scripts
src/reaper.js                 stale-lease repair loop
src/mcp.js                    five MCP tools + fleet://status
src/panel-model.js            ticket -> what the panel renders
src/config.js                 the fleet constants (must match fleet-worker)
src/static/issue-panel/       Custom UI on the Atlassian Design System
scripts/provision.mjs         create fields + project, print the admin checklist
scripts/verify-setup.mjs      check a tenant is wired correctly
```

## Testing

```sh
npm test
```

68 tests, no network and no Forge login. They run the real client, reaper, MCP
server and resolver functions against an in-process Jira mock with real
transition/precondition semantics, so claim races and the self-heal path are
exercised rather than asserted about. The operator scripts are run as processes
against a stub Jira, and the panel's stylesheet is checked against the classes
the components actually render.

Four of them exist to stop silent drift:

- `test/contract.test.js` fails if this app and `fleet-worker` disagree on a
  status name, a transition name, a field or a lease timing.
- `test/manifest.test.js` fails if a module wires a function that is not
  declared, a handler that is not exported, or a panel resource that was never
  built.
- `test/panel-styles.test.js` fails if a component renders a class the
  stylesheet does not style.
- `test/scripts.test.js` fails if the provisioning script creates fields the
  verifier does not look for, or documents a workflow Jira does not enforce.

## Design notes

- **The panel is read-mostly.** Two writes, both of which a human could do in
  Jira by hand. No claim, no run, no merge.
- **The reaper repairs; it does not schedule.** It only looks at tickets already
  `In Build`. If no worker is running, the reaper does nothing.
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
- **Custom UI, not UI Kit**, because the panel needs the prototype's layout and
  fluid grid. The trade-off is the Vite build step: `npm run build:ui` before
  `forge deploy`.
