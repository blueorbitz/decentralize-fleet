#!/usr/bin/env node
// Script adapter — a deterministic, dependency-free harness used by the tests
// and by `--dry-run`. It honours the same JSON contract as a real adapter but
// does no agent work, so the whole worker protocol can be exercised offline.
//
// Knobs (env):
//   FLEET_SCRIPT_MODE      ok (default) | fail | hang
//   FLEET_SCRIPT_FILE      repo-relative file to write on success
//   FLEET_SCRIPT_CONTENT   content for that file
//   FLEET_SCRIPT_SUMMARY   override the result summary
//   FLEET_SCRIPT_HANG_MS   how long to hang in `hang` mode
//   FLEET_SCRIPT_RUN_TESTS 1 to actually run the repo's test command
import fs from 'node:fs';
import path from 'node:path';
import { readStdin, emitResult, progress, runTests, writeHarnessLog } from './_lib.mjs';

const input = await readStdin();
const mode = process.env.FLEET_SCRIPT_MODE || 'ok';
const logPath = writeHarnessLog(input.log_dir, `${input.ticket_key}-script`, `# script adapter mode=${mode}\n`);
progress(`[script] mode=${mode} ticket=${input.ticket_key}`);

if (mode === 'hang') {
  const ms = Number(process.env.FLEET_SCRIPT_HANG_MS) || 600_000;
  progress(`[script] hanging for ${ms}ms`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

if (mode === 'fail') {
  emitResult({
    status: 'failed',
    summary: process.env.FLEET_SCRIPT_SUMMARY || 'script adapter forced failure',
    tests: { ran: 1, passed: 0 },
    harness: 'script',
    log_path: logPath,
  });
  process.exit(0);
}

if (process.env.FLEET_SCRIPT_FILE) {
  const target = path.join(input.repo_path, process.env.FLEET_SCRIPT_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, process.env.FLEET_SCRIPT_CONTENT ?? `# ${input.ticket_key}\n${input.summary}\n`);
  progress(`[script] wrote ${process.env.FLEET_SCRIPT_FILE}`);
}

let counts = { ran: 1, passed: 1 };
if (process.env.FLEET_SCRIPT_RUN_TESTS === '1') {
  const res = await runTests(input.repo_path, { timeoutMs: 300_000 });
  counts = res.counts;
}

emitResult({
  status: 'ok',
  summary: process.env.FLEET_SCRIPT_SUMMARY || `script adapter handled ${input.ticket_key}`,
  tests: counts,
  harness: 'script',
  log_path: logPath,
});
