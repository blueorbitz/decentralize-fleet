# 5-Minute Demo — Real Footage Edition

Revision of `docs/demo/5min-demo-plan.md`. The video's product moments become **real recordings of
the live app**; animation remains only where there is nothing to film. Phases pause for review.

---

## What changed, and why

| Item | Before | Now |
|---|---|---|
| Product moments | Faux UI in Remotion | **Real Playwright capture** of the live tenant |
| Claim race | Faux terminals, invented text | **Existing faux terminal, real captured log text** + stageshow zoom |
| Settings page | Faux UI | **Real page** — it now exists in the app |
| Cursor | None | Synthetic cursor driven by real click coordinates |
| Animation | Everything | Bookends + diagrams only: S01–S04, S10–S13 |

**Terminals are not screen-recorded.** The real worker writes real logs; we capture that stdout
and render it in the terminal component already built (`src/components/Terminal.tsx`), which is
visually near-identical to a real console. Nothing is invented, and two 1080p PowerShell windows
never have to be legible on screen. Only the bot email is redacted, at capture time.

**Fallback kept on purpose.** Every faux scene stays in the repo. If a live take fails, the video
can ship with the animated version of that beat. The deliverable is never blocked on a capture.

---

## Validation — what is real now

Re-checked against source this revision.

| Behaviour | Status | Evidence |
|---|---|---|
| Fleet settings page | **Exists** | `forge-app/manifest.yml:10-17` `jira:projectSettingsPage`; `src/static/settings/index.jsx`; `src/backend/settings.js` |
| Settings storage | Exists | `storage:app` scope (`manifest.yml:55`), `@forge/kvs` in `src/backend/settings.js:9` |
| Settings admin gate | Exists | `src/backend/settings.js:28` `ADMINISTER_PROJECTS` via `asUser()` |
| Settings validation | Exists | `fleet.settings.validate` → `verify-setup` logic |
| Claim race | Exists, implemented | `fleet-worker/src/worker.js:105-131` |
| Dispatch to fleet | Exists | `forge-app/src/resolver.js:30` |
| Panel, PR, In Review | Exists | `panel-model.js`, `jira.js:135` |
| Panel auto-refresh | **None** — loads once on mount | `App.jsx:24` `useEffect` with no interval |

That last row matters: the panel does not poll. To film state changes, each take **reloads** the
page. The shot plan is built around that.

Still true from the prior revision: `claude`/`codex` adapters do not exist (narration only), and the
fleet roster view is prototype-only (not shown).

---

## Footage-first beat sheet (4:45)

| # | Time | Beat | Source | Shot |
|---|---|---|---|---|
| 1 | 0:00–0:12 | Hook | Animated | Existing `S01Hook` |
| 2 | 0:12–0:50 | Problem | Animated | Existing `S02Problem` |
| 3 | 0:50–1:05 | The gap | Animated | Existing `S03Gap` (to be improved) |
| 4 | 1:05–1:35 | Solution | Animated | Existing `S04Solution` |
| 5 | 1:35–1:55 | Dispatch | **Real** | Board → open FLT-101 → Fleet panel → press **Dispatch to fleet** → pill flips to Ready for Build |
| 6 | 1:55–2:25 | Claim race | **Real logs + stageshow** | Real stdout in the faux terminal, then zoom to the decisive line |
| 7 | 2:25–2:45 | Live state | **Real** | Panel reloaded in In Build: worker, lease countdown, run log |
| 8 | 2:45–3:05 | Human gate | **Real** | Bitbucket PR (tests green, AC ticked) → panel reloaded in In Review |
| 9 | 3:05–3:30 | Settings | **Real** | Project settings → Fleet settings: connection, timings, token table, generated `.env`, **Test connection** |
| 10 | 3:30–3:50 | Topology | Animated | Existing `S10Topology` |
| 11 | 3:50–4:10 | Claim as CAS | Animated | Existing `S11ClaimCas` |
| 12 | 4:10–4:30 | Any agent | Animated | Existing `S12Agents` |
| 13 | 4:30–4:50 | Closing | Animated | Existing `S13Closing` |

Total ~4:50. Narration for beats 5–9 is rewritten to match what the footage actually shows.

---

## Capture harness

Three scripts under `demo/scripts/`, each usable unattended.

### `capture-jira.mjs` — the browser takes

- **Auth:** one-time `storageState` from a manual login, saved to `demo/.auth/jira.json`
  (git-ignored). No password in any file.
- **Recording:** `context = browser.newContext({ recordVideo: { dir, size: { width: 1600, height: 900 } }, storageState })`.
  Output `.webm`. Remotion reads it with `<OffthreadVideo>` (ffmpeg is bundled with Remotion, so no
  system ffmpeg is required).
- **Cursor:** every `click`/`hover` logs `{ at: Date.now() - t0, x, y, kind }` to
  `<take>.cursor.json`. Playwright draws no pointer, so Remotion composites one from these
  coordinates — the pointer lands exactly where the real click happened.
- **Sync:** one `offsetMs` per take in `capture.json`, tuned once by eye so the cursor arrives as
  the UI responds. One number per clip, not per action.
- **Takes:**

| Take | Precondition | Actions | Output |
|---|---|---|---|
| `dispatch` | FLT-101 in `Triaged` | board → open issue → panel visible → click **Dispatch to fleet** → wait for pill | `dispatch.webm` |
| `panel-live` | FLT-101 in `In Build` | reload `/browse/FLT-101` → hold 8s → small scroll to the log | `panel-live.webm` |
| `panel-review` | FLT-101 in `In Review` | reload → hold 6s → click the PR link region | `panel-review.webm` |
| `pr` | PR exists | open PR URL → hold → scroll to checks/AC | `pr.webm` |
| `settings` | page deployed, ≥1 token saved | open Project settings → Fleet settings → click **Test connection** → wait for green | `settings.webm` |

- **Settings take notes:** the page is real UI Kit, so it is plainer than the faux scene. Make it
  look as good as it can: pre-save a config so the form is populated, have one token present so the
  table is not an empty state, and **do not** press Reveal or Generate on camera (both expose a
  real secret). Crop tighter in the edit; UI Kit is sparse, so a tighter frame reads better.

### `capture-workers.mjs` — the race

- Starts worker A and B with `FLEET_WORKER_ID=worker-04` / `worker-11`,
  `FLEET_POLL_MIN_MS=FLEET_POLL_MAX_MS=5000` so both poll on the same 5s beat and collide.
- Tees each stdout to `demo/public/logs/worker-a.log` / `worker-b.log` and keeps a merged timeline.
- **Redacts before the log is ever written to `public/`:** the bot email and the Jira site URL are
  replaced with `fleet-bot@acme.com` and `acme.atlassian.net`. Redaction happens in the capture
  script, so the raw email never reaches the render and there is nothing to catch in the edit.
- Runs the real adapter (`.env` has `FLEET_ADAPTER=opencode`) so the winner genuinely fixes the
  seeded bug and opens a real PR. Expect minutes, not seconds; it runs unattended.
- Also calls `capture-jira.mjs` hooks between phases so the board and panel footage is from the
  *same* run — one story, one ticket.

The captured log text feeds the **existing** `Terminal` component. The story fixtures in
`src/lib/story.ts` (`LOG_A`, `LOG_B`) are replaced by the captured content, so the terminals in the
video are the real run's words, with only the address redacted.

### `orchestrate.mjs` — the sequence

Resets FLT-101 to `Triaged`, then: take `dispatch` → start workers → poll Jira until `In Build` →
take `panel-live` → poll until `In Review` → take `panel-review` and `pr`. Reuses
`fleet-worker/src/jira.js` (`getIssue`, `search`) so there is no second Jira client.

---

## Beat 6 — the stageshow zoom scene

You asked for stageshow to build this, and it suits it: two terminal windows, then a camera
push-in on the winning line.

- **Where:** `demo/stageshow/race/` — a small standalone Vite page importing stageshow's `kit/`,
  laid out per its rules (`Stage`, `Window`, `Row`, `Text`, `Code`, `Camera`).
- **Content:** the **real captured log lines**, mapped to two `Text` rows per window. The terminal
  chrome is stageshow's `Window` rather than the Remotion `Terminal`, because this scene is built in
  stageshow; the two are visually matched so the cut between beat 6 and the rest is invisible.
- **Motion:** no cursor. Windows settle in, then `Camera` pushes from the two-up to the `verify ok`
  / `lost the claim race` lines, holding on the pair. Roughly 12s.
- **Into Remotion:** stageshow's `clock.step()` exists precisely to be driven frame by frame, so
  the scene is filmed to a PNG sequence — one screenshot per frame at 30fps — into
  `demo/public/frames/race/`. Remotion plays it as an `<Img>` sequence, which is fully
  deterministic.
- **Fallback:** if the frame-stepping recorder fights me, the push-in is rebuilt natively in
  Remotion on the existing `Terminal` component, with the same camera move. Same look, no
  cross-tool risk.

---

## Prep that the footage now depends on

Real footage means these are real requirements, not nice-to-haves.

1. **Seed the demo repo.** `fleet-repo/fleet-test/` still has only a README. Add
   `package.json` (`"test": "node --test"`), `sum.js` with the deliberate `a - b` bug, and
   `sum.test.js` asserting `sum(2,3) === 5` — the same fixture proven by
   `fleet-worker/scripts/opencode-smoke.mjs:27-38`. Push it before recording.
2. **Confirm `git push` works.** The Bitbucket REST token does not authenticate a push
   (`TESTING.md:719`). Verify a branch really lands, or the PR take has nothing to show.
3. **Reset the ticket.** FLT-101 back to `Triaged` with the seeded-bug description and AC.
4. **Deploy the settings page** and save one config + one token so the page is populated.
5. **Redact check.** The bot email appears in worker stdout; the settings page shows token names.
   Decide before capture: keep the email (it is a bot account) or strip it in the edit.

---

## Phases — pause at each

**Phase A — Capture harness (gate A).**
Build the three scripts and add `playwright-core` to `demo/package.json` (it is not installed).
Preflight runs a `--dry` capture of the board only, proving: browser launch, saved session valid,
video written, cursor JSON written. Nothing else is attempted until you approve the sample clip.

**Phase B — Full capture run (gate B).**
Seed the repo, push, reset the ticket, then run the orchestrator end to end unattended. You review
the five raw clips and both logs. This is the gate that decides whether the video is real-footage.

**Phase C — Stageshow race scene (gate C).**
Build and film beat 6; show you the PNG sequence as a contact sheet plus an MP4 of the scene alone.

**Phase D — Assembly (gate D).**
Cut real footage into the existing composition; rewrite beats 5–9 narration to match the footage;
keep the faux scenes behind a `USE_FOOTAGE` flag so either version renders.

**Phase E — Voice + render (gate E).**
TTS per beat, timings from real audio, final render, secret audit.

---

## Build details worth knowing

**Cursor overlay.** A `<Cursor>` component takes the take's `cursor.json`, interpolates position
between logged points with a small ease, and draws a click ripple at each `click`. Position is in
video pixels (viewport size equals recording size, so no scaling).

**Zoom on clicks.** The video sits in a wrapper whose `transform: scale()` and
`transform-origin` are driven by the click points — the same gesture as stageshow's `Camera`, so
the real footage and the animated scenes feel like one piece.

**Trimming reloads.** Every panel take starts with a spinner. Trim the first N frames per take via
`trimBefore` on the `<OffthreadVideo>`; the value goes in `capture.json`.

**Killing dead time.** The real agent run is minutes. Compress with `playbackRate` (4–8×) plus a
`⏩ 3 min later` caption. Never show real waiting.

---

## Files

| Path | Change |
|---|---|
| `demo/scripts/capture-jira.mjs` | New — Playwright takes + cursor JSON |
| `demo/scripts/capture-workers.mjs` | New — two workers, teed + redacted logs |
| `demo/scripts/orchestrate.mjs` | New — full sequence, polls Jira |
| `demo/stageshow/race/**` | New — beat 6 scene |
| `demo/scripts/film-frames.mjs` | New — stageshow frame-sequence recorder |
| `demo/src/components/Cursor.tsx` | New — synthetic pointer + ripple |
| `demo/src/components/Footage.tsx` | New — `<OffthreadVideo>` + trim + zoom wrapper |
| `demo/src/components/ImgSequence.tsx` | New — plays the stageshow frames |
| `demo/src/scenes/S05..S09` | Rewritten as footage scenes; faux versions kept behind a flag |
| `demo/src/lib/story.ts` | `LOG_A` / `LOG_B` replaced with the captured, redacted log |
| `demo/beats.json` | Renarrated beats 5–9; lengths from real audio |
| `demo/.auth/jira.json` | One-time session (git-ignored) |
| `fleet-repo/fleet-test/` | Seed + push the buggy fixture |

---

## Verification

1. `node scripts/capture-jira.mjs --dry` — browser opens, session valid, a clip and a cursor file appear.
2. `node scripts/orchestrate.mjs` — one ticket finishes; both logs non-empty; five clips written.
3. Contact sheet of the race frames — the decisive line is legible at 1080p.
4. `npm run dev` — every composition renders; footage scenes seek without error.
5. `npx remotion render FleetDemo out/fleet-demo.mp4` — ~290s, matches the beat sheet.
6. Secret audit: grep the render for the bot email, both tokens, and `•`-masked token values. The
   log email is already redacted at capture time, so this should only ever catch footage.

---

## Risks

| Risk | Mitigation |
|---|---|
| Playwright cannot reuse the Jira session | Manual `storageState` capture once; if blocked, film with a recorded click list |
| Real agent run fails on camera | Seeded one-line bug + rehearsal run first; `cmdc` as fallback adapter |
| Workers don't collide | 5s poll on both; retake until the loss appears in a log |
| Settings page plainer than the faux scene | Tighter crop, populated state, zoom on the generated `.env` block |
| Cursor drifts from the click | One `offsetMs` per take, tuned by eye during assembly |
| Settings page not deploying in time | Gate A opens the settings URL before any other capture; the faux scene is the fallback |
| Stageshow frame-stepping fights the kit | Fall back to native Remotion using stageshow's visuals |
| Whole capture run unusable | Every faux scene remains; flip the flag and ship the animated version |
| Bot email leaks into the video | Redacted in `capture-workers.mjs` before the log is written, not in the edit |
