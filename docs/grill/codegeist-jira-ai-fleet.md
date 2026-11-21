# Grill Session: Jira-driven decentralized AI development fleet (Codegeist 2026)

Date: 2026-11-15
Method: Auto-grill — principle-based delegation
Related: [`fleet-settings-page.md`](./fleet-settings-page.md) — 2026-11-21, per-project settings page replacing `forge variables` for admin-facing config

> **Review first:** the 7 LOW-confidence rows below are where the principles were silent or in tension — they are the decisions a human most needs to review. See "Open Human Decisions" at the end.

## Principles

| # | Principle | Category |
|---|-----------|----------|
| 1 | Jira is the queue — workers poll Jira directly; minimal central state | Orchestration |
| 2 | Harness-agnostic adapter contract, but one integration built deep | Harness scope |
| 3 | Polished narrow demo beats a broad rough skeleton | Hackathon scope |
| 4 | Agent output is always human-gated (workers open PRs, humans merge) | Human gate |
| 5 | Simple token auth; no VPN/network ceremony | Worker trust |
| 6 | Simplicity first; extensibility only on proven need | Ops posture |
| 7 | Glue existing tools (agent CLIs, Jira webhooks) over custom infra | Build vs buy |
| 8 | Deliberately target the Rovo Agents + Atlassian MCP bonus tracks | Prize strategy |

## Decisions

### High Confidence (principles clearly decided)

| # | Question | Answer | Driving Principle |
|---|----------|--------|-------------------|
| 1 | Poll or webhook for workers? | Poll. Workers run a loop every 30-60s: JQL `project=FLT AND status="Ready for Build" ORDER BY priority DESC, created ASC` against Jira REST. No inbound network anywhere. | #5 |
| 2 | Who moves Jira tickets, the workers or the Forge app? | Workers write directly to Jira REST with a bot API token (claim, lease refresh, report, transitions). Forge never proxies worker traffic. | #1, #5, #7 |
| 3 | How is claim made atomic? | Claim IS a status transition `Ready for Build -> In Build` via the transitions API, setting `Fleet Worker` + `Fleet Lease` in the same request. Jira serializes the transition; source-status precondition is the compare-and-swap — loser gets HTTP 400 and moves on. | #1 |
| 4 | Ticket state machine? | Kanban: `Backlog -> Triaged -> Ready for Build -> In Build -> In Review -> Done`, plus `Failed`. Fields: `Fleet Worker` (text), `Fleet Lease` (datetime), `Fleet Branch` (text), `Fleet PR` (url). Transitions: Claim, Report PR, Requeue, Reject, Finish (human only). | #1, #3, #4 |
| 5 | Duplicate claims? | Transition atomicity plus post-claim verification read: worker re-reads the issue and confirms `Fleet Worker` is its own ID before starting; otherwise abandons. | #1 |
| 6 | Git workflow? | `git reset --hard origin/main`, branch `FLT-<key>-<slug>`, push, open PR `FLT-123: <summary>` with report body (changes, tests, AC checklist). Branch name auto-links to Jira dev panel. Humans merge — never the fleet. | #4, #7 |
| 7 | Lease semantics? | Worker refreshes `Fleet Lease` every 5 min via a tiny PUT. Stale = lease older than 15 min. Hard-coded constants, no config. | #1, #6 |
| 8 | Worker crash mid-task? | Lease goes stale; the reaper transitions `In Build -> Ready for Build`, clears worker/lease fields, comments "requeued after lease expiry". Board self-heals; no orphan state outside Jira. | #1, #7 |
| 9 | Ticket edited while a run is in flight? | Worker snapshots summary/description/AC at claim time (timestamped in the PR body). Live edits never affect the running agent; human reconciles at review. | #3, #6 |
| 10 | Tasks running past sprint boundaries? | Per-run hard timeout of 2h: worker kills the harness, comments the log tail, requeues (or fails after retry budget). Unfinished tickets roll over with the sprint. | #6, #3 |
| 11 | Worker privilege scope? | One shared "Fleet Bot" Jira user: browse + edit + transitions in FLT only; one Bitbucket app password with `repo:write` on the demo repo. No admin, no other projects. | #5, #6 |
| 12 | Rovo modules? | `rovo:agent` ("Fleet Steward"), `rovo:action` x3 (`refineTicket`, `markFleetReady`, `fleetDigest`), `rovo:skill` (triage playbook). Actions are Forge functions doing bounded Jira REST writes. | #8 |
| 13 | Agent produces a garbage PR? | Human closes/requests changes and moves the ticket to `Ready for Build` or `Failed`; comment posted. No auto-merge, no auto-repair loop. | #4 |
| 14 | Board config? | One company-managed Jira project ("FLT", kanban board) with the workflow above. One project, one board, one repo — demo scope. | #3, #6 |

### Medium Confidence (principles align but don't directly address)

| # | Question | Answer | Driving Principle | Reasoning |
|---|----------|--------|-------------------|-----------|
| 1 | Which Forge modules ship? | `jira:issuePanel` (custom UI), `webtrigger` (MCP endpoint), `scheduled` (reaper, 10-min cadence), `rovo:agent`/`rovo:action`/`rovo:skill`. No event triggers, no queue, no storage beyond Forge KV for MCP session/rate state. | #1, #6, #7, #8 | P1 says thin center, P8 demands Rovo+MCP modules; panel + reaper are the minimum visibly substantive app. |
| 2 | UI? | One read-mostly issue panel: worker ID, lease countdown, branch/PR links, run-log tail, buttons "Dispatch to fleet" (sets `fleet-ready`) and "Abort & requeue". | #3 | A polished demo surface is implied by the narrow-demo principle but not stated. |
| 3 | Scheduled trigger role? | Lease reaper/reconciler only: scans `In Build` with stale leases, requeues, comments. Deliberately not a scheduler — only repairs Jira state. | #1, #7 | Least-invasive reading of minimal central state. |
| 4 | Worker protocol detail? | poll -> claim transition -> verify -> snapshot context -> reset + branch -> run adapter -> heartbeat lease + milestone comments -> push -> create PR -> set `Fleet Branch`/`Fleet PR` -> transition to `In Review`. | #1, #2, #7 | Assembled from principles; exact ordering is engineering judgment. |
| 5 | Adapter contract? | In (stdin/env JSON): `ticket_key, summary, description, acceptance_criteria, repo_path, base_branch, timeout_s`. Out: `status, branch, commit_sha, pr_url, summary, tests{ran,passed}, log_path`. Worker daemon is harness-blind; adapters are thin translators. | #2, #6 | Interface mandated; shape is judgment. |
| 6 | Workspace model? | One persistent clone per repo per worker; one concurrent run per worker; each run starts from clean `git reset --hard origin/main`; workspace kept after run for debugging. | #6 | Simplicity clearly prefers this; concurrency not addressed by principles. |
| 7 | Bitbucket Cloud or GitHub? | Bitbucket Cloud: native Jira dev-panel linking, app-password auth, same vendor as the judged platform. PR creation via Bitbucket REST v2. | #7 | No principle names a git host; Atlassian coherence is inference from constraints. |
| 8 | What does the Rovo agent do? | Triage & digest only: refine a rough ticket into a build-ready spec (summary, AC, technical notes, `fleet-ready` label + transition), and answer "what is the fleet doing?" digests. It never claims, schedules, executes, or merges. | #8, #1, #6 | P8 demands an agent; P1/P6 constrain it to ticket-shaping. |
| 9 | MCP tools? | Five stateless tools mapping the worker verbs: `fleet_status`, `list_claimable_tickets`, `claim_ticket` (same transition CAS), `report_run_result`, `reset_claim` (Requeue transition `In Build -> Ready for Build`, clears `Fleet Worker`/`Fleet Lease` — lets a human or agent abort/requeue a stale or wrong claim). One resource: `fleet://status`. | #8, #1 | P8 requires the server; P1 forbids it becoming an orchestrator — `reset_claim` is a state-repair verb (same as the reaper), not dispatch. |
| 10 | Who consumes the MCP server? | Humans and local coding agents (Cursor/Claude Code) for board visibility and manual claims. Workers do NOT use it — they use Jira REST, so the MCP layer can be deleted without changing fleet behavior. | #1 | Minimal central state implies MCP stays optional. |
| 11 | Token model? | Workers: HTTP Basic `fleet-bot-email:JiraAPIToken` + Bitbucket app password. MCP endpoint: static bearer token in Forge env vars checked in the webtrigger. Three revocable credentials, env/config only. | #5, #6 | Simple token settled; exact credentials are judgment. |
| 12 | Retry budget? | One automatic requeue; second failure -> `Failed` with log tail, human decides. No retry storms. | #6 | Small fixed number implied; budget of 1 is a guess. |
| 13 | 5-minute demo script? | 0:00 pitch -> 0:30 rough ticket -> 1:00 Rovo triages live -> 1:40 worker claims, Copilot time-lapse -> 3:00 PR opens, Jira panel shows worker/lease/log/PR, ticket in `In Review` -> 3:40 human merges -> 4:00 MCP demo from a coding agent -> 4:30 crash/requeue clip (pre-recorded) -> 4:45 impact + roadmap. | #3 | One flawless flow dictated; beats are scripting judgment. |
| 14 | Minimum bonus-track features? | Rovo: triage refinement flow alone (live). MCP: `fleet_status` + `list_claimable_tickets` working end-to-end from one client. Anything more is cut. | #8, #3 | Target both tracks at minimum viable surface. |

### Low Confidence (needs human review)

| # | Question | Answer | Reasoning | Tension |
|---|----------|--------|-----------|---------|
| 1 | How is "thin center" reconciled with the "non-trivial app" judging bar? | Put fleet semantics in the Forge app, not fleet scheduling: the app owns (a) claim/lease state machine + reaper, (b) Rovo triage/spec generation, (c) MCP verb surface, (d) live issue panel. Workers stay dumb executors; no dispatch state in Forge. | Judgment call balancing the explicit tension; no principle adjudicates the judging bar. | P1/P7 (thin, glue-only) vs hackathon "non-trivial implementation" bar. |
| 2 | Which harness gets the deep integration? | **HUMAN DECISION 2026-11-15 (revised): GitHub Copilot** (`copilot` — Copilot CLI in non-interactive/Autopilot mode). Chosen over Command Code for enterprise-professional optics in the demo. The adapter invokes Copilot programmatically inside the workspace and maps its result onto the same contract (JSON in → NDJSON/JSON out); auth via a GitHub token with Copilot access (`GITHUB_TOKEN`). Stub `kiro-adapter` (and leave room for others) with `not implemented` to keep the daemon harness-agnostic. Caveat — this flips the earlier rationale: the team loses the "own harness" free pass, so Copilot access becomes a prerequisite, and it pairs a GitHub harness with the Bitbucket git host (Med #7), a vendor mix to accept deliberately. | Perceived enterprise credibility (demo optics) + #2; the adapter contract still isolates the harness, so #6 holds. | Supersedes the Command Code pick; drops the "owned harness" rationale. | Resolved by human decision. |
| 3 | Which "Atlassian MCP" bonus does this satisfy? | Forge `webtrigger` serving MCP streamable-HTTP JSON-RPC with bearer auth (matches "Forge app exposing an MCP server"). Fallback: add `rovo:mcp` wrapping the same four actions — cheap since actions exist. | Rules text points at webtrigger; platform docs show `rovo:mcp` and Atlassian's hosted MCP as different things. | P8 (target the track) vs platform ambiguity about what the track rewards. |
| 4 | Prompt injection from ticket descriptions into agent runs? | Context pack wraps ticket text in hard delimiters with an untrusted-data preamble; harness tool allowlist (file edit + build/test). Real backstop is P4 — a human reads every PR. | No security principle exists; P4 partially mitigates. | Principles silent on adversarial input; P3 discourages investing here. |
| 5 | How deep does agent-run sandboxing go? | Demo level: dedicated OS user per worker, tool allowlist, filtered env (no tokens in agent env), no network except git + package registries, workspace reset per run. No containers/VMs. | P6 says simplicity; real agent risk unaddressed by any principle. | P6 (simple) vs unmitigated execution risk (agent runs code from prompt-influenced tasks). |
| 6 | Judges can't run a fleet — what does the install link deliver? | (a) Forge app installs into judge's Jira where Rovo agent + issue panel work standalone; (b) public repo ships `fleet-worker` one-command CLI (`npx fleet-worker --token ... --jira ...`) so any laptop is a worker in ~2 min; (c) fleet story lives in the video. | Principles silent on judge experience. | Silence; mild P3 tension (one flawless demo doesn't require install-link interactivity). |
| 7 | Reaper placement — Forge `scheduled` function vs Jira Automation rule? | Forge scheduled function with JQL scan of stale `In Build`. Automation rule would be more P7-pure but lease arithmetic in smart values is fiddly and the reaper is the app's most defensible substantive logic. | Forced trade-off between P7 and the Low #1 resolution. | P7 (glue, don't build) vs judging bar (app must be non-trivial). |

## Design Tree

```
A. Forge app architecture
├─ A1 Which manifest modules ship? (jira:issuePanel, webtrigger, scheduled, rovo:*)  [Med 1]
├─ A2 TENSION: thin center vs "non-trivial app" judging bar  [Low 1]
├─ A3 Is there UI, and what does it show?  [Med 2]
└─ A4 What does the scheduled trigger do? (lease reaper only)  [Med 3]
B. Task claim / lifecycle
├─ B1 Ticket state machine (Backlog→Triaged→Ready for Build→In Build→In Review→Done, +Failed)  [High 4]
├─ B2 Atomic claim via status transition CAS  [High 3]
├─ B3 Lease/heartbeat (5 min refresh, 15 min stale)  [High 7]
├─ B4 Workers write to Jira REST directly; Forge never proxies  [High 2]
└─ B5 One project, one board, one repo  [High 14]
C. Worker daemon
├─ C1 Polling loop (30-60s, JQL), no inbound network  [High 1]
├─ C2 Claim-execute-report protocol  [Med 4]
├─ C3 Harness adapter contract (JSON in/out, harness-blind daemon)  [Med 5]
├─ C4 Which harness deep? (GitHub Copilot — human decision, revised)  [Resolved]
├─ C5 Workspace model (persistent clone, one run at a time)  [Med 6]
├─ C6 Sandboxing (demo level, no containers)  [Low 5]
└─ C7 Bitbucket Cloud + PR creation  [Med 7]
D. Rovo agent
├─ D1 Triage & digest only, never dispatch/merge  [Med 8]
└─ D2 rovo:agent + rovo:action x3 + rovo:skill  [High 12]
E. Atlassian MCP server
├─ E1 Five stateless tools (incl. reset_claim) + fleet://status resource  [Med 9]
├─ E2 Consumed by humans/local agents; workers bypass it  [Med 10]
└─ E3 Transport: webtrigger streamable-HTTP (fallback rovo:mcp)  [Low 3]
F. Security / trust
├─ F1 Three simple tokens (Basic auth, Bitbucket app password, MCP bearer)  [Med 11]
├─ F2 Least-privilege Fleet Bot (FLT project only)  [High 11]
├─ F3 Prompt injection (delimiters + allowlist + human PR review backstop)  [Low 4]
└─ F4 Secrets kept out of agent env  [Low 5]
G. Failure / edge cases
├─ G1 Crash -> stale lease -> reaper requeues  [High 8]
├─ G2 Duplicate claims prevented by transition CAS + verify read  [High 5]
├─ G3 Garbage PR -> human rejects, ticket requeued/Failed  [High 13]
├─ G4 Ticket edited mid-run -> snapshot at claim time  [High 9]
├─ G5 2h run timeout, sprint rollover  [High 10]
└─ G6 Retry budget of one  [Med 12]
H. Demo & judging
├─ H1 5-minute golden-path script  [Med 13]
└─ H2 Judge install link: standalone Rovo+panel + one-command worker CLI  [Low 6]
I. Scope control
├─ I1 Explicit cuts (no scheduler, no queue, no multi-repo, no autonomous merge, no containers)
└─ I2 Minimum bonus features (Rovo triage flow; MCP status+list)  [Med 14]
```

## Open Human Decisions

> **Delivered 2026-11-21.** The Forge app is built in [`forge-app/`](../../forge-app/README.md)
> as a deploy-ready repo. Decisions taken during implementation:
>
> - **Modules: core only.** `jira:issuePanel`, `webtrigger`, `scheduledTrigger`
>   (`fiveMinute`). The Rovo modules (`rovo:agent`, `action`, `rovo:skill`) are
>   **not declared** — they need Rovo entitlement on the tenant and would make a
>   plain `forge deploy` fail, so the Rovo bonus track stays a follow-up.
> - **Panel: Custom UI on the Atlassian Design System**, not UI Kit, so it can
>   match the prototype's layout. Token-based (`--ds-*`), themed via
>   `view.theme.enable()`.
> - **Not deployed.** Nothing was registered or installed against a tenant; the
>   repo is verified locally (72 tests) and `forge register` is the operator's step.
> - **Jira setup is scripted where possible.** `scripts/provision.mjs` creates the
>   five `Fleet *` fields and the `FLT` Kanban project, then prints the parts
>   only an admin can do (screen attachment, workflow authoring). See Low #7 and
>   the workflow table in the app README.

1. **Where the substance lives** (Low #1): confirm "app owns the coordination protocol + agent layer, workers stay dumb", or accept a thinner app and risk the judging bar.
2. ~~**Deep harness pick**~~ RESOLVED 2026-11-15, **REVISED same day**: **GitHub Copilot** as the deep integration (Copilot CLI, non-interactive/Autopilot mode), chosen for enterprise/professional optics over Command Code. Kiro CLI stays a stubbed follow-up adapter. This drops the earlier "only harnesses we own" constraint — Copilot access is now a prerequisite — and it pairs a GitHub harness with the Bitbucket git host.
3. **Which MCP bonus is actually judged** (Low #3): read the Codegeist 2026 rules verbatim before committing to webtrigger-MCP vs `rovo:mcp`.
4. **Security posture** (Low #4-5): accept "human PR review is the security boundary" with light sanitization, or invest in per-run containers at the cost of simplicity.
5. **Judge experience** (Low #6): standalone Rovo+panel + one-command worker script + video (recommended), vs a hosted simulated worker so judges see a full loop with zero setup.
