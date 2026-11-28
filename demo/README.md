# Demo video

A 3m52s product video for Decentralize Fleet, built in Remotion: animated
bookends, and **real footage of the live tenant** for every product moment.

```
npm install --include=dev
npm run dev                    # Remotion Studio: preview every scene
npm run render                 # -> out/fleet-demo.mp4
```

## Structure

| Beat | Source | What it shows |
|---|---|---|
| S01–S04 | animated | the problem, the gap, the solution |
| S05 | `footage/dispatch.webm` | press **Dispatch to fleet**, ticket moves to Ready for Build |
| S06 | animated (real log text) | the claim race: `verify ok` vs `lost the claim race` |
| S07 | `footage/panel-live.webm` | a real worker holding the ticket, live lease countdown |
| S08 | `footage/panel-review.webm` | branch + PR #5 + run log, In Review |
| S09 | `footage/pr.webm` | the real pull request the fleet opened |
| S10–S13 | animated | architecture, compare-and-swap, pluggable agents, close |

Beat lengths live in `beats.json`. Each scene is also registered on its own, so
`Scene-S05` can be previewed and re-rendered without the whole timeline.

**The settings page is deliberately not in the video.** Its UI Kit page fails to
render on the tenant (`encountered unknown component`); see the commit message
and the note in `forge-app/src/static/settings/index.jsx`.

## Capturing the footage

The takes are real recordings of the deployed app, driven by Playwright. Nothing
is mocked and no screen recording is manual.

```bash
npm run capture:login                  # once: sign in to Jira, saves demo/.auth/jira.json
node scripts/new-ticket.mjs            # a fresh Triaged ticket; note the key it prints
node scripts/setup-panel.mjs FLT-7     # Jira only mounts the panel once it is added
node scripts/capture-jira.mjs dispatch # record the dispatch take
node scripts/capture-live.mjs FLT-7    # requeue, run a worker, record it live
node scripts/capture-jira.mjs panel-review
node scripts/capture-jira.mjs pr
```

Then put the ticket key in `capture.config.json`, and the PR URL into
`src/capture.json` as `prUrl`.

`capture-jira.mjs` records a `.webm` per take plus `<take>.events.json` — the
coordinates of every hover and click. `Footage.tsx` composites a pointer from
those events, because Playwright's recorder does not draw one. Trim and cursor
offset per take live in `src/capture.json`.

## Things that will bite you

- **`npm config get omit` returning `dev`** silently prunes every devDependency,
  including `playwright-core`. Install with `npm install --include=dev`.
- **Playwright needs its own ffmpeg** to encode video: `npx playwright install ffmpeg`.
- **A Forge issue panel is not on an issue by default.** Jira mounts it only
  after *View app actions → Fleet*, and only after a reload. `setup-panel.mjs` does it.
- **Panel labels are uppercased by CSS**, so `innerText` returns `RETRY BUDGET`.
  Any string match against the panel must be case-insensitive.
- **A stale `JIRA_TOKEN` in the shell shadows `.env`** in `fleet-run`. If auth
  fails while `.env` looks right, check `$env:JIRA_TOKEN`.
- **Playwright's ffmpeg is built with `--disable-everything`** and cannot decode
  the rendered MP4. Use `remotion still` to sample frames, not `ffmpeg -ss`.
- Captures are git-ignored: they contain the tenant address and bot account.
  `demo/public/` and `demo/.auth/` never get committed.

## Voiceover

One MP3 per beat in `public/voiceover/<BEAT>.mp3` (S01…S13), generated from the
`narration` text in `beats.json`.

**The voice decides the timing.** After changing any audio, retime the edit:

```bash
npm run timings     # reads each mp3, sets beats.json seconds + voiceover, prints the deltas
npm run render
```

`timings.mjs` adds a short tail to each beat (0.4–0.8s, longer for long beats) so
a cut never lands on the last syllable. It reads durations by parsing MPEG frame
headers rather than decoding, because the only ffmpeg here (Playwright's) is
built with `--disable-everything` and cannot read MP3.

A footage beat can outlast its clip when the narration runs long. Rather than
cut the voice, the take holds its final frame (`Freeze`) and the pointer stops
with it. If a still frame is held for more than about two seconds, move the
take's `lead` earlier so it plays more real footage instead.

## Still to do

- **Captions** are on-screen text per beat; an `.srt` can be generated from the
  same `beats.json` table.
- **Music bed** is not added. If one goes in, duck it ~6 dB under the voice.
