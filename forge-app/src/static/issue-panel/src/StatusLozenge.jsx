import React from 'react';
import { statusTone } from './display.js';

// A lozenge is one of the design system's most-used patterns, but the published
// @atlaskit/lozenge tarball can install without its dist and take the whole
// panel build down with it. This pill is the same visual built from design
// tokens, so it themes correctly and installs reliably.
export default function StatusLozenge({ status }) {
  if (!status) return null;
  return <span className={`fleet-pill fleet-pill--${statusTone(status)}`}>{status}</span>;
}
