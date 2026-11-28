// The Fleet page's view model.
//
// Plain JS with no React or Forge imports, so `node --test` can drive every
// decision the JSX makes. The resolver already computed ages against server
// time; this file only groups and formats.

export const MAX_AVATARS = 6;
export const MAX_NAMES = 8;

export function buildPageState(payload) {
  const workers = Array.isArray(payload?.workers) ? payload.workers : [];
  const online = workers.filter((w) => w.online);
  const busy = online.filter((w) => w.state === 'running');
  const idle = online.filter((w) => w.state !== 'running');
  const recently = Array.isArray(payload?.recentlySeen) ? payload.recentlySeen : [];

  const avatars = online.slice(0, MAX_AVATARS).map(workerView);
  const extraAvatars = Math.max(0, online.length - avatars.length);

  return {
    projectKey: payload?.project?.key || null,
    onlineWindowMs: payload?.onlineWindowMs ?? 90_000,
    summary: { online: online.length, busy: busy.length, idle: idle.length },
    tiles: [
      {
        key: 'online',
        label: 'Online',
        value: online.length,
        tone: online.length ? 'success' : 'neutral',
        hint: online.length
          ? `Connected machines: ${truncatedNames(online.map(machineLabel))}`
          : 'No workers are beating. Start a worker with FLEET_HEARTBEAT_URL set.',
      },
      {
        key: 'busy',
        label: 'Busy',
        value: busy.length,
        tone: busy.length ? 'information' : 'neutral',
        hint: busy.length
          ? busy.map((w) => `${machineLabel(w)}${w.ticket ? ` (${w.ticket})` : ''}`).join(', ')
          : 'No runs in flight.',
      },
      {
        key: 'idle',
        label: 'Idle',
        value: idle.length,
        tone: idle.length ? 'success' : 'neutral',
        hint: idle.length ? truncatedNames(idle.map(machineLabel)) : 'No idle machines.',
      },
    ],
    avatars,
    extraAvatars,
    busy: busy.map(workerView),
    idle: idle.map(workerView),
    recently: recently.map(workerView),
    empty: online.length === 0,
  };
}

export function workerView(worker) {
  const online = Boolean(worker.online);
  return {
    id: worker.workerId,
    machine: machineLabel(worker),
    initials: initials(worker),
    state: worker.state,
    online,
    ageMs: worker.ageMs,
    age: formatAge(worker.ageMs),
    ticket: worker.ticket || null,
    adapter: worker.adapter || null,
    version: worker.version || null,
    details: hoverLines(worker),
  };
}

export function machineLabel(worker) {
  return worker?.machine || worker?.workerId || 'unknown';
}

// Two letters from the machine name when it has words, otherwise the worker
// id's trailing digits (the prototype's "04" treatment).
export function initials(worker) {
  const source = String(machineLabel(worker)).replace(/[^A-Za-z0-9]+/g, ' ').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const digits = String(worker?.workerId || '').replace(/[^0-9]/g, '');
  if (digits) return digits.slice(-2);
  return source.slice(0, 2).toUpperCase() || '?';
}

export function hoverLines(worker) {
  const lines = [machineLabel(worker), worker.workerId];
  if (worker.online === false) {
    lines.push(`Last seen ${formatAge(worker.ageMs)}`);
  } else if (worker.state === 'running') {
    lines.push(`Running ${worker.ticket || 'a ticket'}`);
  } else {
    lines.push('Idle — waiting for work');
  }
  if (worker.adapter) {
    lines.push(`Adapter: ${worker.adapter}${worker.version ? ` (${worker.version})` : ''}`);
  }
  return lines;
}

export function formatAge(ms) {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return 'unknown';
  if (ms < 1000) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncatedNames(names) {
  if (names.length <= MAX_NAMES) return names.join(', ');
  return `${names.slice(0, MAX_NAMES).join(', ')}, +${names.length - MAX_NAMES} more`;
}
