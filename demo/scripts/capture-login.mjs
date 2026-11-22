// One-time Jira login for the capture scripts.
//
// Opens a real browser window so you can sign in however your site requires
// (SSO, MFA, whatever). When you are on the board, press Enter here and the
// session is saved to demo/.auth/jira.json. Every other take reuses it, so this
// is the only manual step in the whole capture.
//
//   node scripts/capture-login.mjs
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { AUTH_FILE, DEMO_ROOT, VIEWPORT, launchBrowser } from './capture-lib.mjs';

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => {
    rl.close();
    resolve();
  }));
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(DEMO_ROOT, 'capture.config.json'), 'utf8'));
  const browser = await launchBrowser({ headed: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  await page.goto(`${config.site}/jira/software/projects/${config.project}/boards`, {
    waitUntil: 'domcontentloaded',
  });

  console.log('\nA browser window is open. Sign in to Jira, then navigate to the FLT board if it did not land there.');
  await waitForEnter('Press Enter once the board is visible…  ');

  const url = page.url();
  if (/login|id\.atlassian\.com/i.test(url)) {
    console.error(`\nStill on a login page (${url}). Sign in fully, then run this again.`);
    await browser.close();
    process.exit(2);
  }

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });
  console.log(`\nSaved session to ${path.relative(DEMO_ROOT, AUTH_FILE)}`);
  console.log(`Landing URL was ${url}`);

  await browser.close();
}

main().catch((err) => {
  console.error(`login failed: ${err.message}`);
  process.exit(1);
});
