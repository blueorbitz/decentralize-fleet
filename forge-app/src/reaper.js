// The lease reaper: the Forge app's scheduled repair loop.
//
// A worker that dies mid-run stops refreshing its lease. Nothing else notices:
// the ticket sits in In Build forever and the board rots. The reaper scans In
// Build tickets, requeues the ones whose lease is older than the staleness
// window, and leaves a comment so the history explains itself.
//
// This is deliberately not a scheduler. It never picks work up, never claims,
// and never talks to a worker. It only repairs Jira state, using the same
// Requeue transition and fields a worker uses.
import { isLeaseStale } from './jira.js';
import { STATUS, TRANSITION, CONSTANTS } from './config.js';

export function findStale(tickets, { now = Date.now(), staleMs = CONSTANTS.LEASE_STALE_MS }) {
  return tickets.filter((t) => t.status === STATUS.IN_BUILD && isLeaseStale(t.lease, { now, staleMs }));
}

export function humanAge(lease, now) {
  const t = Date.parse(lease);
  if (Number.isNaN(t)) return 'never refreshed';
  const minutes = Math.max(0, Math.round((now - t) / 60_000));
  return `${minutes}m since last refresh`;
}

export async function reap({ jira, fields, staleMs = CONSTANTS.LEASE_STALE_MS, now = Date.now(), logger = console }) {
  const inBuild = await jira.findInBuild();
  const stale = findStale(inBuild, { now, staleMs });

  const requeued = [];
  for (const ticket of stale) {
    const worker = ticket.worker || 'unknown';
    logger.info?.(`reaper: ${ticket.key} lease stale (worker=${worker}, ${humanAge(ticket.lease, now)}) -> requeue`);

    const retry = (ticket.retry ?? 0) + 1;
    await jira.setFields(ticket.key, {
      [fields.retry]: retry,
      [fields.worker]: null,
      [fields.lease]: null,
    });
    await jira.comment(
      ticket.key,
      `Requeued after lease expiry. Worker \`${worker}\` last refreshed the lease ${humanAge(ticket.lease, now)}, ` +
        `which is past the ${Math.round(staleMs / 60_000)} minute staleness window.\n\n` +
        `Cleared \`${fields.worker}\` and \`${fields.lease}\`. Retry budget used: ${retry}.`,
    );
    await jira.transition(ticket.key, TRANSITION.REQUEUE);
    requeued.push({ key: ticket.key, worker, retry });
  }

  return {
    scanned: inBuild.length,
    requeued: requeued.length,
    keys: requeued.map((r) => r.key),
    at: new Date(now).toISOString(),
  };
}
