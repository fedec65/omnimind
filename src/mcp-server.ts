#!/usr/bin/env node
/**
 * Omnimind MCP Server entry point
 * 
 * Starts the Model Context Protocol server on stdio.
 * This is the process that MCP clients (Claude Code, Cursor, etc.) connect to.
 * 
 * Usage:
 *   node dist/mcp-server.js
 *   # or
 *   npx omnimind-mcp
 */

import { OmnimindMcpServer } from './mcp/server.js';

// MCP stdio servers own stdout for JSON-RPC. The Omnimind facade, bus,
// and adapters log via console.log — reroute it to stderr so library
// logging can never corrupt the protocol stream.
console.log = console.error;

const server = new OmnimindMcpServer();
server.start().catch((error: unknown) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
