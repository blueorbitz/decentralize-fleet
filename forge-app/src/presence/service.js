// What a heartbeat does and what the Fleet page sees.
//
// Independent of the Forge runtime and of HTTP: src/presence/trigger.js feeds
// `record()`, src/presence/resolver.js feeds `list()`. Timing is injected so a
// test can cross the online window without sleeping.
import {
  ONLINE_WINDOW_MS,
  RECENT_WINDOW_MS,
  ageMs,
  isOnline,
  normalizeBeat,
} from './schema.js';

export function createPresenceService({ store, now = () => Date.now() }) {
  if (!store) throw new Error('a presence store is required');

  return {
    // One write per beat. `firstSeen` survives restarts and machine renames.
    async record(projectId, input) {
      const existing = input?.workerId
        ? await store.get(projectId, String(input.workerId)).catch(() => null)
        : null;
      const beat = normalizeBeat(input, {
        projectId,
        now: new Date(now()),
        firstSeen: existing?.firstSeen || null,
      });
      await store.set(projectId, beat);
      return beat;
    },

    // What the page renders: counts, the full roster, and the ones that just
    // stopped beating. Ages are computed here so every viewer sees the same
    // numbers regardless of their clock.
    async list(projectId, { windowMs = ONLINE_WINDOW_MS, recentMs = RECENT_WINDOW_MS } = {}) {
      const at = now();
      const records = await store.list(projectId);

      const workers = records.map((record) => {
        const age = ageMs(record, { now: at });
        return {
          workerId: record.workerId,
          machine: record.machine,
          state: record.state,
          ticket: record.ticket,
          adapter: record.adapter,
          version: record.version,
          firstSeen: record.firstSeen,
          lastSeen: record.lastSeen,
          ageMs: age,
          online: isOnline(record, { now: at, windowMs }),
        };
      });

      const online = workers.filter((w) => w.online);
      const busy = online.filter((w) => w.state === 'running');
      const idle = online.filter((w) => w.state !== 'running');
      const recentlySeen = workers
        .filter((w) => !w.online && w.ageMs <= recentMs)
        .sort((a, b) => a.ageMs - b.ageMs);

      workers.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          a.ageMs - b.ageMs ||
          a.workerId.localeCompare(b.workerId),
      );

      return {
        projectId: String(projectId),
        generatedAt: new Date(at).toISOString(),
        onlineWindowMs: windowMs,
        summary: {
          online: online.length,
          busy: busy.length,
          idle: idle.length,
        },
        workers,
        recentlySeen,
      };
    },

    // Presence records are disposable. The reaper calls this once per project
    // so a machine that never comes back does not occupy KVS forever.
    async prune(projectId, olderThanMs = 24 * 60 * 60_000) {
      const at = now();
      const records = await store.list(projectId);
      let removed = 0;
      for (const record of records) {
        if (ageMs(record, { now: at }) > olderThanMs) {
          await store.delete(projectId, record.workerId);
          removed += 1;
        }
      }
      return { projectId: String(projectId), removed };
    },
  };
}

function rank(worker) {
  if (!worker.online) return 2;
  return worker.state === 'running' ? 0 : 1;
}
