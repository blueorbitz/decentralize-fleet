// Tiny structured logger. Writes timestamped lines to stdout/stderr and, when
// a run log path is supplied, mirrors them into that file so the PR body and
// the issue panel can show a run-log tail.
import fs from 'node:fs';
import path from 'node:path';

function ts() {
  return new Date().toISOString().slice(11, 19);
}

export class Logger {
  constructor({ verbose = false, file = null } = {}) {
    this.verbose = verbose;
    this.file = file;
    this.stream = null;
    if (file) {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      this.stream = fs.createWriteStream(file, { flags: 'a' });
    }
  }

  line(level, msg, extra) {
    const text = `${ts()}  ${msg}${extra === undefined ? '' : `  ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`}`;
    const prefix = level === 'error' ? '[err] ' : level === 'warn' ? '[warn] ' : level === 'debug' ? '[dbg] ' : '';
    const out = `${prefix}${text}`;
    if (this.stream) this.stream.write(`${out}\n`);
    const show = level !== 'debug' || this.verbose;
    if (show) {
      if (level === 'error') process.stderr.write(`${out}\n`);
      else process.stdout.write(`${out}\n`);
    }
    return out;
  }

  info(msg, extra) {
    return this.line('info', msg, extra);
  }

  warn(msg, extra) {
    return this.line('warn', msg, extra);
  }

  error(msg, extra) {
    return this.line('error', msg, extra);
  }

  debug(msg, extra) {
    return this.line('debug', msg, extra);
  }

  async close() {
    if (!this.stream) return;
    await new Promise((resolve) => this.stream.end(resolve));
  }
}
