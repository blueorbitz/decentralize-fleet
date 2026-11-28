# Decentralize Fleet

## Inspiration

Every team now has two kinds of AI coding, and both are compromised.

Local agents are great: your repo, your credentials, your internal packages, your toolchain. But it's one person, one machine, one ticket at a time — a human babysitting every run. Cloud agents are the opposite: parallel and hands-off, but they start from nothing. Fresh container, fresh clone, no internal packages, and no way to use a model that never leaves your network.

The gap is agentic work that runs on hardware you already own and already configured — spare laptops, build boxes, a desktop with a GPU — without a human driving each run. We wanted cloud parallelism without cloud lock-in.

## What it does

Decentralize Fleet turns a Jira board into the scheduler for a fleet of AI coding workers. Install the Forge app, start a worker on any machine, and tickets move themselves.

1. A ticket lands in **Ready for Build** (a human triages and dispatches it).
2. Every worker polls Jira with JQL. When a ticket appears, a worker **claims** it — and claiming *is a Jira status transition* (`Ready for Build → In Build`) carrying the worker ID and a lease. Jira serialises the transition, so exactly one machine can win. The loser gets a 400 and moves on.
3. The winner verifies the claim, resets the repo to the base branch, cuts `FLT-123-slug`, and hands the ticket to a coding harness as JSON.
4. While it runs, the worker refreshes its lease every 5 minutes and writes progress as ticket comments, so the ticket history *is* the audit trail.
5. It commits, pushes, opens a Bitbucket PR with the change, test results and acceptance-criteria checklist, and moves the ticket to **In Review**.

Then a human merges. The fleet never merges.

Because the model runs on your machine, the code and the prompts never leave it. Jira is the only shared state — there is no scheduler, no queue service, no lock table, and no inbound network anywhere.

The Forge app adds the coordination surface a board alone can't give you: a **Fleet issue panel** (worker, live lease countdown, branch, PR, retry budget, run log), a project **Fleet page** (which machines are online, idle or busy right now), a **Fleet settings page** (per-project field mappings, timings, tokens, and a generated worker `.env`), a **lease reaper** that requeues tickets from crashed workers every 5 minutes, and an **MCP endpoint** so a local agent can read the board.

## How we built it

Two halves, one rule: every state change is a Jira write.

- **`fleet-worker`** — Node 20+, zero dependencies. CLI daemon (`run` / `reap`), a Jira REST v3 client, a git module, a Bitbucket PR client, and a harness-blind adapter runner: JSON contract in on stdin, JSON result out on stdout. Adapters are thin translators — `cmdc` (Command Code) and `opencode` (OpenCode) are live-verified end to end; `copilot` is a reference implementation; `kiro` is a stub; `script` is a deterministic harness for tests and offline demos.
- **`forge-app`** — Forge modules: issue panel and Fleet page in Custom UI on the Atlassian Design System (token-based, themes in light and dark), settings page in UI Kit, a scheduled reaper, and two webtriggers for MCP and worker heartbeats. Configuration is one record per project in Forge KVS, with precedence saved record → env var → default, so an existing install never needs a migration.

## Challenges we ran into

**Making the claim atomic without a queue.** Our first design put the worker fields in the transition body so a claim was one request. Jira only accepts fields in a transition body if they're on that transition's *screen* — and a tenant that hasn't been configured that way rejects the whole thing with HTTP 400, which is *indistinguishable from losing a race*. We originally would have silently treated every claim as a loss. The fix is `isFieldNotOnScreen()`: match the specific error sentence, fall back to transition-then-update, and never retry any other 400. The CAS stays; the lease write becomes a second step that the reaper covers if the process dies between them.

**Jira removed the API we built on.** `GET /rest/api/3/search` started returning HTTP 410. The replacement takes a JSON body, returns `fields` as an array, and paginates with `nextPageToken` instead of `startAt`/`total` — there is no total count, so every caller had to stop expecting one.

**Bitbucket's two credential shapes are not interchangeable.** Repository access tokens (`ATCT…`/`ATBB…`) must be sent as `Bearer`; only app passwords use `Basic`. Sending one as the other is a *silent* 401, which cost us a live debugging round. And REST credentials don't authenticate `git push` at all — that's a separate credential. Both are now auto-detected, and a 401 names the shape it sent.

**Testing concurrency without a network.** You can't assert your way to confidence in a claim race. We built an in-process Jira mock with *real* transition-precondition semantics and a throwaway git repo, so races, retry budgets and the reaper are exercised rather than asserted about.

**The harness we designed for wasn't the one we could run.** The design named GitHub Copilot as the deep integration; Copilot access wasn't available, so we built `cmdc` and `opencode` adapters and proved both live instead. The daemon is harness-blind, so this cost one file — which was the whole point of the contract.

## Accomplishments that we're proud of

- **Jira itself is the lock.** No coordinator, no lock table, no message broker. Two workers polling the same second produce one winner and one clean "lost the claim race (now In Build) — moving on" line, and the whole concurrency story rests on a status precondition.
- **The worker has no dependencies and no inbound network.** Clone it, run one command, and a laptop is fleet capacity.
- **Drift guards instead of trust.** Four tests exist purely to catch silent breakage: the worker and the app must agree on every status, transition, field and timing; the manifest must not wire a handler that isn't exported; no component may render a class the stylesheet doesn't define; and the known npm packaging traps can't come back.
- **Idle capacity became visible.** An idle worker holds no ticket, so a Jira-derived count can't answer "how many machines are connected right now?" Workers now heartbeat, and the Fleet page shows online / busy / idle with machine names and last-seen.

## What we learned

- **A status precondition is a compare-and-swap.** You don't need a distributed lock; you need a database that serialises writes and refuses a stale one. Most "we need a queue" problems are really "we need an atomic transition."
- **Thin centre is a feature, not a compromise.** Because the Forge app only repairs and reads, deleting the MCP endpoint or the Fleet page leaves the fleet unchanged. That decoupling is what made it possible to keep adding surface without making the system fragile.
- **The platform is the real cost centre, not the protocol.** The run protocol was settled before we wrote much code. The weeks went into Forge's undocumented edges, npm packaging, and one API Atlassian had already removed.
- **Read from source, not from memory.** Our demo plan contains a validation table — every claimed behaviour mapped to a file and line, with honest "does not exist" rows for adapters we only described in narration. Anything we couldn't point at, we didn't say.
- **Derive timing from the artefact.** Letting TTS audio durations set scene lengths meant the edit absorbed narration that ran long, instead of narration overlapping a cut.

## What's next for Decentralize fleet worker

- **Rovo.** The `rovo:agent` / `rovo:action` / `rovo:skill` modules are designed but not declared — they need Rovo entitlement on the tenant, and a plain `forge deploy` would fail without it. A "Fleet Steward" agent that refines a rough ticket into a build-ready spec, and answers "what is the fleet doing?", is the obvious next step.
- **More harnesses, cheaply.** Copilot and Kiro are stubs today. The adapter contract means each is a thin translator, so the fleet gains harnesses without touching the daemon.
- **Real sandboxing.** Today the boundary is a dedicated workspace, a filtered environment and a human reading every PR. Per-run containers are the honest answer for running prompt-influenced code, and we'd trade some simplicity for it.
- **Fleets, not a fleet.** One project, one board, one repo was deliberate scope. The settings store is already per-project and the reaper already scans every configured project — multi-repo and multi-board is mostly surfacing, not plumbing.
- **Make the board legible at scale.** The Fleet page answers "who's connected?" A run-timeline view, cost and token usage per ticket, and failure clustering across workers would make it an operations tool rather than a status page.
- **Anything else that turns idle hardware into shipped code.** Every idle machine in an office is capacity someone already paid for.
