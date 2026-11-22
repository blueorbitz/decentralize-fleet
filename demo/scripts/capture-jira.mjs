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

// The Forge issue panel renders in an iframe. Find the frame that actually has
// the Fleet panel in it, by text rather than by a brittle selector.
async function findFrameWithText(page, text, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const found = await frame.locator(`text=${text}`).first().count();
        if (found > 0) return frame;
      } catch {
        /* frame navigated or detached; try the next one */
      }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

// Jira's own chrome is slow and noisy. Wait for network to settle, but never
// fail the take because a background poll never stops.
async function settle(page, ms = 2500) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(ms);
}

async function takeDispatch(page, { log }) {
  await settle(page, 3000);

  // Land on the issue, not the board: the panel is what this take is about.
  await page.goto(config.urls.issue, { waitUntil: 'domcontentloaded' });
  await settle(page, 4000);

  const panel = await findFrameWithText(page, 'Fleet', { timeoutMs: 20000 });
  const frame = panel || page;

  const dispatch = frame.getByRole('button', { name: /dispatch to fleet|mark fleet-ready/i }).first();
  if (await dispatch.count()) {
    await dispatch.scrollIntoViewIfNeeded().catch(() => {});
    await hoverAndLog(page, dispatch, log);
    await page.waitForTimeout(600);
    await clickAndLog(page, dispatch, log, 'dispatch');
    // The panel refetches after the write; hold long enough to see the pill flip.
    await page.waitForTimeout(5000);
    log('state', { status: 'Ready for Build' });
  } else {
    // No button means we are not on a Triaged/Ready ticket. Record what is there
    // so the failure is visible rather than silent.
    log('warn', { message: 'Dispatch button not found; panel state captured as-is' });
    await page.waitForTimeout(3000);
  }
}

async function takePanel(page, { log }, { expectStatus }) {
  await page.goto(config.urls.issue, { waitUntil: 'domcontentloaded' });
  await settle(page, 4500);

  const panel = await findFrameWithText(page, 'Fleet', { timeoutMs: 20000 });
  const frame = panel || page;

  // Move the pointer over the panel so the cursor is visible and intentional.
  const heading = frame.locator('text=Fleet').first();
  await hoverAndLog(page, heading, log);

  // Hold on the grid (worker / lease / status), then drift to the run log.
  await page.waitForTimeout(3500);
  const runLog = frame.locator('text=/Run log/i').first();
  if (await runLog.count()) {
    const box = await runLog.boundingBox();
    if (box) {
      log('hover', { x: Math.round(box.x + 40), y: Math.round(box.y + 12) });
      await page.waitForTimeout(2200);
    }
  }
  log('state', { status: expectStatus });
  await page.waitForTimeout(1500);
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
  const wanted = args.filter((a) => !a.startsWith('--') && a !== args[setPrIndex + 1]);

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
