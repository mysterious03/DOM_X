#!/usr/bin/env node
/**
 * DOM_X MCP Server Entry Point
 */

import { DOMPulseMCPServer } from './server';

async function main() {
  const port = process.env.DOM_X_PORT || process.env.DOMPULSE_PORT
    ? parseInt(process.env.DOM_X_PORT || process.env.DOMPULSE_PORT!, 10)
    : 8765;
  const server = new DOMPulseMCPServer(port);
  await server.start();
}

main().catch((err) => {
  console.error('[DOM_X MCP] Fatal server error:', err);
  process.exit(1);
});
