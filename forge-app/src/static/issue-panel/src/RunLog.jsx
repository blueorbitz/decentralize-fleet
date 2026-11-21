import React from 'react';
import { shortStamp, oneLine } from './display.js';

export default function RunLog({ entries }) {
  if (!entries || entries.length === 0) {
    return <p className="fleet-faint">No run yet — a worker will claim this ticket once it is Ready for Build.</p>;
  }
  return (
    <section aria-label="Run log — tail">
      <div className="fleet-field-label">Run log — tail</div>
      <pre className="fleet-log">
        {entries.map((entry) => (
          <span className="fleet-log-line" key={`${entry.created || ''}-${entry.text.slice(0, 24)}`}>
            <span className="fleet-log-author">{shortStamp(entry.created)} </span>
            {oneLine(entry.text)}
          </span>
        ))}
      </pre>
    </section>
  );
}
