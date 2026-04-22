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
const server = new OmnimindMcpServer();
server.start().catch((error) => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
//# sourceMappingURL=mcp-server.js.map