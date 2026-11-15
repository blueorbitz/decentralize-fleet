#!/usr/bin/env node
// GitHub Copilot adapter.
//
// This is the integration the design doc (grill Low #2, revised) names as the
// demo's deep pick: the GitHub Copilot CLI in non-interactive / autopilot mode
// (`copilot -p`), authenticated with a GitHub token that has Copilot access.
//
// It is provided for parity with the documentation. It is NOT exercised by the
// test suite here — the working, tested path is the cmdc adapter — so treat it
// as a reference implementation: verify flag names against your installed
// `copilot` CLI (`copilot --help`) before use, and override with COPILOT_ARGS.
import { readStdin, emitResult, progress, contextPrompt, runStreaming, runTests, writeHarnessLog, readTimeoutSeconds } from './_lib.mjs';

function copilotArgs() {
  const args = (process.env.COPILOT_ARGS ? process.env.COPILOT_ARGS.split(' ') : ['-p', '--allow-all-tools']).filter(Boolean);
  if (process.env.COPILOT_MODEL) args.push('--model', process.env.COPILOT_MODEL);
  return args;
}

async function main() {
  const input = await readStdin();
  const bin = process.env.COPILOT_BIN || 'copilot';
  const args = copilotArgs();
  const timeoutMs = readTimeoutSeconds(input) * 1000;
  const shell = process.platform === 'win32';

  progress(`[copilot] ${bin} ${args.join(' ')} (cwd=${input.repo_path})`);

  const res = await runStreaming(bin, args, {
    cwd: input.repo_path,
    timeoutMs,
    stdin: contextPrompt(input),
    shell,
  });

  const logPath = writeHarnessLog(
    input.log_dir,
    `${input.ticket_key}-copilot`,
    [`# copilot ${bin} ${args.join(' ')}`, '', res.stdout, res.stderr].join('\n'),
  );
  const tests = await runTests(input.repo_path, { timeoutMs: Math.min(timeoutMs, 900_000) });
  const ok = res.code === 0 && !res.timedOut && tests.exitCode !== 1;

  emitResult({
    status: ok ? 'ok' : 'failed',
    summary: (res.stdout.trim() || res.stderr.trim() || `copilot exited ${res.code}`).slice(0, 2000),
    tests: tests.counts,
    tests_command: tests.command,
    harness: 'copilot',
    exit_code: res.code,
    timed_out: res.timedOut,
    log_path: logPath,
  });
}

main().catch((err) => {
  emitResult({ status: 'failed', summary: `copilot adapter error: ${err.message}`, log_path: null });
  process.exit(0);
});
