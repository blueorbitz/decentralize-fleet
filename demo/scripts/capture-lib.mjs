// Shared Playwright plumbing for the demo capture scripts.
//
// Everything here exists to make a take repeatable: one browser resolver, one
// place that records video and cursor events, and one config file the edit reads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const DEMO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUTH_FILE = path.join(DEMO_ROOT, '.auth', 'jira.json');
export const FOOTAGE_DIR = path.join(DEMO_ROOT, 'public', 'footage');
export const CAPTURE_FILE = path.join(DEMO_ROOT, 'src', 'capture.json');

export const VIEWPORT = { width: 1600, height: 900 };

// The browser this machine actually has. Playwright's own Chromium is preferred
// (pinned, headless-friendly), then Edge, then a Playwright download. CHROME_PATH
// overrides all of it.
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Users/PakWai/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export async function launchBrowser({ headed = false } = {}) {
  const errors = [];
  for (const executablePath of CANDIDATES) {
    if (!fs.existsSync(executablePath)) continue;
    try {
      return await chromium.launch({ executablePath, headless: !headed });
    } catch (err) {
      errors.push(`${executablePath}: ${err.message.split('\n')[0]}`);
    }
  }
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: !headed });
    } catch (err) {
      errors.push(`${channel}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(`no usable browser found\n${errors.join('\n')}`);
}

export function hasSession() {
  return fs.existsSync(AUTH_FILE);
}

export function loadSession() {
  if (!hasSession()) return undefined;
  return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
}

// Record one take. Returns the events it saw, so the edit can draw a cursor at
// the exact place a click happened.
export async function recordTake(browser, { name, startUrl, storageState, run, headed }) {
  fs.mkdirSync(FOOTAGE_DIR, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    storageState: storageState || loadSession(),
    recordVideo: { dir: FOOTAGE_DIR, size: VIEWPORT },
    deviceScaleFactor: 1,
  });

  const started = Date.now();
  const events = [];
  const page = await context.newPage();

  // Playwright draws no pointer, so every interaction is logged and the video
  // gets a synthetic one composited at these coordinates.
  const log = (kind, extra = {}) => events.push({ at: Date.now() - started, kind, ...extra });
  let finalUrl = startUrl || '';
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) {
      finalUrl = f.url();
      log('navigate', { url: f.url() });
    }
  });

  let durationMs = 0;
  try {
    if (startUrl) await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    await run(page, { log, events });
  } finally {
    await page.waitForTimeout(400);
    durationMs = Date.now() - started;
    const video = page.video();
    await context.close();
    if (video) {
      const raw = await video.path();
      const target = path.join(FOOTAGE_DIR, `${name}.webm`);
      fs.rmSync(target, { force: true });
      fs.renameSync(raw, target);
      fs.writeFileSync(path.join(FOOTAGE_DIR, `${name}.events.json`), JSON.stringify(events, null, 2));

      // Register the take so the composition can find it without hard-coded paths.
      const config = readCaptureConfig();
      config.takes = {
        ...config.takes,
        [toKey(name)]: {
          src: `footage/${name}.webm`,
          events: events.filter((e) => e.x != null),
          durationMs,
          // The label shown in the window chrome. A login redirect is not what
          // the shot is about, so it is replaced with the destination.
          url: displayUrl(finalUrl, startUrl),
          offsetMs: config.offsetMs?.[name] ?? 0,
          trimBeforeSeconds: config.trim?.[name] ?? 0,
        },
      };
      writeCaptureConfig(config);
    }
  }

  return events;
}

// A short, honest label for the address bar: the Atlassian login hop is stripped
// so the chrome reads "captain-sage.atlassian.net/browse/FLT-101" as it does once
// the session is valid.
export function displayUrl(finalUrl, startUrl) {
  const candidate = /id\.atlassian\.com/i.test(finalUrl || '') ? startUrl : finalUrl;
  if (!candidate) return '';
  try {
    const u = new URL(candidate);
    return `${u.host}${u.pathname}`;
  } catch {
    return candidate;
  }
}

// dry-board -> dryBoard, panel-live -> panelLive
export function toKey(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// A click that lands at a known point and records it. Used for everything the
// cursor has to follow.
export async function clickAndLog(page, locator, log, label) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`cannot click ${label}: not visible`);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  log('hover', { x, y });
  await page.waitForTimeout(220);
  log('click', { x, y, label });
  await locator.click();
  return { x, y };
}

export async function hoverAndLog(page, locator, log) {
  const box = await locator.boundingBox();
  if (!box) return null;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  log('hover', { x, y });
  return { x, y };
}

export function readCaptureConfig() {
  try {
    return JSON.parse(fs.readFileSync(CAPTURE_FILE, 'utf8'));
  } catch {
    return { takes: {}, offsetMs: {} };
  }
}

export function writeCaptureConfig(config) {
  fs.mkdirSync(path.dirname(CAPTURE_FILE), { recursive: true });
  fs.writeFileSync(CAPTURE_FILE, `${JSON.stringify(config, null, 2)}\n`);
}

export function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}
