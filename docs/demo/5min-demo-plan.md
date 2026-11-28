# 5-Minute Demo — Decentralize Fleet (rev 2)

Pre-recorded 4:45 video, happy path only, fully automated capture (no manual screen recording).
Built in phases; each phase has a review gate before the next begins.

---

## Decisions (this revision)

| Item | Decision |
|---|---|
| Capture | **I do it.** Playwright drives the browser; terminals are rendered from captured stdout. |
| Voice | **TTS**, generated per beat. Cuts come from real audio durations, not estimated wpm. |
| Scope | **Happy path only.** Reaper/self-heal, MCP endpoint, retry budget, crash recovery: cut. |
| Agents | Name **Copilot, OpenCode, Claude Code, Codex** in narration. Add no adapters, show no code. |
| Settings page | Real page is being built separately; demo uses a faux-UI scene with a `mode="real"` swap point. |
| Machines | One laptop, two worker terminals (distinct `FLEET_WORKER_ID`). |

---

## Validation: what is actually implemented

Read from source, not assumed.

| Behaviour | Status | Evidence |
|---|---|---|
| Poll `Ready for Build` by JQL | Implemented | `fleet-worker/src/config.js:190` `jqlFor()`; `worker.js:59` `pollOnce()` |
| Claim = CAS status transition | Implemented | `worker.js:105-131`; `forge-app/src/jira.js:121` `claim()` |
| Loser of the race backs off | Implemented | `worker.js:110-129` — 400 + re-read, logs `lost the claim race (now "In Review")` |
| Post-claim verify read | Implemented | `worker.js:134-140` — logs `verify ok — fleet_worker=<id>` |
| Dispatch to fleet button | Implemented | `forge-app/src/resolver.js:30`, `jira.js:173` `markReady()` (Triaged → Ready for Build) |
| Panel never claims | Implemented | `resolver.js:8` comment + only 3 resolvers (`panel`, `dispatch`, `requeue`) |
| Panel fields: worker, lease, branch, PR, retry, log | Implemented | `panel-model.js:10-35`, `FleetGrid.jsx`, `RunLog.jsx` |
| Lease refresh 5m / stale 15m | Implemented | `worker.js` heartbeat step; `config.js:12-13` both halves |
| PR opened + ticket → `In Review` | Implemented | `worker.js` report step; `jira.js:135` `report()`; Bitbucket host live-verified per `TESTING.md:785` |
| Adapters `cmdc`, `opencode` | Implemented + smoke-tested | `adapters/cmdc.mjs`, `adapters/opencode.mjs`, `scripts/*-smoke.mjs` |
| Adapter `copilot` | Reference impl only | `adapters/copilot.mjs:8-11` says so explicitly |
| Adapters `claude`, `codex` | **Do not exist** | No file in `fleet-worker/adapters/` — narration only, nothing shown |
| Settings page | **Not implemented** | No `jira:projectSettingsPage` in `forge-app/manifest.yml`; spec only in `docs/grill/fleet-settings-page.md` |
| Fleet roster / "who is connected" view | Implemented (not in this video) | `jira:projectPage` → `src/static/fleet-page/`; worker heartbeats via the `fleet-heartbeat` webtrigger. Prototype: `docs/prototype/.../fleet-ux-prototype.html` |

**Consequence for the script:** the demo's proof points are claim race, lock/lease, dispatch, panel,
PR. Nothing else gets claimed on camera.

---

## Demo repo prep (required, currently missing)

`fleet-repo/fleet-test/` contains **only a README** — no `package.json`, no tests. The happy path
needs a task an agent can reliably finish, so seed it like the proven smoke fixture
(`fleet-worker/scripts/opencode-smoke.mjs:27-38`):

- `package.json` with `"test": "node --test"`
- `sum.js` containing `return a - b; // BUG`
- `sum.test.js` asserting `sum(2, 3) === 5`

Commit and push that to `captain-sage/fleet-test` **before** recording. Then the ticket
("`sum()` returns the wrong result") is a one-line fix with a real test that turns green on
camera. This is the single highest-leverage prep step: it de-risks the agent run.

Also confirm the push credential works (`FLEET_REMOTE` + SSH key or token-in-URL) — the Bitbucket
REST token does **not** authenticate `git push` (`TESTING.md:719`).

---

## Recording: tools and division of labour

Nothing here needs manual screen recording.

| Surface | Method | Why |
|---|---|---|
| Jira board, Fleet panel, dispatch click, Bitbucket PR | **Playwright** (`playwright-core` + system Chrome, `channel: 'chrome'`) with `recordVideo` | Already the stageshow filming stack (`stageshow/scripts/browser.mjs:5-19`), so no new tool. Scripted clicks = deterministic, retakeable, and I can re-run it unattended. |
| Two worker terminals + claim race | Run the workers with stdout tee'd to files, **render the captured lines** in a Remotion `<Terminal>` component with typing animation | The content is the log text, not pixels. Gives frame-accurate timing, no OS recorder, no window chrome drift. |
| Settings page | Native Remotion faux UI | Page doesn't exist yet. |
| Architecture diagrams | Native Remotion + SVG | Full control of pacing. |
| Voice | TTS per beat → `public/audio/vo-NN.mp3` | You chose TTS. |

**Preflight for the Playwright step** (one command at implementation time, not now): confirm
`playwright-core` resolves and Chrome launches using the stageshow `launch()` helper; if Chrome is
absent, set `CHROME_PATH`. Fallback if Playwright cannot attach to the Jira session: I hand you a
6-click script and you record with Win+G — but try Playwright first.

**Auth for Playwright:** Jira needs a logged-in session. Plan: `playwright` persistent context with
`storageState` saved once from a manual login, then all takes reuse it. No credentials in the repo.

**TTS choice:** primary = an ElevenLabs voice (best quality; `@remotion/elevenlabs` is already
installed). No-key fallback = Windows SAPI via PowerShell, which sounds robotic but unblocks the
first cut. VO is swappable at any time without touching the edit.

### Timing comes from the audio, not from guessing

`scripts/timings.mjs` probes each `vo-NN.mp3` with `@remotion/media-utils`
(`getAudioDurationInSeconds`) and writes `src/timings.json`. The composition reads it to set each
scene's `durationInFrames`. So if a TTS read runs long, the edit absorbs it — no narration
overlapping a cut.

---

## The script (happy path only, 4:45)

| # | Time | Beat | Picture | Narration |
|---|---|---|---|---|
| 1 | 0:00–0:12 | Hook | Laptop and cloud icon, hard cut between | "Every team now has two kinds of AI coding. One runs on your laptop. The other runs in someone else's cloud. What if it ran on your machines — all of them?" |
| 2 | 0:12–0:50 | Problem: two extremes | L: engineer + terminal + ticket (*their repo, their tools, their credentials*). R: cloud agent box spinning up a container (*fresh clone, no internal packages*) | "Today it's one or the other. Either an engineer picks up a ticket and drives an agent locally. Great context — their repo, their credentials, their tools. But it's one person, one machine, one ticket at a time. Or you hand the ticket to a cloud agent. Parallel and hands-off — but it starts from nothing. Fresh container, fresh clone, no internal packages, and no way to use a model that never leaves your network." |
| 3 | 0:50–1:05 | The gap | The void between the halves; a question mark resolves | "The gap is agentic work that runs on hardware you already own and already configured. Spare laptops, build boxes, a desktop with a GPU — without a human babysitting every run." |
| 4 | 1:05–1:35 | Solution | Board centre, machines on a ring, two install pills | "This is Decentralize Fleet. Install the Forge app in Jira. Start the fleet worker on any machine. That's the whole install. Workers poll the board for tickets in Ready for Build. When one appears, a worker claims it — and claiming is a Jira status transition, so exactly one machine can win. Jira is the queue. There's no scheduler in the middle. And because the model runs on your machine, the data can stay there too." |
| 5 | 1:35–1:55 | Dispatch (live) | Playwright: board → ticket → Fleet panel → **Dispatch to fleet**; pill flips to `Ready for Build` | "A real ticket, Triaged. I open the Fleet panel and dispatch it. Watch the button — it moves the ticket to Ready for Build and stops. The panel never claims on a worker's behalf." |
| 6 | 1:55–2:25 | Claim race (live) | Two terminals: both print the same claimable ticket; A `verify ok`, B `lost the claim race` | "Two machines are already polling. Both see the ticket in the same second. Worker A claims it first — that's a status transition, and Jira rejects the second one. Worker B reads the rejection, re-reads the ticket, sees it's taken, and moves on. No lock table. No coordination service. The board itself is the lock." |
| 7 | 2:25–2:45 | Live panel | Playwright: panel in `In Build` — worker, ticking lease, run log filling | "Back in Jira: which worker holds it, the lease counting down, and the run log filling in. The worker writes progress as comments, so the ticket history is the audit trail." |
| 8 | 2:45–3:00 | PR + review gate | Playwright: PR page (change, tests green, AC) → panel `In Review` | "Minutes later: branch pushed, pull request open with the change, the tests green, the acceptance criteria ticked. In Review. The fleet stops there — a human merges." |
| 9 | 3:00–3:25 | Settings page | Faux UI: connection, timings, tokens, generated `.env`, **Test connection** all-green | "Configuration belongs in Jira. Each project gets a Fleet settings page: field mappings, lease timings, MCP tokens, and a worker config you paste on any machine. Validate before you save; workers pick it up on restart." |
| 10 | 3:25–3:45 | Under the hood: topology | SVG: Jira Cloud (Forge app) ⟷ Jira ⟷ local machine (worker) | "Under the hood: two halves, one rule. The Forge app lives in Atlassian's cloud — the panel and the repair loop. The worker runs on your machine. They never call each other. Both write to Jira, and Jira serialises it." |
| 11 | 3:45–4:05 | Under the hood: claim + lease | Close-up: one transition carrying worker + lease; the loser's 400; 5m/15m | "A claim is a single transition carrying the worker and the lease. That's a compare-and-swap: whoever transitions first wins, and the loser gets a rejected request. The winner re-reads to confirm, then refreshes the lease every five minutes." |
| 12 | 4:05–4:25 | Under the hood: harness | Four **wordmarks** — Copilot, OpenCode, Claude Code, Codex — feeding one JSON contract | "The agent is a plug-in. The worker hands it a ticket as JSON and reads a result back — so Copilot, OpenCode, Claude Code or Codex is a thin translator each. Whatever is installed on that machine is what runs." |
| 13 | 4:25–4:45 | Closing | Machines light up in sequence; end card: `Install the app. Start a worker.` + repo | "This is the missing middle: cloud parallelism without cloud lock-in. Your hardware, your toolchain, your credentials, your model — and a board that coordinates it. Every idle machine in your office is capacity you already paid for. Install the app. Start a worker. Put your fleet to work." |

Beat 12 shows **text wordmarks only** — no vendor logos (stageshow's "invented/misused logo" fault,
and no adapter code on screen, per your call).

Beat 9 layout follows `docs/grill/fleet-settings-page.md`: Connection → Worker timings → MCP tokens
→ Worker configuration → Test connection. No token values or emails on screen.

---

## Build phases

### Phase 1 — Scaffold + capture harness (gate B)

```
demo/src/
  timings.json              generated
  theme.ts                  Atlassian DS tokens as values
  components/ Frame, LowerThird, Board, FleetPanel, Terminal, Lozenge, Node, Arrow
  scenes/     S01…S13.tsx
  compositions/FleetDemo.tsx
demo/scripts/
  capture-jira.mjs          Playwright: storageState + recordVideo, one URL per take
  capture-workers.mjs       runs the two workers, tees stdout to public/logs/*.log
  timings.mjs               audio durations -> src/timings.json
  tts.mjs                   beat text -> public/audio/vo-NN.mp3
```

Every scene is also registered standalone in `Root.tsx` (`Scene09Settings`, …) so you approve
scenes individually instead of scrubbing the timeline.

### Phase 2 — Capture (gate C)

1. `node scripts/capture-jira.mjs` — opens Jira with the saved session, records
   `dispatch`, `panel-live`, `pr`, `review`. Output: `public/footage/*.webm`.
2. Seed the demo repo, push it, create the ticket, get it to `Triaged`.
3. `node scripts/capture-workers.mjs` — starts worker A and B (`FLEET_POLL_MIN_MS=5000`,
   `FLEET_POLL_MAX_MS=5000`, real adapter), captures both log streams through the whole run.
4. You review the raw footage + logs for anything sensitive.

### Phase 3 — Assembly (gate D)

`S01–S04` → `S05–S08` (footage) → `S09` (settings) → `S10–S12` (diagrams) → `S13`.
Conventions: `<OffthreadVideo>` in `<Sequence>`; waits compressed with `playbackRate` + a
`⏩ 40s later` caption; one caption string per beat.

### Phase 4 — Voice + render (gate E)

`node scripts/tts.mjs` → `node scripts/timings.mjs` → `npx remotion render FleetDemo out/fleet-demo.mp4`.
Music at −22 dB, ducked 6 dB under narration. Burn captions; export `.srt` from the same table.

Remotion commands, since they're new to you: `npm run dev` is Remotion Studio (a live preview
player, not a server — nothing to open in a browser by hand); `npx remotion render <id> <file>`
renders the composition to MP4.

---

## Files

| Path | Change |
|---|---|
| `fleet-repo/fleet-test/` | Seed `package.json`, `sum.js`, `sum.test.js`; push |
| `demo/src/**` | Theme, components, 13 scenes, `FleetDemo`, `Root.tsx` |
| `demo/scripts/*.mjs` | capture-jira, capture-workers, timings, tts |
| `demo/public/footage/`, `audio/`, `logs/` | Generated artifacts |
| `demo/package.json` | Add `playwright-core`, `@remotion/transitions`, `@remotion/media-utils` |
| `docs/demo/script.md` | Approved script — source for VO and captions |

No changes to `forge-app/` or `fleet-worker/`.

---

## Verification

1. `npm run smoke:opencode` from `fleet-worker` — proves the adapter the demo will use, on the
   seeded-bug pattern.
2. `node scripts/capture-jira.mjs --dry` — browser opens, session valid, panel renders.
3. `node scripts/capture-workers.mjs --rehearse` — race happens, winner reaches `In Review`,
   loser logs the loss. Run until both logs are captured in one clean take (should be 1–2 tries).
4. `npm run dev` in `demo` — 13 scene compositions present.
5. `npx remotion render FleetDemo out/fleet-demo.mp4` — 285s ±3s, matches beat table.
6. Secret audit on the final file: grep for the bot email, both tokens, and any Bitbucket URL.

---

## Risks

| Risk | Mitigation |
|---|---|
| Agent run fails on camera | Seeded one-line bug with a real test; rehearse before the take; fall back to `cmdc` |
| Race doesn't collide | 5s poll on both workers, two takes, keep the one that collides |
| `git push` rejected (token vs SSH) | Verify push before recording; token-in-URL remote if no SSH key |
| Playwright can't reuse the Jira session | Manual `storageState` capture once; last resort = scripted click list for you to record |
| TTS mispronounces "Jira" / "Forge" | Fix per-beat pronunciation in `tts.mjs`; regenerate only that file |
| Cut runs long | Beats 3 and 10 are the trim candidates |
| Remotion licence | Company submission needs a paid licence — check before publishing |
