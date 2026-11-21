import React, { useState } from 'react';
import Button from '@atlaskit/button/default/button';
import { invoke } from '@forge/bridge';
import { actionHint } from './display.js';

// Exactly two writes reachable from the panel: dispatch (label + move to Ready
// for Build) and abort & requeue (the same Requeue transition the reaper uses).
// The panel never claims, runs, or merges.
export default function FleetActions({ model, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function run(name, fn) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      onChanged?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  const { actions } = model;

  return (
    <div>
      {error ? <p className="fleet-error">{error}</p> : null}
      <div className="fleet-actions">
        {actions.canDispatch ? (
          <Button
            appearance="primary"
            isLoading={busy === 'dispatch'}
            isDisabled={busy !== null}
            onClick={() => run('dispatch', () => invoke('fleet.dispatch'))}
          >
            {actions.dispatchLabel}
          </Button>
        ) : null}
        {actions.canRequeue ? (
          <Button
            appearance="danger"
            isLoading={busy === 'requeue'}
            isDisabled={busy !== null}
            onClick={() =>
              run('requeue', () =>
                invoke('fleet.requeue', {
                  reason: 'Aborted and requeued from the Fleet panel.',
                }),
              )
            }
          >
            {actions.requeueLabel}
          </Button>
        ) : null}
        {actionHint(actions) ? <span className="fleet-faint">{actionHint(actions)}</span> : null}
      </div>
    </div>
  );
}
