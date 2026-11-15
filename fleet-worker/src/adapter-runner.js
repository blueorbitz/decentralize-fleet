// Worker-side adapter runner.
//
// The daemon is harness-blind: it hands the adapter the JSON contract on stdin
// and reads the JSON result from stdout. This is the only place the worker
// touches a harness, so swapping cmdc for Copilot/Kiro changes nothing else.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADAPTERS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'adapters');

export function resolveAdapter(name, adapterPath) {
  if (adapterPath) {
    const resolved = path.resolve(adapterPath);
    if (/\.(mjs|cjs|js)$/i.test(resolved)) return { command: process.execPath, args: [resolved] };
    return { command: resolved, args: [] };
  }
  const file = path.join(ADAPTERS_DIR, `${name}.mjs`);
  if (!fs.existsSync(file)) {
    throw new Error(`unknown adapter "${name}" (looked for ${file})`);
  }
  return { command: process.execPath, args: [file] };
}

// The result is the last JSON object the adapter printed on stdout.
export function parseAdapterOutput(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].startsWith('{')) continue;
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

/**
 * Run one adapter invocation. Never throws; a crash, non-JSON output or timeout
 * becomes a `failed` result so the worker's failure paths are exercised.
 */
export function runAdapter({ adapter, adapterPath, input, timeoutMs = 0, logFile, logger } = {}) {
  return new Promise((resolve) => {
    let command;
    let args;
    try {
      ({ command, args } = resolveAdapter(adapter, adapterPath));
    } catch (err) {
      resolve({ status: 'failed', summary: err.message, tests: { ran: null, passed: null }, log_path: logFile, adapter });
      return;
    }

    let child;
    try {
      child = spawn(command, args, { cwd: input.repo_path, env: process.env });
    } catch (err) {
      resolve({ status: 'failed', summary: `cannot start adapter: ${err.message}`, tests: { ran: null, passed: null }, log_path: logFile, adapter });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs) : null;

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      if (logger) {
        for (const line of text.split(/\r?\n/)) if (line.trim()) logger.debug(`  ${line}`);
      }
    });

    const finish = (code) => {
      if (timer) clearTimeout(timer);
      const combined = [
        `# adapter=${adapter} exit=${code} timed_out=${timedOut}`,
        '',
        '# --- adapter stdout ---',
        stdout,
        '# --- adapter stderr ---',
        stderr,
      ].join('\n');
      if (logFile) {
        fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });
        fs.writeFileSync(logFile, combined);
      }
      const parsed = parseAdapterOutput(stdout) || {
        status: 'failed',
        summary: timedOut ? 'adapter timed out' : 'adapter produced no JSON result',
        tests: { ran: null, passed: null },
      };
      resolve({
        ...parsed,
        status: timedOut ? 'failed' : parsed.status,
        log_path: parsed.log_path || logFile,
        exit_code: code,
        timed_out: timedOut,
        adapter,
      });
    };

    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      finish(-1);
    });
    child.on('close', (code) => finish(code ?? -1));
    child.stdin.end(JSON.stringify(input));
  });
}
