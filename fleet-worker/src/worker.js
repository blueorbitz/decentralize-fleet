// The worker daemon: poll → claim → verify → snapshot → git → run → heartbeat
// → report → transition (design doc Med #4 and DFD "Worker run protocol").
//
// One run at a time per worker. Every state change is a Jira write made
// directly with the bot token; Forge never sits in this path.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { JiraClient, JiraError, isLeaseStale } from './jira.js';
import { GitClient, branchFor } from './git.js';
import { createGitHost } from './git-host.js';
import { runAdapter } from './adapter-runner.js';
import { STATUS, jqlFor } from './config.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function tail(file, lines = 20) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export class Worker {
  constructor({ cfg, logger, jira, git, gitHost, sleep = defaultSleep, now = () => Date.now(), clock = () => new Date() }) {
    this.cfg = cfg;
    this.log = logger;
    this.jira = jira || new JiraClient({
      baseUrl: cfg.jira.baseUrl,
      email: cfg.jira.email,
      token: cfg.jira.token,
      project: cfg.jira.project,
      fields: cfg.jira.fields,
    });
    this.git = git || new GitClient({ dir: cfg.repo.path, remote: cfg.repo.remote, baseBranch: cfg.repo.baseBranch });
    this.host = gitHost || createGitHost(cfg.gitHost);
    this.sleep = sleep;
    this.now = now;
    this.clock = clock;
    this.workerId = cfg.worker.id;
    this.stopping = false;
  }

  stop() {
    this.stopping = true;
  }

  get logDir() {
    if (this.cfg.logFile) return path.dirname(path.resolve(this.cfg.logFile));
    return path.join(os.tmpdir(), 'fleet', this.workerId);
  }

  async pollOnce() {
    const jql = jqlFor(this.cfg);
    const claimable = await this.jira.findClaimable(jql);
    const summary = { found: claimable.length, completed: 0, requeued: 0, failed: 0, lost: 0 };
    if (!claimable.length) {
      this.log.debug('no claimable tickets');
      return summary;
    }
    this.log.info(`${claimable.length} claimable → ${claimable.map((t) => t.key).join(', ')}`);
    for (const ticket of claimable) {
      if (this.stopping) break;
      let outcome;
      try {
        outcome = await this.runTicket(ticket);
      } catch (err) {
        this.log.error(`run of ${ticket.key} errored: ${err.message}`);
        outcome = { status: 'failed', reason: err.message };
      }
      if (outcome.status === 'completed') summary.completed += 1;
      else if (outcome.status === 'requeued') summary.requeued += 1;
      else if (outcome.status === 'failed') summary.failed += 1;
      else if (outcome.status === 'lost' || outcome.status === 'abandoned') summary.lost += 1;
    }
    return summary;
  }

  async runLoop() {
    const { pollMinMs, pollMaxMs } = this.cfg.worker;
    while (!this.stopping) {
      try {
        await this.pollOnce();
      } catch (err) {
        this.log.error(`poll failed: ${err.message}`);
      }
      if (this.stopping) break;
      const wait = pollMinMs + Math.floor(Math.random() * Math.max(1, pollMaxMs - pollMinMs));
      this.log.debug(`sleeping ${Math.round(wait / 1000)}s`);
      await this.sleep(wait);
    }
    this.log.info('worker stopped');
  }

  async runTicket(ticket) {
    const key = ticket.key;
    const claimedAt = this.clock();

    // Step 2 — claim: the CAS status transition carries the worker + lease.
    this.log.info(`claim → transition ${STATUS.READY} → ${STATUS.IN_BUILD}  (CAS)`);
    let transition;
    try {
      transition = await this.jira.claim(key, { workerId: this.workerId, now: claimedAt });
    } catch (err) {
      if (err.status === 400) {
        // A 400 from the transitions endpoint is not necessarily a lost race.
        // It is also what Jira returns for a field that is not on the
        // transition's screen, or a value it will not accept. The only way to
        // tell them apart is to look at the ticket: a lost race means someone
        // else moved it off Ready, so if it is still Ready this was a real
        // error and must not be swallowed as "moving on".
        const current = await this.jira.getIssue(key, { fields: [] }).catch(() => null);
        const stillClaimable = current?.status === STATUS.READY;
        if (stillClaimable) {
          throw new JiraError(
            `claim failed for ${key} with HTTP 400 but the ticket is still "${STATUS.READY}", ` +
              `so this is not a lost race: ${err.message}`,
            { status: err.status, body: err.body },
          );
        }
        this.log.info(`${key} lost the claim race (now "${current?.status}") — moving on`);
        return { status: 'lost' };
      }
      throw err;
    }
    if (!transition) return { status: 'lost' };

    // Step 3 — verify: re-read and confirm we own the claim, else abandon.
    const fresh = await this.jira.getIssue(key, { fields: Object.values(this.cfg.jira.fields) });
    if (fresh.worker !== this.workerId) {
      this.log.warn(`verify failed — fleet_worker=${fresh.worker}, abandoning ${key}`);
      return { status: 'abandoned' };
    }
    this.log.info(`verify ok — fleet_worker=${this.workerId}`);
    await this.jira.comment(key, `Fleet worker \`${this.workerId}\` claimed this ticket (lease ${claimedAt.toISOString()}).`);

    // Step 4 — snapshot the ticket at claim time.
    const snapshot = {
      at: claimedAt.toISOString(),
      summary: fresh.summary,
      description: fresh.description,
      acceptanceCriteria: fresh.acceptanceCriteria,
      retry: fresh.retry ?? 0,
    };
    this.log.info(`snapshot ticket (summary/description/AC) @ ${snapshot.at}`);

    // Step 5 — git: reset to base, branch.
    const branch = branchFor(key, snapshot.summary);
    this.git.prepare();
    // prepare() resolves the base branch from the remote when it was not
    // configured, so read it back rather than trusting the config value.
    const baseBranch = this.git.baseBranch;
    const baseSha = this.git.resetHard();
    this.git.checkoutNewBranch(branch);
    this.log.info(`git reset origin/${baseBranch} @ ${baseSha.slice(0, 8)} · branch ${branch}`);

    // Step 6 — run the adapter (harness) with a heartbeat running alongside.
    const runLog = path.join(this.logDir, `${key}-${stamp(claimedAt)}.log`);
    const input = {
      ticket_key: key,
      summary: snapshot.summary,
      description: snapshot.description,
      acceptance_criteria: snapshot.acceptanceCriteria,
      repo_path: this.cfg.repo.path,
      base_branch: baseBranch,
      timeout_s: Math.round(this.cfg.timings.runTimeoutMs / 1000),
      snapshot_at: snapshot.at,
      log_dir: this.logDir,
      log_path: runLog,
    };

    const heartbeat = setInterval(() => {
      this.jira.refreshLease(key).then(
        () => this.log.debug(`heartbeat — lease refreshed for ${key}`),
        (err) => this.log.warn(`heartbeat failed: ${err.message}`),
      );
    }, this.cfg.timings.leaseRefreshMs);

    let result;
    try {
      this.log.info(`adapter=${this.cfg.worker.adapter} — running harness`);
      result = await runAdapter({
        adapter: this.cfg.worker.adapter,
        adapterPath: this.cfg.worker.adapterPath,
        input,
        timeoutMs: this.cfg.timings.runTimeoutMs,
        logFile: runLog,
        logger: this.log,
      });
    } finally {
      clearInterval(heartbeat);
    }
    this.log.info(`adapter status=${result.status}${result.tests?.ran != null ? ` tests=${result.tests.passed}/${result.tests.ran}` : ''}`);

    if (result.status !== 'ok') {
      return this.handleFailure(key, snapshot, {
        reason: result.timed_out ? 'run timed out' : result.summary || 'harness reported failure',
        logTail: tail(runLog),
      });
    }
    if (!this.git.hasChanges()) {
      return this.handleFailure(key, snapshot, {
        reason: 'harness produced no file changes',
        logTail: tail(runLog),
      });
    }

    // Step 8 — commit, push, open the PR (human merges; the fleet never does).
    const commitSha = this.git.commitAll(`${key}: ${snapshot.summary}`);
    this.git.push(branch);
    const body = buildPrBody({ key, snapshot, result, branch, baseBranch, workerId: this.workerId });
    const pr = await this.host.createPullRequest({
      title: `${key}: ${snapshot.summary}`,
      description: body,
      sourceBranch: branch,
      destinationBranch: baseBranch,
    });
    await this.jira.report(key, { branch, prUrl: pr.url });
    await this.jira.comment(
      key,
      `Fleet run finished on \`${this.workerId}\`.\n\n- Branch: \`${branch}\`\n- Commit: \`${commitSha.slice(0, 8)}\`\n- Pull request: ${pr.url || '(none)'}\n- Tests: ${result.tests?.passed ?? '?'}/${result.tests?.ran ?? '?'}\n\nAwaiting human review — the fleet never merges.`,
    );
    this.log.info(`pushed ${branch} · PR ${pr.url} · transition ${STATUS.IN_BUILD} → ${STATUS.IN_REVIEW}`);
    return { status: 'completed', branch, prUrl: pr.url, commitSha, tests: result.tests };
  }

  // One automatic requeue, then Failed (design doc Med #12).
  async handleFailure(key, snapshot, { reason, logTail = '' }) {
    const used = snapshot.retry ?? 0;
    if (used < this.cfg.retryBudget) {
      this.log.warn(`failure (${reason}) → requeue (retry ${used + 1}/${this.cfg.retryBudget})`);
      await this.jira.setFields(key, { [this.cfg.jira.fields.retry]: used + 1 });
      await this.jira.requeue(key, {
        reason: `Fleet requeued this ticket after a failed run (\`${reason}\`). Retry budget used: ${used + 1}/${this.cfg.retryBudget}.${logTail ? `\n\nLast log lines:\n{code}\n${logTail}\n{code}` : ''}`,
      });
      return { status: 'requeued', reason };
    }
    this.log.error(`failure (${reason}) → Failed (retry budget spent)`);
    await this.jira.reject(key, {
      reason: `Fleet moved this ticket to Failed after a second failure (\`${reason}\`). Retry budget spent: ${used}/${this.cfg.retryBudget}. A human must decide.${logTail ? `\n\nLast log lines:\n{code}\n${logTail}\n{code}` : ''}`,
    });
    return { status: 'failed', reason };
  }
}

export function buildPrBody({ key, snapshot, result, branch, baseBranch, workerId }) {
  const ac = (snapshot.acceptanceCriteria || '').split('\n').filter(Boolean);
  const acBlock = ac.length ? ac.map((a) => `- [x] ${a}`).join('\n') : '_No acceptance criteria on the ticket._';
  const tests = result.tests || {};
  const testLine = tests.ran != null ? `${tests.passed ?? '?'} passed, ${(tests.ran ?? 0) - (tests.passed ?? 0)} failed (of ${tests.ran})` : 'no test command detected';
  return [
    `## ${key}: ${snapshot.summary}`,
    '',
    'Opened automatically by the development fleet. **A human merges — the fleet never merges.**',
    '',
    '### What the run did',
    '',
    result.summary ? result.summary.trim() : '_No summary returned._',
    '',
    '### Acceptance criteria',
    '',
    acBlock,
    '',
    '### Tests',
    '',
    `- Command: ${result.tests_command ? `\`${result.tests_command}\`` : '_none_'}`,
    `- Result: ${testLine}`,
    '',
    '### Provenance',
    '',
    `- Worker: \`${workerId}\``,
    `- Adapter: \`${result.adapter}\``,
    `- Branch: \`${branch}\` → \`${baseBranch}\``,
    `- Ticket snapshotted at \`${snapshot.at}\` — live edits after this do not affect the run.`,
    result.log_path ? `- Run log: \`${result.log_path}\`` : '',
  ].filter((l) => l !== '').join('\n');
}

// --- reaper ---------------------------------------------------------------
// The scheduled half of the fleet (grill Low #7): scan In Build, requeue any
// claim whose lease is stale so a crashed worker self-heals in Jira.
export async function reap({ cfg, jira, logger, now = () => Date.now() }) {
  const inBuild = await jira.findInBuild();
  const stale = inBuild.filter((t) => isLeaseStale(t.lease, { now: now(), staleMs: cfg.timings.leaseStaleMs }));
  for (const t of stale) {
    logger.warn(`reaper: ${t.key} In Build, lease stale (worker=${t.worker}) → requeue`);
    await jira.setFields(t.key, { [cfg.jira.fields.retry]: (t.retry ?? 0) + 1 });
    await jira.requeue(t.key, {
      reason: `Requeued after lease expiry (worker \`${t.worker ?? 'unknown'}\`). Cleared fleet_worker and fleet_lease.`,
    });
  }
  logger.info(`reaper: scanned ${inBuild.length} In Build, requeued ${stale.length}`);
  return { scanned: inBuild.length, requeued: stale.length, keys: stale.map((t) => t.key) };
}
