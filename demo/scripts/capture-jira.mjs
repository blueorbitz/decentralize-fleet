// The Jira takes: dispatch, live panel, review, PR, settings.
//
// Each take is a fresh context so the video starts at a known moment. Drag the
// takes into the edit; the cursor is composited from the .events.json beside each
// clip.
//
//   node scripts/capture-jira.mjs --dry            record the board only, prove the plumbing
//   node scripts/capture-jira.mjs dispatch         one take
//   node scripts/capture-jira.mjs all              every take that is ready
import fs from 'node:fs';
import path from 'node:path';
import {
  DEMO_ROOT,
  clickAndLog,
  hoverAndLog,
  launchBrowser,
  loadSession,
  readCaptureConfig,
  recordTake,
  hasSession,
  writeCaptureConfig,
} from './capture-lib.mjs';

const config = JSON.parse(fs.readFileSync(path.join(DEMO_ROOT, 'capture.config.json'), 'utf8'));

// The Fleet panel lives in a Forge iframe. Only that frame has these labels;
// Jira's own sidebar also says "Fleet", so searching the main frame for "Fleet"
// finds the sidebar instead of the panel. Search for panel-only text, and never
// accept the main frame.
//
// The match is case-insensitive on purpose: the panel's field labels are
// capitalised by CSS (text-transform), so innerText reads "RETRY BUDGET" while
// the source says "Retry budget".
const PANEL_MARKERS = ['retry budget', 'acceptance criteria', 'run log'];

// The panel is identified by its own field labels, which no other frame on the
// page uses. Requiring a quorum rather than every marker matters: the panel is
// taller than the iframe, so innerText can stop before the run log.
function looksLikePanel(body) {
  const lower = body.toLowerCase();
  const hits = PANEL_MARKERS.filter((m) => lower.includes(m)).length;
  return hits >= 2;
}

async function panelFrame(page, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const debug = process.env.DEBUG_PANEL === '1';
  let lastReport = 0;
  while (Date.now() < deadline) {
    const frames = page.frames().filter((f) => f !== page.mainFrame());
    for (const frame of frames) {
      try {
        const body = await frame.locator('body').innerText({ timeout: 2000 });
        if (looksLikePanel(body)) return frame;
        if (debug && Date.now() - lastReport > 2000) {
          lastReport = Date.now();
          const lower = body.toLowerCase();
          console.log(
            `    [panelFrame] iframe len=${body.length} markers=${PANEL_MARKERS.filter((m) => lower.includes(m)).join(',') || 'none'}`,
          );
        }
      } catch {
        /* frame detached or still loading */
      }
    }
    if (debug && frames.length === 0 && Date.now() - lastReport > 2000) {
      lastReport = Date.now();
      console.log(`    [panelFrame] no child frames (${page.frames().length} total)`);
    }
    await page.waitForTimeout(400);
  }
  return null;
}

// A Forge issue panel is not on the issue by default: Jira only mounts it once
// it has been added through "View app actions" > <panel name>. A newly created
// ticket therefore shows no panel at all, which looks like a broken app.
//
// This adds it if it is missing, and is idempotent: on a ticket that already has
// the panel, the menu click is skipped.
async function ensurePanel(page, { timeoutMs = 25000 } = {}) {
  // Recording video slows the page enough that the panel's iframe can take
  // longer than a few seconds to attach, so give detection a real window before
  // deciding the panel is absent and clicking the menu.
  let frame = await panelFrame(page, { timeoutMs: 20000 });
  if (frame) return { frame, added: false };

  const trigger = page.getByRole('button', { name: /view app actions/i }).first();
  if (!(await trigger.count())) return { frame: null, added: false };

  await trigger.click();
  await page.waitForTimeout(1500);

  const entry = page.getByRole('menuitem', { name: /^fleet$/i }).first();
  if (!(await entry.count())) {
    await page.keyboard.press('Escape').catch(() => {});
    return { frame: null, added: false };
  }

  await entry.click();
  // The menu item toggles, so this only runs when the panel was genuinely
  // absent above. Adding it does not mount it in the current view; Jira renders
  // it on the next load of the issue, so reload rather than waiting.
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  frame = await panelFrame(page, { timeoutMs });
  return { frame, added: true };
}

// Read the state the panel is showing, so a take can assert it filmed the right
// thing instead of silently recording a spinner. The panel's grid renders each
// field as "LABEL" then its value on the next line, in order, so the value is
// the line after the label.
function fieldAfter(text, label) {
  const lines = text.split('\n').map((l) => l.trim());
  // Panel labels are uppercased by CSS, so compare case-insensitively.
  const wanted = label.toLowerCase();
  const at = lines.findIndex((l) => l.toLowerCase() === wanted);
  if (at === -1) return null;
  const next = lines.slice(at + 1).find((l) => l && l.toLowerCase() !== wanted);
  return next || null;
}

async function panelState(frame) {
  const text = await frame.locator('body').innerText().catch(() => '');
  return {
    status: fieldAfter(text, 'STATUS'),
    worker: fieldAfter(text, 'WORKER'),
    lease: fieldAfter(text, 'LEASE'),
    branch: fieldAfter(text, 'BRANCH'),
    pr: fieldAfter(text, 'PULL REQUEST'),
    retry: fieldAfter(text, 'RETRY BUDGET'),
    text,
  };
}

// Jira's own chrome is slow and noisy. Wait for network to settle, but never
// fail the take because a background poll never stops.
async function settle(page, ms = 2500) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(ms);
}

async function takeDispatch(page, { log }) {
  await page.goto(config.urls.issue, { waitUntil: 'domcontentloaded' });
  await settle(page, 6000);

  const { frame, added } = await ensurePanel(page);
  if (added) {
    // Adding the panel is setup, not part of the shot; settle before filming it.
    log('state', { phase: 'panel-added' });
    await page.waitForTimeout(2500);
  }
  if (!frame) {
    log('warn', { message: 'Fleet panel not available on this ticket' });
    await page.waitForTimeout(4000);
    return;
  }

  const before = await panelState(frame);
  log('state', { phase: 'before', ...before, text: undefined });

  const dispatch = frame.getByRole('button', { name: /dispatch to fleet|mark fleet-ready/i }).first();
  const requeue = frame.getByRole('button', { name: /abort & requeue|requeue stale claim/i }).first();

  if (await dispatch.count()) {
    // The button sits at the bottom of the panel, often below the fold. Scroll it
    // into view first so the click lands on screen and the cursor has somewhere
    // sensible to travel.
    await dispatch.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1200);
    await hoverAndLog(page, dispatch, log);
    await page.waitForTimeout(700);
    await clickAndLog(page, dispatch, log, 'dispatch');
    await page.waitForTimeout(6000);
    log('state', { phase: 'after', ...(await panelState(frame)), text: undefined });
    return;
  }

  // Not dispatchable: the ticket is already past Ready for Build. That is not a
  // failure of the take, but the shot has to be honest about it.
  log('warn', { message: `no dispatch button; ticket is "${before.status}"` });
  await page.waitForTimeout(2500);
}

async function takePanel(page, { log }, { expectStatus }) {
  await page.goto(config.urls.issue, { waitUntil: 'domcontentloaded' });
  await settle(page, 6000);

  const { frame, added } = await ensurePanel(page);
  if (added) {
    log('state', { phase: 'panel-added' });
    await page.waitForTimeout(2500);
  }
  if (!frame) {
    log('warn', { message: 'Fleet panel not available on this ticket' });
    await page.waitForTimeout(4000);
    return;
  }

  // The panel mounts before it has data: the grid renders dashes first and is
  // replaced when the resolver answers. Filming that is a shot of a loading
  // skeleton, so wait for a real value before recording.
  const loaded = await waitForPanelData(page, frame, log);

  // The panel sits below Jira's description and attachments. Scroll it to the
  // top of the viewport so the grid, the log and the buttons are all in frame.
  await frame.locator('text=Fleet').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(1200);

  const state = await panelState(frame);
  log('state', { expectStatus, loaded, ...state, text: undefined });
  if (expectStatus && state.status && state.status !== expectStatus) {
    log('warn', { message: `expected "${expectStatus}" but panel shows "${state.status}"` });
  }

  // Land the pointer on the worker value, then travel down to the run log.
  const workerValue = frame.locator('text=WORKER').first();
  await hoverAndLog(page, workerValue, log);
  await page.waitForTimeout(3200);

  const runLog = frame.locator('text=/Run log/i').first();
  if (await runLog.count()) {
    await runLog.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(800);
    const box = await runLog.boundingBox();
    if (box) {
      log('hover', { x: Math.round(box.x + 40), y: Math.round(box.y + 14) });
      await page.waitForTimeout(3200);
    }
  }
  await page.waitForTimeout(1200);
}

// Wait until the panel has real values rather than its loading dashes.
async function waitForPanelData(page, frame, log, { timeoutMs = 25000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await frame.locator('body').innerText().catch(() => '');
    const lines = text.split('\n').map((l) => l.trim());
    const statusAt = lines.findIndex((l) => l.toLowerCase() === 'status');
    const value = statusAt === -1 ? null : lines.slice(statusAt + 1).find(Boolean);
    if (value && value !== '—' && /^(Backlog|Triaged|Ready for Build|In Build|In Review|Done|Failed)$/i.test(value)) {
      return true;
    }
    await page.waitForTimeout(500);
  }
  log('warn', { message: 'panel values never loaded' });
  return false;
}

async function takePr(page, { log }) {
  const prUrl = readCaptureConfig().takes.prUrl;
  if (!prUrl) {
    log('warn', { message: 'no prUrl recorded; open the PR URL and save it with --set-pr' });
    return;
  }
  await page.goto(prUrl, { waitUntil: 'domcontentloaded' });
  await settle(page, 3500);
  await page.mouse.move(760, 420);
  log('hover', { x: 760, y: 420 });
  await page.waitForTimeout(2500);
  // Scroll to the checks and acceptance-criteria block, which is the point of the shot.
  await page.mouse.wheel(0, 520);
  log('scroll', { dy: 520 });
  await page.waitForTimeout(3000);
}

async function takeSettings(page, { log }) {
  if (!config.urls.settings) {
    log('warn', { message: 'settings URL not configured in capture.config.json' });
    return;
  }
  await page.goto(config.urls.settings, { waitUntil: 'domcontentloaded' });
  await settle(page, 5000);

  // Walk down the page so the sweep reads as a tour, not a static screenshot.
  for (const [dy, hold] of [[320, 2200], [320, 2600], [300, 2400]]) {
    await page.mouse.move(800, 500);
    await page.mouse.wheel(0, dy);
    log('scroll', { dy });
    await page.waitForTimeout(hold);
  }

  const test = page.getByRole('button', { name: /test connection/i }).first();
  if (await test.count()) {
    await test.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await clickAndLog(page, test, log, 'test-connection');
    await page.waitForTimeout(4500);
    log('state', { validation: 'shown' });
  } else {
    log('warn', { message: 'Test connection button not found' });
  }
}

const TAKES = {
  dispatch: { run: takeDispatch },
  'panel-live': { run: (p, c) => takePanel(p, c, { expectStatus: 'In Build' }) },
  'panel-review': { run: (p, c) => takePanel(p, c, { expectStatus: 'In Review' }) },
  pr: { run: takePr },
  settings: { run: takeSettings },
};

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const headed = args.includes('--headed');
  const prune = args.includes('--prune');
  const setPrIndex = args.indexOf('--set-pr');
  // A value passed to --set-pr is not a take name.
  const consumed = new Set(setPrIndex !== -1 ? [setPrIndex, setPrIndex + 1] : []);
  const wanted = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));

  if (setPrIndex !== -1) {
    const url = args[setPrIndex + 1];
    const cfg = readCaptureConfig();
    cfg.takes = { ...cfg.takes, prUrl: url };
    writeCaptureConfig(cfg);
    console.log(`saved prUrl: ${url}`);
    return;
  }

  if (dry) {
    await runDry({ headed, prune });
    return;
  }

  if (!hasSession()) {
    console.error('No saved Jira session. Run `node scripts/capture-login.mjs` first.');
    process.exit(2);
  }

  const names = wanted.length === 0 || wanted.includes('all') ? Object.keys(TAKES) : wanted;
  const browser = await launchBrowser({ headed });

  for (const name of names) {
    const take = TAKES[name];
    if (!take) {
      console.error(`unknown take "${name}" (have: ${Object.keys(TAKES).join(', ')})`);
      continue;
    }
    process.stdout.write(`recording ${name}… `);
    try {
      const events = await recordTake(browser, {
        name,
        startUrl: null,
        run: async (page, ctx) => take.run(page, ctx),
      });
      console.log(`${events.length} events`);
    } catch (err) {
      console.log(`FAILED: ${err.message.split('\n')[0]}`);
    }
  }

  await browser.close();
  console.log('done. Clips are in public/footage/.');
}

// --dry records the board with no session: it proves browser launch, video
// writing and event capture in one shot, without touching the tenant.
async function runDry({ headed, prune }) {
  if (prune) {
    const dir = path.join(DEMO_ROOT, 'public', 'footage');
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
      console.log(`cleared ${dir}`);
    }
  }

  console.log(`session: ${hasSession() ? 'found' : 'none (login redirect expected)'}`);
  const browser = await launchBrowser({ headed });
  const events = await recordTake(browser, {
    name: 'dry-board',
    startUrl: config.urls.board,
    storageState: loadSession(),
    run: async (page, { log }) => {
      await page.waitForTimeout(2500);
      log('hover', { x: 640, y: 360 });
      await page.waitForTimeout(1500);
      const title = await page.title().catch(() => '(none)');
      log('state', { title, url: page.url() });
      console.log(`landed: ${page.url()}`);
      console.log(`title:  ${title}`);
    },
  });
  await browser.close();

  const clip = path.join(DEMO_ROOT, 'public', 'footage', 'dry-board.webm');
  const ok = fs.existsSync(clip);
  console.log(`clip:   ${ok ? path.relative(DEMO_ROOT, clip) : 'MISSING'} (${ok ? (fs.statSync(clip).size / 1024).toFixed(0) : 0} KB)`);
  console.log(`events: ${events.length}`);
  console.log(ok ? '\nDRY RUN PASSED — harness can record.' : '\nDRY RUN FAILED — no clip written.');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`capture failed: ${err.stack || err.message}`);
  process.exit(1);
});
