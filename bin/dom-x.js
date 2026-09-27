#!/usr/bin/env node
import { runCLI } from '../dist/cli/index.js';

runCLI(process.argv).catch((err) => {
  console.error('[DOM_X Fatal Error]', err);
  process.exit(1);
});
