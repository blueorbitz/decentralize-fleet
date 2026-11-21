# Grill Session: Fleet settings page (per-project config in Forge KVS)

Date: 2026-11-21
Method: Interactive grill — design tree, 3 rounds
Related: [`codegeist-jira-ai-fleet.md`](./codegeist-jira-ai-fleet.md)

> **Scope:** only the settings page. How the fleet's runtime configuration moves
> out of developer-only `forge variables` and into a page a project admin can
> use. Everything else in the fleet design is unchanged.

## Principles

| # | Principle | Category |
|---|-----------|----------|
| 1 | A value an installation admin knows (project, field ids) belongs in the UI; a value only a developer has (`forge variables`) is a deployment artifact | Config ownership |
| 2 | Protocol values shared with the worker are never silently editable in one place | Contract safety |
| 3 | One record per project is the source of truth; the worker consumes a generated `.env` block | Single source |
| 4 | Secrets are per-project, named, revocable, and never rendered unprompted | Secret handling |
| 5 | Prefer platform modules (`projectSettingsPage`, `kvs`, UI Kit) over hand-rolled surfaces | Simplicity |
| 6 | An existing install must keep working with no migration step | Rollout safety |

## Decisions

All decisions below are high confidence: each was put to the human and settled.

| # | Question | Answer | Principle |
|---|----------|--------|-----------|
| 1 | Which module hosts settings, site-wide or per-project? | `jira:projectSettingsPage`, **per project**. The page receives `project.id` / `project.key` in its context. | 1, 5 |
| 2 | What is editable? | Three groups, **all editable**: (1) project key, five `customfield_*` ids, MCP worker name; (2) lease refresh, lease stale, retry budget; (3) MCP tokens. | 1, 2 |
| 3 | Where is the saved config? | `@forge/kvs` with the `storage:app` scope. Precedence **KVS → env var → code default**. | 3, 6 |
| 4 | How does the worker get shared values? | The page is authoritative for the app and emits a copy-paste **`.env` block** for the worker. No config endpoint; workers still bypass Forge. | 3 |
| 5 | Does saving validate? | Yes. Project, each field id, and the required transitions are checked; an invalid field id or missing transition blocks the save. A "Test connection" action re-runs the full check, reusing `scripts/verify-setup.mjs`'s logic. | 2 |
| 6 | Who may edit? | `ADMINISTER_PROJECTS` on the project, enforced in the resolver via `asUser()` → `/rest/api/3/mypermissions`. Non-admins get a read-only page and refused writes. | 1 |
| 7 | One config record or many? | One **full record per project** (`fleet:config:project:<projectId>`). Zero configured → reaper no-op, MCP returns a clear error, panel shows a "Configure the fleet" CTA. Exactly one → context-less callers use it. Several → the reaper scans all, MCP resolves the project from the token. No "default project" pointer. | 3 |
| 8 | How is the MCP token scoped? | **Per project**, so a project admin never sees another project's secret. The webtrigger compares the bearer against every active project token and binds the session to that project, which also removes the need for an MCP `project` argument. | 4 |
| 9 | One token or many? | A **named list per project** — each entry has a name, token, created date and revoke. Sharing with several people does not mean one leak compromises everyone. Tokens are **re-revealable** (behind a click) because they must be handed out. | 4 |
| 10 | How does the token get created? | Server-generated (`crypto.randomBytes(32)`) with a "paste an existing token" migration path. Stored with the KVS **secret** API, so values are encrypted and not queryable; the unencrypted record holds only token metadata. | 4 |
| 11 | What does a changed setting do to a running worker? | Nothing until restart. The page states this next to the generated `.env`, and shows the record's `updatedAt` so drift is visible. No worker-side network fetch. | 2, 3 |
| 12 | UI technology? | **UI Kit** (`@forge/react`, `render: native`) for the form; the issue panel stays Custom UI. | 5 |
| 13 | What happens to existing env-var installs? | No record → the form is prefilled from `FLEET_*` env values; the first save creates the record. Env vars remain a documented CI/automation fallback. | 6 |
| 14 | What do the docs and provisioning script say? | UI first; `forge variables set` moves under a "CI/automation fallback" heading. `provision.mjs` leads with "open Project settings → Fleet settings". | 1, 6 |

## Facts established while grilling

- In the current app only `jira.project`, `jira.fields`, `timings.leaseStaleMs` and
  the MCP token are consumed. **`FLEET_LEASE_REFRESH_MS` and `FLEET_RETRY_BUDGET`
  are parsed but have no consumer in the app** — they are worker settings.
  Group 2 therefore means: `leaseStaleMs` changes app behaviour; the other two
  are stored centrally and emitted into the worker snippet only.
- `src/mcp-trigger.js` reads `process.env.FLEET_MCP_TOKEN` directly, bypassing
  `loadConfig()`. It must move onto the store path.
- `src/backend/client.js#makeJiraClient()` is synchronous today; a KVS read makes
  it async, and every entry point (panel, reaper, MCP, eight Rovo actions) must
  await it.
- `jira:projectSettingsPage` exposes `project.id` and `project.key` but does not
  document its own permission gate — hence the explicit `ADMINISTER_PROJECTS`
  check.
- `@forge/kvs` needs `storage:app`; unencrypted pairs are queryable, secret pairs
  are not.
- The webtrigger URL is one per installation, which is why a site-wide token could
  not be scoped per project and why Q8 resolves the project from the token.

## Design

### Manifest

```yaml
permissions:
  scopes:
    - read:jira-work
    - write:jira-work
    - storage:app

modules:
  jira:projectSettingsPage:
    - key: fleet-settings
      resource: fleet-settings-ui
      resolver:
        function: settings-resolver
      render: native
      title: Fleet settings
      icon: https://developer.atlassian.com/platform/forge/images/icons/issue-panel-icon.svg

function:
  - key: settings-resolver
    handler: backend/settings.handler

resources:
  - key: fleet-settings-ui
    path: src/static/settings/index.jsx
```

### KVS schema

Unencrypted (queryable):

```
fleet:config:project:<projectId> = {
  projectId, projectKey,
  fields: { worker, lease, branch, pr, retry },   // customfield ids
  timings: { leaseStaleMs },                       // app-consumed
  worker: { leaseRefreshMs, retryBudget },         // worker-only
  tokens: [{ id, name, createdAt }],               // metadata, no values
  updatedAt
}
```

Encrypted (secret API, not queryable):

```
fleet:token:<projectId>:<tokenId> = "<raw token>"
```

### Resolution rules

- `loadEffectiveConfig({ store, env, projectId })`: record → `envConfig(env)` →
  `CONSTANTS`/`DEFAULT_FIELDS`, returning per-field provenance for the UI.
- `resolveSoleProject({ store })`: 0 → `null`; 1 → the record; >1 → throw naming
  the configured projects.
- Reaper: `listProjectConfigs()`; 0 → `{ projects: 0, scanned: 0, requeued: 0 }`;
  N → one pass per project, summed.
- MCP: bearer → project record; no tokens anywhere → 503; no match → 401;
  match → server bound to that project.
- Rovo actions: `payload.project` → sole configured project → error.

### Page layout

1. **Connection** — project key, five field ids.
2. **Worker timings** — lease refresh, lease stale, retry budget, with a note that
   they also live in the worker's `.env`.
3. **MCP tokens** — table (name, created, Reveal, Revoke), Generate, Paste existing.
4. **Worker configuration** — copyable `.env` block, restart notice, `updatedAt`.
5. **MCP client configuration** — `.mcp.json` block using the selected token.
6. **Protocol (read-only)** — status names, transition names, `fleet-ready` label.
7. **Test connection** — validation results.

Non-admins see the same content read-only with a notice.

### Validation

`validateConfig({ jira, record })` reuses the `verify()` checks from
`scripts/verify-setup.mjs`: project exists, each field id resolves, every status
and required transition exists, and the Claim transition screen still carries the
worker/lease fields. `save` runs it and rejects with per-check detail;
`fleet.settings.validate` exposes the same thing without writing.

## Design tree

```
J. Settings surface
├─ J1 Module and scope: projectSettingsPage, per project  [D1]
├─ J2 Editable groups: bindings + worker timings + tokens  [D2]
├─ J3 Permission gate: ADMINISTER_PROJECTS via mypermissions  [D6]
├─ J4 UI technology: UI Kit  [D12]
└─ J5 Validation: block save + Test connection  [D5]
K. Configuration storage
├─ K1 KVS, storage:app  [D3]
├─ K2 Precedence KVS → env → default  [D3, D13]
├─ K3 One full record per project  [D7]
├─ K4 Context-less consumers: 0 / 1 / many rule  [D7]
└─ K5 Worker receives a generated .env, no fetch  [D4, D11]
L. Secrets
├─ L1 Per-project tokens  [D8]
├─ L2 Named list, revocable, re-revealable  [D9]
├─ L3 Encrypted secret API; metadata only in the record  [D10]
└─ L4 Token → project resolution in the webtrigger  [D8]
M. Rollout
├─ M1 Prefill from env, first save creates the record  [D13]
├─ M2 Env remains a CI/automation fallback  [D13]
└─ M3 Docs and provision.mjs lead with the page  [D14]
```

## Implementation checklist

- [ ] `manifest.yml`: `storage:app`, `jira:projectSettingsPage`, `settings-resolver`, resource.
- [ ] `src/settings/schema.js`, `store.js`, `service.js` (runtime-free, injectable store).
- [ ] `src/backend/settings.js`: resolver API + `ADMINISTER_PROJECTS` gate.
- [ ] `src/static/settings/index.jsx`: UI Kit page.
- [ ] `src/config.js`: `envConfig()`, `WORKER_DEFAULTS`; remove dead app knobs.
- [ ] `src/backend/client.js` → async `makeJiraClient({ projectId })`.
- [ ] `src/backend/index.js`: panel project id, reaper loop, trigger wiring.
- [ ] `src/mcp-trigger.js`: token → project auth, no `process.env` token read.
- [ ] `src/mcp.js`, `src/actions.js`, `src/backend/actions.js`: project binding.
- [ ] `src/setup-check.js` extracted from `scripts/verify-setup.mjs`.
- [ ] `scripts/provision.mjs` and `README.md`: UI-first wording.
- [ ] Tests: manifest, contract, auth-model, mcp-http, settings store/service/resolver,
      reaper multi-project, scripts-cli, settings UI props.
