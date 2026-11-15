#!/usr/bin/env node
// Command Code (cmdc) adapter — the fleet's real, tested harness integration.
//
// The design doc names GitHub Copilot as the demo harness, but the working
// implementation drives `cmdc` (Command Code) so the fleet can be developed and
// tested end to end. The adapter is harness-blind to the worker: it consumes
// the JSON contract on stdin and prints the JSON result on stdout.
//
// cmdc is invoked in non-interactive mode (`-p`) with the NDJSON event stream
// (`--output-format json`); the prompt is piped on stdin, which sidesteps all
// shell-quoting hazards for multi-line ticket text.
import { readStdin, emitResult, progress, contextPrompt, runStreaming, runTests, writeHarnessLog, readTimeoutSeconds } from './_lib.mjs';

function cmdcArgs() {
  const args = ['-p', '--output-format', 'json', '--no-auto-update', '--skip-onboarding', '--trust'];
  const mode = process.env.CMDC_PERMISSION_MODE || 'yolo';
  if (mode && mode !== 'none') args.push('--permission-mode', mode);
  if (process.env.CMDC_MODEL) args.push('--model', process.env.CMDC_MODEL);
  if (process.env.CMDC_EXTRA_ARGS) args.push(...process.env.CMDC_EXTRA_ARGS.split(' ').filter(Boolean));
  return args;
}

// Pull the final assistant text and outcome out of the NDJSON stream.
export function parseCmdcStream(text) {
  const edited = new Set();
  let result = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj.type === 'result') {
      result = obj;
    } else if (obj.type === 'event' && obj.event) {
      const ev = obj.event;
      if (ev.type === 'tool_use' && (ev.name === 'write_file' || ev.name === 'edit_file')) {
        const p = ev.input?.file_path || ev.input?.path;
        if (p) edited.add(p);
      }
    }
  }
  return {
    ok: result?.subtype === 'success',
    finalText: result?.finalText || '',
    stopReason: result?.stopReason || null,
    editedFiles: [...edited],
  };
}

async function main() {
  const input = await readStdin();
  const bin = process.env.CMDC_BIN || 'cmdc';
  const args = cmdcArgs();
  const timeoutMs = readTimeoutSeconds(input) * 1000;
  const shell = process.platform === 'win32';

  progress(`[cmdc] ${bin} ${args.join(' ')}`);
  progress(`[cmdc] cwd=${input.repo_path} timeout=${Math.round(timeoutMs / 1000)}s`);

  const res = await runStreaming(bin, args, {
    cwd: input.repo_path,
    timeoutMs,
    stdin: contextPrompt(input),
    shell,
    onLine: (line) => {
      if (!line.trim().startsWith('{')) return;
      try {
        const obj = JSON.parse(line);
        const ev = obj.event;
        if (obj.type === 'event' && ev?.type === 'tool_completed') progress(`[cmdc] ${ev.toolName}`);
        else if (obj.type === 'event' && ev?.type === 'turn_end') progress(`[cmdc] turn ${ev.turnNumber} (tools: ${ev.hadToolCalls})`);
      } catch {
        /* partial line */
      }
    },
  });

  const parsed = parseCmdcStream(res.stdout);
  const logPath = writeHarnessLog(
    input.log_dir,
    `${input.ticket_key}-cmdc`,
    [`# cmdc ${bin} ${args.join(' ')}`, `# cwd ${input.repo_path}`, '', res.stdout, res.stderr].join('\n'),
  );

  const tests = await runTests(input.repo_path, { timeoutMs: Math.min(timeoutMs, 900_000), onLine: (l) => progress(`[tests] ${l}`) });
  const ok = parsed.ok && !res.timedOut && tests.exitCode !== 1;

  emitResult({
    status: ok ? 'ok' : 'failed',
    summary: summarize(parsed, { res, tests }),
    tests: tests.counts,
    tests_command: tests.command,
    edited_files: parsed.editedFiles,
    harness: 'cmdc',
    exit_code: res.code,
    timed_out: res.timedOut,
    log_path: logPath,
  });
}

function summarize(parsed, { res, tests }) {
  const bits = [];
  if (res.timedOut) bits.push('timed out');
  if (parsed.finalText) bits.push(parsed.finalText.trim());
  if (parsed.editedFiles.length) bits.push(`edited ${parsed.editedFiles.length} file(s)`);
  if (tests.command) bits.push(`tests ${tests.counts.passed ?? '?'}/${tests.counts.ran ?? '?'}`);
  if (!bits.length) bits.push(res.code === 0 ? 'cmdc completed' : `cmdc exited ${res.code}`);
  return bits.join(' — ').slice(0, 2000);
}

main().catch((err) => {
  emitResult({ status: 'failed', summary: `cmdc adapter error: ${err.message}`, log_path: null });
  process.exit(0);
});
