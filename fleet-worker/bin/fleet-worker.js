#!/usr/bin/env node
import { main } from '../src/cli.js';

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`fleet-worker crashed: ${err?.stack || err}\n`);
    process.exitCode = 1;
  });
