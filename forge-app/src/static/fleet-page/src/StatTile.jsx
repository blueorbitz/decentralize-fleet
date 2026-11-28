import React from 'react';
import WorkerChip from './WorkerChip.jsx';

// A count tile. Hovering (or focusing) it reveals the underlying machine names,
// which is the "how many, and who?" interaction.
export default function StatTile({ tile, avatars = [], extraAvatars = 0 }) {
  return (
    <div className={`fp-tile fp-tile--${tile.tone}`} tabIndex={0} aria-label={`${tile.value} ${tile.label}. ${tile.hint}`}>
      <div className="fp-tile-value">{tile.value}</div>
      <div className="fp-tile-label">{tile.label}</div>

      {avatars.length ? (
        <div className="fp-avatars">
          {avatars.map((worker) => (
            <WorkerChip key={worker.id} worker={worker} compact />
          ))}
          {extraAvatars ? <span className="fp-avatar fp-avatar--more">+{extraAvatars}</span> : null}
        </div>
      ) : null}

      <div className="fp-hovercard fp-hovercard--tile" role="tooltip">
        {tile.hint}
      </div>
    </div>
  );
}
