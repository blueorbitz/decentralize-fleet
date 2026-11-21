// What the "Fleet" issue panel shows, and the actions it can take.
//
// The panel is read-mostly on purpose: it renders state Jira already holds and
// exposes exactly two writes — dispatch (label + move to Ready for Build) and
// abort & requeue (the same Requeue transition the reaper uses). It never
// claims, runs, or merges: those belong to a worker and a human respectively.
import { STATUS, CONSTANTS } from './config.js';
import { isLeaseStale } from './jira.js';

export function buildPanelModel({ ticket, comments = [], now = Date.now(), staleMs = CONSTANTS.LEASE_STALE_MS }) {
  const stale = ticket.status === STATUS.IN_BUILD && isLeaseStale(ticket.lease, { now, staleMs });
  const canDispatch = ticket.status === STATUS.TRIAGED || (ticket.status === STATUS.READY && !ticket.worker);
  const canRequeue = ticket.status === STATUS.IN_BUILD;

  return {
    key: ticket.key,
    summary: ticket.summary,
    status: ticket.status,
    labels: ticket.labels || [],
    worker: ticket.worker || null,
    lease: ticket.lease || null,
    leaseState: leaseState(ticket, { now, staleMs }),
    branch: ticket.branch || null,
    pr: ticket.pr || null,
    retry: ticket.retry ?? 0,
    acceptanceCriteria: splitLines(ticket.acceptanceCriteria),
    actions: {
      canDispatch,
      canRequeue,
      dispatchLabel: ticket.status === STATUS.TRIAGED ? 'Dispatch to fleet' : 'Mark fleet-ready',
      requeueLabel: canRequeue && stale ? 'Requeue stale claim' : 'Abort & requeue',
    },
    log: runLogTail(comments, { worker: ticket.worker }),
  };
}

// A lease is either missing, fresh (with a countdown), or stale. The countdown
// is computed server-side so the panel does not have to agree on clock skew.
export function leaseState(ticket, { now, staleMs }) {
  if (!ticket.lease) return { state: 'none' };
  if (isLeaseStale(ticket.lease, { now, staleMs })) {
    return { state: 'stale', since: ticket.lease };
  }
  return {
    state: 'live',
    since: ticket.lease,
    expiresAt: new Date(Date.parse(ticket.lease) + staleMs).toISOString(),
    remainingMs: Date.parse(ticket.lease) + staleMs - now,
  };
}

// The run log the prototype shows is the ticket's comment history, filtered to
// the fleet's own messages. Jira is the only store, so the log is whatever was
// written to the ticket.
export function runLogTail(comments, { limit = CONSTANTS.COMMENT_TAIL, worker } = {}) {
  const fleetComments = comments.filter((c) => /fleet|requeued|lease|worker/i.test(c.body));
  const selected = (fleetComments.length ? fleetComments : comments).slice(-limit);
  return selected.map((c) => ({
    author: c.author || (worker ? `Fleet worker ${worker}` : 'Fleet'),
    created: c.created,
    text: c.body,
  }));
}

function splitLines(text) {
  if (!text) return [];
  return String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
