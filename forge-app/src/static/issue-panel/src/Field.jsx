import React from 'react';

export function Field({ label, children }) {
  return (
    <div>
      <div className="fleet-field-label">{label}</div>
      <div className="fleet-field-value">{children}</div>
    </div>
  );
}

export function Dash() {
  return <span className="fleet-faint">—</span>;
}

export default Field;
