#!/usr/bin/env node
// Kiro adapter — deliberately a stub (grill Low #2).
//
// The daemon is harness-agnostic; adding a harness means adding one of these
// files and nothing else. Kiro CLI integration is left as a follow-up so the
// contract is visible without the implementation.
import { readStdin, emitResult } from './_lib.mjs';

await readStdin();
emitResult({
  status: 'failed',
  summary: 'kiro adapter not implemented — add a translator here or select another adapter',
  tests: { ran: null, passed: null },
  harness: 'kiro',
  log_path: null,
});
process.exit(0);
