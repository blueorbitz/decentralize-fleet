// Does a ticket exist in Jira, according to the *browser session* rather than
// the API token? Used to tell a deleted ticket apart from a rejected credential.
//
//   node scripts/check-issue.mjs FLT-1 FLT-6 FLT-7
import { VIEWPORT, launchBrowser, loadSession } from './capture-lib.mjs';

const keys = process.argv.slice(2);
const site = 'https://captain-sage.atlassian.net';

async function main() {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, storageState: loadSession() });
  const page = await context.newPage();

  for (const key of keys) {
    await page.goto(`${site}/browse/${key}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const body = await page.locator('body').innerText().catch(() => '');
    const missing = /can't find|does not exist|not found|没有查看的权限|事务不存在/i.test(body);
    const title = await page.title();
    console.log(`${key.padEnd(8)} ${missing ? 'MISSING' : 'EXISTS '}  title="${title}"`);
    if (!missing) {
      const status = /(Backlog|Triaged|Ready for Build|In Build|In Review|Done|Failed)/.exec(body)?.[1];
      console.log(`         status hint: ${status || '(none)'}`);
    }
  }

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
