#!/usr/bin/env node
// OpenCode adapter — drives the `opencode` CLI (sst/opencode) as a fleet harness.
//
// `opencode run` is invoked in non-interactive mode with the NDJSON event stream
// (`--format json`). The prompt is piped on stdin, which sidesteps shell-quoting
// hazards for multi-line ticket text. `--standalone` gives the run a private
// server instead of the user's background service, so a fleet worker cannot
// contend with an interactive session; `--archived` keeps scripted sessions out
// of the session list.
//
// Tune with OPENCODE_BIN, OPENCODE_MODEL (default opencode/beam-free — the free
// model, for testing), OPENCODE_AGENT, OPENCODE_EXTRA_ARGS, and
// OPENCODE_STANDALONE=0 / OPENCODE_ARCHIVED=0 to drop those flags.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin, emitResult, progress, contextPrompt, runStreaming, runTests, writeHarnessLog, readTimeoutSeconds } from './_lib.mjs';

const DEFAULT_MODEL = 'opencode/beam-free';

// Tools that write to disk. opencode's write/edit tools carry the target at
// `state.input.path` (verified against v2.3.2).
const EDIT_TOOLS = new Set(['write', 'edit']);

function editedPath(part) {
  const input = part.state?.input;
  if (!EDIT_TOOLS.has(part.tool) || !input) return null;
  return input.path || null;
}

function opencodeArgs() {
  const args = ['run', '--model', process.env.OPENCODE_MODEL || DEFAULT_MODEL, '--format', 'json', '--auto'];
  if (process.env.OPENCODE_AGENT) args.push('--agent', process.env.OPENCODE_AGENT);
  if (process.env.OPENCODE_STANDALONE !== '0') args.push('--standalone');
  if (process.env.OPENCODE_ARCHIVED !== '0') args.push('--archived');
  if (process.env.OPENCODE_EXTRA_ARGS) args.push(...process.env.OPENCODE_EXTRA_ARGS.split(' ').filter(Boolean));
  return args;
}

// Pull the final assistant text, edited files and stream-level errors out of the
// NDJSON stream. Tool-level failures are normal agent behaviour (a bad command,
// a retried edit) and are not fatal; only `type: "error"` events are.
export function parseOpencodeStream(text) {
  const edited = new Set();
  const errors = [];
  let finalText = '';
  let stopReason = null;
  let sessionId = null;
  let steps = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj.sessionID) sessionId = obj.sessionID;
    if (obj.type === 'error') {
      errors.push(obj.error?.message || 'opencode reported an error');
      continue;
    }
    const part = obj.part;
    if (!part) continue;
    if (obj.type === 'text' && part.type === 'text') {
      if (part.text) finalText = part.text;
    } else if (obj.type === 'tool_use') {
      const target = editedPath(part);
      if (target) edited.add(target);
    } else if (obj.type === 'step_finish') {
      stopReason = part.reason || stopReason;
      steps += 1;
    }
  }
  return { errors, finalText, stopReason, editedFiles: [...edited], sessionId, steps };
}

async function main() {
  const input = await readStdin();
  const bin = process.env.OPENCODE_BIN || 'opencode';
  const args = opencodeArgs();
  const timeoutMs = readTimeoutSeconds(input) * 1000;
  const shell = process.platform === 'win32';

  progress(`[opencode] ${bin} ${args.join(' ')}`);
  progress(`[opencode] cwd=${input.repo_path} timeout=${Math.round(timeoutMs / 1000)}s`);

  const res = await runStreaming(bin, args, {
    cwd: input.repo_path,
    timeoutMs,
    stdin: contextPrompt(input),
    shell,
    onLine: (line) => {
      if (!line.trim().startsWith('{')) return;
      try {
        const obj = JSON.parse(line);
        const part = obj.part;
        if (obj.type === 'tool_use' && part?.tool) progress(`[opencode] tool ${part.tool}`);
        else if (obj.type === 'step_finish') progress(`[opencode] step ${part?.reason || 'done'}`);
        else if (obj.type === 'error') progress(`[opencode] error ${obj.error?.message || ''}`);
      } catch {
        /* partial line */
      }
    },
  });

  const parsed = parseOpencodeStream(res.stdout);
  const logPath = writeHarnessLog(
    input.log_dir,
    `${input.ticket_key}-opencode`,
    [`# opencode ${bin} ${args.join(' ')}`, `# cwd ${input.repo_path}`, '', res.stdout, res.stderr].join('\n'),
  );

  const tests = await runTests(input.repo_path, { timeoutMs: Math.min(timeoutMs, 900_000), onLine: (l) => progress(`[tests] ${l}`) });
  const ok = res.code === 0 && !res.timedOut && parsed.errors.length === 0 && tests.exitCode !== 1;

  emitResult({
    status: ok ? 'ok' : 'failed',
    summary: summarize(parsed, { res, tests }),
    tests: tests.counts,
    tests_command: tests.command,
    edited_files: parsed.editedFiles,
    harness: 'opencode',
    model: process.env.OPENCODE_MODEL || DEFAULT_MODEL,
    session_id: parsed.sessionId,
    exit_code: res.code,
    timed_out: res.timedOut,
    log_path: logPath,
  });
}

function summarize(parsed, { res, tests }) {
  const bits = [];
  if (res.timedOut) bits.push('timed out');
  if (parsed.errors.length) bits.push(parsed.errors.join('; '));
  if (parsed.finalText) bits.push(parsed.finalText.trim());
  if (parsed.editedFiles.length) bits.push(`edited ${parsed.editedFiles.length} file(s)`);
  if (tests.command) bits.push(`tests ${tests.counts.passed ?? '?'}/${tests.counts.ran ?? '?'}`);
  if (!bits.length) bits.push(res.code === 0 ? 'opencode completed' : `opencode exited ${res.code}`);
  return bits.join(' — ').slice(0, 2000);
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main().catch((err) => {
    emitResult({ status: 'failed', summary: `opencode adapter error: ${err.message}`, log_path: null });
    process.exit(0);
  });
}
