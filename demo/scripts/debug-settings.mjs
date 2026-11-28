// Capture the settings page's console errors to find which component the UI Kit
// renderer is rejecting.
//
//   node scripts/debug-settings.mjs
import { VIEWPORT, launchBrowser, loadSession } from './capture-lib.mjs';

const SETTINGS =
  'https://captain-sage.atlassian.net/jira/software/c/projects/FLT/settings/apps/f3d9b563-6c87-4cd5-a0c3-28b071dbc637/56bfe2a7-989d-44c6-b51e-174e38463006';

async function main() {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, storageState: loadSession() });
  const page = await context.newPage();

  const messages = [];
  page.on('console', (m) => messages.push(`[${m.type()}] ${m.text().slice(0, 400)}`));
  page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message.slice(0, 400)}`));

  await page.goto(SETTINGS, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(15000);

  // The app renders inside a frame; read its body for the error text.
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const body = await frame.locator('body').innerText().catch(() => '');
    console.log(`\n=== app frame (${body.length} chars) ===`);
    console.log(body.slice(0, 2000) || '(empty)');
  }

  console.log('\n=== console ===');
  for (const m of messages.slice(-25)) console.log(m);

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
