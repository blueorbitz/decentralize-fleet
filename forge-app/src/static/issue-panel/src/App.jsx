import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import StatusLozenge from './StatusLozenge.jsx';
import FleetGrid from './FleetGrid.jsx';
import RunLog from './RunLog.jsx';
import FleetActions from './FleetActions.jsx';

export default function App() {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const next = await invoke('fleet.panel');
      setModel(next);
      setError(null);
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="fleet-root">
        <SectionMessage appearance="error" title="The Fleet panel could not load this ticket">
          <p>{error}</p>
          <p className="fleet-faint">
            Check that the app is installed on this site, the FLT project exists, and the Fleet fields are configured.
          </p>
        </SectionMessage>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="fleet-root">
        <Spinner size="medium" label="Loading fleet state" />
      </div>
    );
  }

  return (
    <div className="fleet-root">
      <header className="fleet-header">
        <h2 className="fleet-title">Fleet</h2>
        <StatusLozenge status={model.status} />
        <span className="fleet-faint fleet-mono">{model.key}</span>
      </header>

      {model.actions.canDispatch ? (
        <div className="fleet-banner">
          Fleet-ready. A worker will claim this on its next poll (~30–60s). Prefer to dispatch it now?
        </div>
      ) : null}

      {model.leaseState.state === 'stale' ? (
        <div className="fleet-banner">
          The lease on this claim is stale. The scheduled reaper will requeue it within five minutes, or you can
          requeue it now.
        </div>
      ) : null}

      <FleetGrid model={model} />

      {model.labels.length ? (
        <div style={{ paddingBottom: 'var(--ds-space-100)' }}>
          {model.labels.map((label) => (
            <span className="fleet-label" key={label}>
              {label}
            </span>
          ))}
        </div>
      ) : null}

      <AcceptanceCriteria items={model.acceptanceCriteria} done={model.status === 'Done'} />

      <RunLog entries={model.log} />

      <FleetActions model={model} onChanged={load} />
    </div>
  );
}

function AcceptanceCriteria({ items, done }) {
  if (!items || items.length === 0) {
    return <p className="fleet-faint">No acceptance criteria on this ticket yet.</p>;
  }
  return (
    <section aria-label="Acceptance criteria">
      <div className="fleet-field-label">Acceptance criteria</div>
      <ul className="fleet-ac">
        {items.map((item) => (
          <li className="fleet-ac-item" key={item}>
            <span className={`fleet-ac-box${done ? ' fleet-ac-box--done' : ''}`} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
