import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import StatTile from './StatTile.jsx';
import WorkerChip from './WorkerChip.jsx';
import { buildPageState, formatAge } from './model.js';

const REFRESH_MS = 10_000;

export default function App() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const next = await invoke('fleet.page.get');
      setPayload(next);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = setInterval(load, REFRESH_MS);
    return () => clearInterval(refresh);
  }, [load]);

  // Cheap re-render so "Updated 12s ago" ticks without refetching.
  useEffect(() => {
    const ticker = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(ticker);
  }, []);

  if (error) {
    return (
      <div className="fp-root">
        <SectionMessage appearance="error" title="The Fleet page could not load">
          <p>{error}</p>
          <p className="fp-faint">
            Check that the app is installed on this site and that the project is configured in Fleet settings.
          </p>
        </SectionMessage>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="fp-root fp-root--loading">
        <Spinner size="large" label="Loading fleet presence" />
      </div>
    );
  }

  const state = buildPageState(payload);

  return (
    <div className="fp-root">
      <header className="fp-header">
        <div>
          <h1 className="fp-title">Fleet</h1>
          <p className="fp-subtitle">
            {state.projectKey ? `${state.projectKey} · ` : ''}
            Live presence from worker heartbeats.
          </p>
        </div>
        <div className="fp-header-actions">
          <span className="fp-live">
            <span className="fp-live-dot" aria-hidden="true" /> Live
          </span>
          <span className="fp-updated">{updatedAt ? `Updated ${formatAge(Date.now() - updatedAt)}` : ''}</span>
          <Button appearance="subtle" onClick={load}>
            Refresh
          </Button>
        </div>
      </header>

      <section className="fp-tiles" aria-label="Fleet summary">
        {state.tiles.map((tile) => (
          <StatTile
            key={tile.key}
            tile={tile}
            avatars={tile.key === 'online' ? state.avatars : []}
            extraAvatars={tile.key === 'online' ? state.extraAvatars : 0}
          />
        ))}
      </section>

      {state.empty ? (
        <div className="fp-empty">
          <strong>No workers are connected.</strong> Start a worker with a heartbeat to see the machine here:
          <code>FLEET_HEARTBEAT_URL</code> and a Fleet token from Project settings. A worker that is running but not
          beating is invisible — that is the difference between this page and the board.
        </div>
      ) : null}

      <Roster title="Busy" workers={state.busy} empty="No runs in flight." />
      <Roster title="Idle" workers={state.idle} empty="No idle machines." />
      {state.recently.length ? (
        <Roster
          title="Recently seen"
          workers={state.recently}
          muted
          empty=""
          note="Stopped beating within the last hour."
        />
      ) : null}
    </div>
  );
}

function Roster({ title, workers, empty, muted = false, note = null }) {
  return (
    <section className={`fp-section${muted ? ' fp-section--muted' : ''}`} aria-label={title}>
      <div className="fp-section-head">
        <h2 className="fp-section-title">
          {title} <span className="fp-count">{workers.length}</span>
        </h2>
        {note ? <span className="fp-faint fp-small">{note}</span> : null}
      </div>
      {workers.length === 0 ? (
        empty ? <p className="fp-faint">{empty}</p> : null
      ) : (
        <div className="fp-rows">
          {workers.map((worker) => (
            <WorkerChip key={worker.id} worker={worker} />
          ))}
        </div>
      )}
    </section>
  );
}
