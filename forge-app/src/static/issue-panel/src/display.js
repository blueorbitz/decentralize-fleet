// Pure display helpers for the panel. Kept out of the components so they can be
// tested without React or the Forge bridge.

const PAD = (n) => String(n).padStart(2, '0');

// The countdown is computed server-side from the lease; this only formats it, so
// clock skew between the browser and Jira cannot make a stale lease look live.
export function formatLease(leaseState) {
  if (!leaseState || leaseState.state === 'none') return null;
  if (leaseState.state === 'stale') return { text: 'expired', tone: 'danger' };
  const remaining = Math.max(0, leaseState.remainingMs ?? 0);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return { text: `${PAD(minutes)}:${PAD(seconds)}`, tone: 'warn', suffix: 'left of 15m' };
}

export function prettyPr(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const match = u.pathname.match(/pull-requests\/(\d+)/);
    if (match) return `pull request #${match[1]}`;
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

// Board status -> semantic tone for the status pill. This mapping is the only
// place the panel knows about status names; everything else renders whatever the
// backend sends. Every tone needs a `.fleet-pill--<tone>` rule in panel.css,
// which test/panel-styles.test.js enforces.
const TONE = {
  Backlog: 'neutral',
  Triaged: 'information',
  'Ready for Build': 'information',
  'In Build': 'warning',
  'In Review': 'discovery',
  Done: 'success',
  Failed: 'danger',
};

export function statusTone(status) {
  return TONE[status] || 'neutral';
}

export function shortStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${PAD(d.getHours())}:${PAD(d.getMinutes())}:${PAD(d.getSeconds())}  `;
}

export function oneLine(text) {
  return String(text || '')
    .split('\n')
    .filter(Boolean)
    .join(' · ');
}

// The backend decides which actions exist; the panel must not second-guess it,
// but it does need a single sentence when there is nothing to do.
export function actionHint(actions) {
  if (actions.canDispatch && actions.canRequeue) return null;
  if (actions.canDispatch) return null;
  if (actions.canRequeue) return null;
  return 'No fleet action available at this status. Workers claim only from “Ready for Build”.';
}
