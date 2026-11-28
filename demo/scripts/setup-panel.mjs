// Add the Fleet panel to an issue *before* recording.
//
// Jira only mounts a Forge issue panel on an issue once it has been added via
// "View app actions" > Fleet, and adding it requires a page reload. Doing that
// during a take would put menu clicks in the middle of the shot, so it is setup:
// run this, then record.
//
//   node scripts/setup-panel.mjs FLT-2
import { VIEWPORT, launchBrowser, loadSession } from './capture-lib.mjs';

const MARKERS = ['retry budget', 'acceptance criteria', 'run log'];
const site = 'https://captain-sage.atlassian.net';

function looksLikePanel(body) {
  const lower = body.toLowerCase();
  return MARKERS.filter((m) => lower.includes(m)).length >= 2;
}

async function panelBody(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const body = await frame.locator('body').innerText().catch(() => '');
      if (looksLikePanel(body)) return body;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function main() {
  const key = process.argv[2];
  if (!key) throw new Error('usage: setup-panel.mjs <KEY>');

  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, storageState: loadSession() });
  const page = await context.newPage();

  await page.goto(`${site}/browse/${key}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  if (await panelBody(page, 12000)) {
    console.log(`${key}: panel already present, nothing to do`);
    await browser.close();
    return;
  }

  const trigger = page.getByRole('button', { name: /view app actions/i }).first();
  if (!(await trigger.count())) throw new Error('no "View app actions" button on this issue');
  await trigger.click();
  await page.waitForTimeout(1500);

  const entry = page.getByRole('menuitem', { name: /^fleet$/i }).first();
  if (!(await entry.count())) throw new Error('no Fleet entry in the app-actions menu');
  await entry.click();
  await page.waitForTimeout(2500);

  // Adding does not mount the panel in this view; reload to render it.
  await page.reload({ waitUntil: 'domcontentloaded' });

  const body = await panelBody(page, 25000);
  console.log(body ? `${key}: panel added and rendering` : `${key}: panel still not rendering`);
  await browser.close();
  if (!body) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
