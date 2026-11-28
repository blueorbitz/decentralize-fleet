// Is the Fleet panel present on this issue right now? Prints the iframe count,
// the panel markers found, and the panel's first lines.
//
//   node scripts/check-panel.mjs FLT-5
import { VIEWPORT, launchBrowser, loadSession } from './capture-lib.mjs';

const key = process.argv[2] || 'FLT-5';
const site = 'https://captain-sage.atlassian.net';
const MARKERS = ['Run log', 'Retry budget', 'Acceptance criteria', 'Fleet Worker'];

async function main() {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, storageState: loadSession() });
  const page = await context.newPage();

  await page.goto(`${site}/browse/${key}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);

  const domIframes = await page.evaluate(() => document.querySelectorAll('iframe').length);
  console.log(`dom iframes: ${domIframes}`);
  console.log(`playwright frames: ${page.frames().length}`);

  for (const [i, frame] of page.frames().entries()) {
    const isMain = frame === page.mainFrame();
    console.log(`\n[${i}]${isMain ? ' MAIN' : ' IFRAME'} ${frame.url().slice(0, 90)}`);
    let body = '';
    try {
      body = await frame.locator('body').innerText({ timeout: 5000 });
    } catch (e) {
      console.log(`   unreadable: ${e.message.split('\n')[0].slice(0, 70)}`);
      continue;
    }
    console.log(`   length ${body.length}`);
    console.log(`   markers: ${MARKERS.filter((m) => body.includes(m)).join(', ') || 'none'}`);
    console.log(`   preview: ${body.slice(0, 220).replace(/\n+/g, ' | ')}`);
  }

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
