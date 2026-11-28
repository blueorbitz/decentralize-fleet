// Optional presence heartbeat.
//
// A worker POSTs a tiny JSON body to the Fleet heartbeat webtrigger on an
// interval, and the Forge app stores it in KVS so the project's Fleet page can
// show which machines are online. This is the one place a worker talks to
// Forge; it is opt-in (no FLEET_HEARTBEAT_URL means no heartbeat) and it never
// carries fleet scheduling state.
//
// Every send is fire-and-forget: a registry outage must not stop a run.
const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;

export function createHeartbeat({
  url,
  token,
  workerId,
  machine,
  adapter = null,
  version = null,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  logger = null,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  if (!url) return null;
  if (!workerId) throw new Error('heartbeat needs a workerId');
  if (!token) throw new Error('heartbeat needs a token');

  let timer = null;
  let stopped = false;
  let failures = 0;
  let beat = {
    workerId,
    machine: machine || workerId,
    state: 'idle',
    ticket: null,
    adapter,
    version,
  };

  async function deliver(body) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      if (res && (res.status < 200 || res.status >= 300)) {
        throw new Error(`HTTP ${res.status}`);
      }
      failures = 0;
      logger?.debug?.(`heartbeat — ${body.state}${body.ticket ? ` ${body.ticket}` : ''}`);
      return true;
    } catch (err) {
      failures += 1;
      // One warning per outage, then every 20th failure: a registry that is
      // down for an hour should not bury the run log.
      if (failures === 1 || failures % 20 === 0) {
        logger?.warn?.(`heartbeat failed (${failures}x): ${err.message}`);
      }
      return false;
    }
  }

  return {
    get enabled() {
      return true;
    },

    start(initial = { state: 'idle', ticket: null }) {
      if (timer || stopped) return;
      beat = { ...beat, ...initial };
      void deliver(beat);
      timer = setIntervalImpl(() => {
        void deliver(beat);
      }, intervalMs);
      timer?.unref?.();
    },

    // Called when a worker claims and releases a ticket. Sends immediately so
    // the page flips to Busy/Idle without waiting for the next interval.
    setState(state, ticket = null) {
      if (stopped) return;
      beat = { ...beat, state, ticket };
      void deliver(beat);
    },

    // Best-effort "I am going away" beat. The page also drops a worker after
    // the online window, so a lost final beat is not a correctness problem.
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearIntervalImpl(timer);
      timer = null;
      await deliver({ ...beat, state: 'offline', ticket: null });
    },
  };
}
