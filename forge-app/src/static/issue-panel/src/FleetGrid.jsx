import React from 'react';
import { Field, Dash } from './Field.jsx';
import { formatLease, prettyPr } from './display.js';

// Lease: the backend decides the state; the panel only formats it. A live lease
// shows a countdown computed server-side, so clock skew cannot fake liveness.
export function LeaseValue({ leaseState }) {
  const lease = formatLease(leaseState);
  if (!lease) return <Dash />;
  return (
    <span>
      <span className={`fleet-mono fleet-${lease.tone}`}>{lease.text}</span>
      {lease.suffix ? <span className="fleet-faint"> {lease.suffix}</span> : null}
    </span>
  );
}

export default function FleetGrid({ model }) {
  const pr = prettyPr(model.pr);
  return (
    <div className="fleet-grid">
      <Field label="Worker">{model.worker ? <span className="fleet-mono">{model.worker}</span> : <Dash />}</Field>
      <Field label="Lease">
        <LeaseValue leaseState={model.leaseState} />
      </Field>
      <Field label="Branch">
        {model.branch ? <span className="fleet-mono">{model.branch}</span> : <Dash />}
      </Field>
      <Field label="Pull request">
        {pr ? (
          <a href={model.pr} target="_blank" rel="noreferrer noopener">
            {pr}
          </a>
        ) : (
          <Dash />
        )}
      </Field>
      <Field label="Retry budget">
        {model.retry ? <span>{model.retry} used</span> : <span className="fleet-faint">0 used</span>}
      </Field>
      <Field label="Status">{model.status || <Dash />}</Field>
    </div>
  );
}
