import React from 'react';

// One machine. `compact` is the avatar inside a stat tile; the full form is a
// roster row. Both reveal the same hover card, so machine names are never more
// than a hover away.
export default function WorkerChip({ worker, compact = false }) {
  return (
    <div
      className={`fp-chip${compact ? ' fp-chip--compact' : ''}${worker.online ? '' : ' fp-chip--offline'}`}
      tabIndex={0}
      aria-label={`${worker.machine}, ${worker.id}${worker.online ? '' : `, last seen ${worker.age}`}`}
    >
      <span className="fp-avatar">{worker.initials}</span>

      {compact ? null : (
        <span className="fp-chip-body">
          <span className="fp-chip-machine">{worker.machine}</span>
          <span className="fp-chip-id">{worker.id}</span>
        </span>
      )}

      {compact ? null : (
        <span className={`fp-state fp-state--${worker.online ? worker.state : 'offline'}`}>
          {worker.online ? (worker.state === 'running' ? worker.ticket || 'Running' : 'Idle') : worker.age}
        </span>
      )}

      <div className="fp-hovercard" role="tooltip">
        {worker.details.map((line, index) => (
          <div key={index} className={index === 0 ? 'fp-hover-title' : undefined}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
