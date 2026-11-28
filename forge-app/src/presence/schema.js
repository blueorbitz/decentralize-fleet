// Presence registry: the KVS key scheme and heartbeat record shape.
//
// Runtime-free on purpose (same pattern as src/settings/schema.js), so the
// store, the service and the page model all run under `node --test`.
//
// A record is deliberately small: identity, machine name, state, and when the
// worker was last seen. No tokens, no ticket content.
export const PRESENCE_PREFIX = 'fleet:presence:';

// Three missed beats at the default 30s interval. The worker can be told to
// beat slower, but the page's definition of "online" stays fixed so it cannot
// disagree with itself.
export const ONLINE_WINDOW_MS = 90_000;

// How long a worker that stopped beating stays visible as "recently seen".
export const RECENT_WINDOW_MS = 60 * 60_000;

export const PRESENCE_STATES = ['idle', 'running', 'offline'];

export const MAX_WORKERS = 200;

export function presenceKey(projectId, workerId) {
  return `${PRESENCE_PREFIX}${projectId}:${workerId}`;
}

export function presencePrefix(projectId) {
  return `${PRESENCE_PREFIX}${projectId}:`;
}

export class PresenceError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = 'PresenceError';
    this.status = status;
  }
}

/**
 * Validate and shape an inbound heartbeat. The client's clock is ignored:
 * `lastSeen` is always the server's `now`, and `firstSeen` is carried over from
 * the existing record so the page can show how long a machine has been around.
 */
export function normalizeBeat(input, { projectId, now = new Date(), firstSeen = null } = {}) {
  if (!projectId) throw new PresenceError('a project id is required');

  const workerId = clean(input?.workerId, 64);
  if (!workerId) throw new PresenceError('workerId is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(workerId)) {
    throw new PresenceError('workerId may contain letters, digits, dot, underscore and dash only');
  }

  const state = PRESENCE_STATES.includes(input?.state) ? input.state : 'idle';
  const at = now.toISOString();

  return {
    projectId: String(projectId),
    workerId,
    machine: clean(input?.machine, 128) || workerId,
    state,
    ticket: clean(input?.ticket, 64),
    adapter: clean(input?.adapter, 64),
    version: clean(input?.version, 64),
    firstSeen: firstSeen || at,
    lastSeen: at,
  };
}

export function ageMs(record, { now = Date.now() } = {}) {
  const seen = Date.parse(record?.lastSeen);
  if (Number.isNaN(seen)) return Infinity;
  return Math.max(0, now - seen);
}

export function isOnline(record, { now = Date.now(), windowMs = ONLINE_WINDOW_MS } = {}) {
  return record?.state !== 'offline' && ageMs(record, { now }) <= windowMs;
}

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const str = String(value)
    // Control characters would break the line-oriented page layout.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return str ? str.slice(0, max) : null;
}
