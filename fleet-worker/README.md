# fleet-worker

A Jira-driven worker for the **decentralized AI development fleet** (Codegeist 2026).
Workers poll a Jira board, claim tickets atomically, run a coding harness in a git
checkout, and open a pull request for a human to merge. Jira is the only queue; there
is no central scheduler and no inbound network.

This package implements the worker half of the design in
[`docs/grill/codegeist-jira-ai-fleet.md`](../docs/grill/codegeist-jira-ai-fleet.md)
and the flows in [`docs/grill/dfd-jira-ai-fleet.html`](../docs/grill/dfd-jira-ai-fleet.html).

> **Harness note.** The design doc names **GitHub Copilot** as the demo's deep harness
> integration. The *docs stay that way*. The *working, tested implementation* drives
> **`cmdc` (Command Code)** instead, so the fleet can be developed and exercised end to
> end on a normal machine. The `copilot` adapter is provided to match the doc; `kiro` is
> a deliberate stub. The daemon is harness-blind — swapping harnesses changes one file
> under `adapters/` and nothing else.

## Status

| Piece | State |
|---|---|
| Worker daemon (poll → claim → run → report) | implemented, tested |
| Lease reaper (`reap`) | implemented, tested |
| Adapters: `cmdc` (real), `copilot`, `kiro` (stub), `script` | implemented; `cmdc` proven by a live smoke test |
| Fleet MCP server (`fleet-mcp`, stdio) | implemented, tested |
| Forge app (issue panel, Rovo "Fleet Steward", scheduled reaper, webtrigger) | **not built here** — needs an Atlassian Forge app + a Jira Cloud tenant |

## Layout

```
bin/fleet-worker.js     worker CLI (run | reap)
bin/fleet-mcp.js        MCP server over stdio
src/config.js           flags/env -> config; the hard-coded fleet constants
src/jira.js             Jira REST v3 client (search, claim CAS, lease, report, requeue)
src/adf.js              Atlassian Document Format <-> text
src/git.js              workspace git: reset to base, branch, commit, push
src/git-host.js         PR host: Bitbucket REST, plus a local host for tests
src/adapter-runner.js   harness-blind adapter invocation (JSON in -> JSON out)
src/worker.js           the run protocol + the reaper
src/mcp.js              the five MCP tools + fleet://status resource
adapters/*.mjs          one thin translator per harness
```

## Quickstart

No dependencies — Node 20+ only.

```sh
# a laptop joins the fleet
node bin/fleet-worker.js run \
  --jira https://acme.atlassian.net --email fleet-bot@acme.com --token "$JIRA_TOKEN" \
  --project FLT --repo ~/.fleet/worker-04/app --remote git@bitbucket.org:acme/app.git \
  --adapter cmdc

# repair stale claims (the scheduled reaper's job in the Forge app)
node bin/fleet-worker.js reap --jira ... --email ... --token ...

# expose the fleet to a local coding agent (Cursor / Claude Code / cmdc) over MCP
node bin/fleet-mcp.js --jira ... --email ... --token ...
```

## Configuration

Every value comes from a flag or a `FLEET_*` env var. The numbers the design pins as
constants — lease refresh 5 min, stale 15 min, run timeout 2h, retry budget 1, poll
30–60s — have those defaults and are only overridden for tests.

| Flag | Env | Default |
|---|---|---|
| `--jira` | `FLEET_JIRA_URL` | required |
| `--email` / `--token` | `FLEET_JIRA_EMAIL` / `FLEET_JIRA_TOKEN` | required |
| `--project` | `FLEET_PROJECT` | `FLT` |
| `--repo` | `FLEET_REPO` | required for `run` |
| `--remote` | `FLEET_REMOTE` | — (clone if the workspace is empty) |
| `--base-branch` | `FLEET_BASE_BRANCH` | `main` |
| `--worker-id` | `FLEET_WORKER_ID` | `worker-<host>` |
| `--adapter` | `FLEET_ADAPTER` | `cmdc` |
| `--field-worker/-lease/-branch/-pr/-retry` | `FLEET_FIELD_*` | the human names (set `customfield_*` on real Jira) |
| `--git-host` + `--bb-*` | `FLEET_GIT_HOST`, `FLEET_BB_*` | `bitbucket` |
| `--once` | — | loop; `--once` runs a single poll cycle |

## Run protocol

1. **Poll** — JQL `project = FLT AND status = "Ready for Build" ORDER BY priority DESC, created ASC`.
2. **Claim** — transition `Ready for Build → In Build`, setting `Fleet Worker` + `Fleet Lease` in the same request. Jira serialises the transition and rejects a stale source status with HTTP 400: that precondition is the compare-and-swap.
3. **Verify** — re-read and confirm `Fleet Worker` is this worker, else abandon.
4. **Snapshot** — capture summary/description/AC at claim time.
5. **Git** — `reset --hard origin/<base>`, branch `FLT-<key>-<slug>`.
6. **Run** — the adapter invokes the harness in the workspace (heartbeat runs alongside).
7. **Heartbeat** — refresh `Fleet Lease` every 5 min; stale after 15.
8. **Report** — commit, push, open the PR, set `Fleet Branch`/`Fleet PR`.
9. **Transition** — `In Build → In Review`. A human merges; the fleet never merges.

Failure paths: a lost claim is a clean skip; a failed/timed-out run requeues once, then
moves the ticket to `Failed`; a crashed worker's lease goes stale and the reaper
requeues it. Read `src/worker.js` for the exact behaviour.

## Adapters

The daemon hands the adapter the JSON contract on stdin and reads a JSON result on
stdout — `{ ticket_key, summary, description, acceptance_criteria, repo_path,
base_branch, timeout_s, log_dir }` in, `{ status, summary, tests, log_path }` out.
Ticket text is wrapped in untrusted-data delimiters (a human PR review is the real
boundary).

- **`cmdc`** (default) — runs `cmdc -p --output-format json` in the workspace, prompt on
  stdin, and parses the NDJSON stream. Tune with `CMDC_PERMISSION_MODE` (default `yolo`;
  the fleet runs in an isolated workspace), `CMDC_MODEL`, `CMDC_EXTRA_ARGS`.
- **`copilot`** — the doc's harness (`copilot -p`); reference implementation, verify flags
  against your installed CLI. Tune with `COPILOT_ARGS`, `COPILOT_BIN`.
- **`kiro`** — stub that reports "not implemented".
- **`script`** — deterministic, dependency-free harness used by the tests and offline demos.

## Testing

```sh
npm test            # unit + integration (mock Jira, real git) — no network
npm run smoke:cmdc  # drives the real cmdc CLI through the whole protocol
```

The test suite runs the worker against an in-process Jira mock with real transition/CAS
semantics and a throwaway git repo, so claim races, the retry path and the reaper are all
exercised for real. The smoke test seeds a repo with a failing test and lets `cmdc` fix it.
