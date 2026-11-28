// The tenant readiness checks, shared by the settings page's "Test connection"
// and scripts/verify-setup.mjs.
//
// A save on the settings page runs exactly these checks and refuses on a
// failure (grill D5), so the page and the CLI cannot disagree about what
// "configured" means. The checks are the ones verify-setup always did:
// the project exists, each field id resolves, every board status exists, every
// required transition exists, and the Claim screen carries the worker/lease
// fields.
//
// Runtime-free: `jira` is a src/jira.js client, so this runs against the mock.
import { DEFAULT_FIELDS, STATUS, TRANSITION, jqlFor } from './config.js';

export const REQUIRED_TRANSITIONS = [
  [STATUS.TRIAGED, TRANSITION.MARK_READY, STATUS.READY],
  [STATUS.READY, TRANSITION.CLAIM, STATUS.IN_BUILD],
  [STATUS.IN_BUILD, TRANSITION.REQUEUE, STATUS.READY],
  [STATUS.IN_BUILD, TRANSITION.REJECT, STATUS.FAILED],
  [STATUS.IN_BUILD, TRANSITION.REPORT, STATUS.IN_REVIEW],
];

/**
 * Run every check and return both the structured result the UI renders and the
 * legacy log lines verify-setup prints. `record` is a settings record, or null
 * to validate the display-name defaults.
 *
 * @returns {{ ok: boolean, checks: Array<{ id: string, ok: boolean, lines: string[] }>,
 *             lines: string[] }}
 */
export async function validateConfig({ jira, record } = {}) {
  try {
    return await runChecks({ jira, record });
  } catch (err) {
    // A tenant that refuses or times out is a failed check, not a crash: the
    // page must be able to show it, and a save must be refused because of it.
    const failed = { id: 'jira', ok: false, lines: [`  FAIL  ${err.message}`] };
    return { ok: false, checks: [failed], lines: failed.lines };
  }
}

async function runChecks({ jira, record } = {}) {
  const lines = [];
  const add = (line) => lines.push(line);

  const project = record?.projectKey || 'FLT';
  const wantedFields = fieldEntries(record);

  const checks = [];
  // A check collects its own lines so the structured result and the log agree.
  const check = (id) => {
    const entry = { id, ok: true, lines: [] };
    checks.push(entry);
    const out = (line) => {
      entry.lines.push(line);
      add(line);
    };
    return {
      pass(msg) {
        out(`  ok    ${msg}`);
      },
      fail(msg) {
        entry.ok = false;
        out(`  FAIL  ${msg}`);
      },
      note(msg) {
        out(`  note  ${msg}`);
      },
      skip(msg) {
        out(`  skip  ${msg}`);
      },
      raw(msg) {
        out(msg);
      },
    };
  };

  if (!jira) {
    const c = check('jira');
    c.fail('no Jira client is available to validate against');
    return { ok: false, checks, lines };
  }

  // --- custom fields ------------------------------------------------------
  add('Custom fields');
  const fieldsCheck = check('fields');
  const allFields = await jira.request('GET', (tag) => tag`/rest/api/3/field`);
  const byName = new Map((allFields || []).map((f) => [f.name, f]));
  const byId = new Map((allFields || []).map((f) => [f.id, f]));
  const resolvedNames = {};
  for (const [key, value] of Object.entries(wantedFields)) {
    const found = byId.get(value) || byName.get(value);
    if (found) {
      resolvedNames[key] = found.name;
      fieldsCheck.pass(`${found.name.padEnd(14)} ${found.id}`);
    } else {
      resolvedNames[key] = value;
      fieldsCheck.fail(`${value} does not exist — run scripts/provision.mjs`);
    }
  }

  // --- project and board ---------------------------------------------------
  add('\nProject and board');
  const projectCheck = check('project');
  const projects = await jira.request('GET', (tag) => tag`/rest/api/3/project/search?query=${project}&maxResults=20`);
  const foundProject = (projects?.values || []).find((p) => p.key === project);
  if (!foundProject) {
    projectCheck.fail(`project ${project} not found`);
    add(`\n${summary(checks)}`);
    return finish(checks, lines);
  }
  projectCheck.pass(`${project} exists (${foundProject.projectTypeKey})`);

  // --- workflow statuses ---------------------------------------------------
  add('\nWorkflow');
  const statusCheck = check('statuses');
  for (const status of Object.values(STATUS)) {
    try {
      await jira.search(`project = ${project} AND status = "${status}"`, { maxResults: 1, fields: [] });
      statusCheck.pass(`status "${status}" exists`);
    } catch (err) {
      statusCheck.fail(`status "${status}" is not valid on this workflow (${err.message})`);
    }
  }

  // --- transitions ---------------------------------------------------------
  const transitionCheck = check('transitions');
  add('\nTransitions');
  let sample = (await jira.search(jqlFor(STATUS.READY, project), { maxResults: 1, fields: [] }))[0];
  let inspectedFrom = STATUS.READY;
  if (!sample) {
    sample = (await jira.search(jqlFor(STATUS.IN_BUILD, project), { maxResults: 1, fields: [] }))[0];
    inspectedFrom = STATUS.IN_BUILD;
  }
  if (!sample) {
    transitionCheck.skip('no Ready for Build or In Build ticket exists, so transitions cannot be read');
    add('        create one ticket and rerun to check the transition names');
    add(`\n${summary(checks)}`);
    return finish(checks, lines);
  }

  const available = (await jira.getTransitions(sample.key)).map((t) => t.name);
  transitionCheck.pass(`${sample.key} (${inspectedFrom}) exposes: ${available.join(', ') || 'none'}`);
  for (const [from, name, to] of REQUIRED_TRANSITIONS) {
    if (from !== inspectedFrom) {
      transitionCheck.skip(`${from} -> ${name} -> ${to}  (needs a ticket in ${from})`);
      continue;
    }
    if (available.some((a) => a.toLowerCase() === name.toLowerCase())) {
      transitionCheck.pass(`${from} -> ${name} -> ${to}`);
    } else {
      transitionCheck.fail(`${from} -> ${name} -> ${to} is missing (have: ${available.join(', ') || 'none'})`);
    }
  }

  // A transition can exist and still reject the claim, because the fields it
  // writes are not on that transition's screen. Jira answers that with a 400
  // that looks exactly like a lost race, so check the screen explicitly.
  add('\nTransition screens');
  const screenCheck = check('claim-screen');
  if (!available.some((a) => a.toLowerCase() === TRANSITION.CLAIM.toLowerCase())) {
    screenCheck.skip(`"${TRANSITION.CLAIM}" is not available, so its screen cannot be checked`);
  } else {
    await checkClaimScreen({
      jira,
      key: sample.key,
      needed: [resolvedNames.worker, resolvedNames.lease].filter(Boolean),
      pass: screenCheck.pass,
      fail: screenCheck.fail,
      note: screenCheck.note,
      raw: screenCheck.raw,
    });
  }

  add(`\n${summary(checks)}`);
  return finish(checks, lines);
}

async function checkClaimScreen({ jira, key, needed, pass, fail, note, raw }) {
  const transitions = await jira.request(
    'GET',
    (tag) => tag`/rest/api/3/issue/${key}/transitions?expand=transitions.fields`,
  );
  const claim = (transitions?.transitions || []).find(
    (t) => t.name.toLowerCase() === TRANSITION.CLAIM.toLowerCase(),
  );
  if (!claim) {
    fail(`"${TRANSITION.CLAIM}" disappeared between requests`);
    return;
  }
  if (!claim.hasScreen) {
    note(`"${TRANSITION.CLAIM}" has no screen, so it accepts no field values`);
    raw('        the worker writes Fleet Worker + Fleet Lease during the claim,');
    raw('        so those two must be on the transition screen');
  }

  // Map the display names we need to the ids Jira uses in this response.
  const fields = claim.fields || {};
  const byName = new Map(
    Object.entries(fields).map(([id, meta]) => [String(meta?.name || '').toLowerCase(), id]),
  );

  const missing = [];
  for (const name of needed) {
    if (byName.has(String(name).toLowerCase())) pass(`"${TRANSITION.CLAIM}" accepts ${name}`);
    else missing.push(name);
  }
  if (missing.length) {
    // Not fatal: the worker falls back to writing the fields after the
    // transition. Say so, rather than implying the fleet will not run.
    note(`${missing.join(' and ')} are not on the Claim screen`);
    raw('        the worker will still claim, by writing them immediately after the');
    raw('        transition. Adding them to the screen makes the claim atomic (5.4b).');
  } else {
    pass(`Claim is atomic — the transition and its fields happen in one request`);
  }
}

function fieldEntries(record) {
  if (!record?.fields) return { ...DEFAULT_FIELDS };
  return {
    worker: record.fields.worker,
    lease: record.fields.lease,
    branch: record.fields.branch,
    pr: record.fields.pr,
    retry: record.fields.retry,
  };
}

function summary(checks) {
  return checks.every((c) => c.ok) ? 'Ready.' : 'Not ready — see the failures above.';
}

function finish(checks, lines) {
  return { ok: checks.every((c) => c.ok), checks, lines };
}
