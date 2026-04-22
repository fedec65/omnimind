/**
 * Omnimind MCP Server
 *
 * Exposes memory operations as Model Context Protocol tools.
 * Compatible with Claude Code, Cursor, ChatGPT, and any MCP client.
 *
 * Tools:
 * - omnimind_search: Search memories by query
 * - omnimind_store: Store a new memory
 * - omnimind_predict: Get predicted memories for current context
 * - omnimind_status: Get system health and statistics
 *
 * Usage:
 * ```bash
 * npx omnimind-mcp  # Starts the MCP server on stdio
 * ```
 */
export declare class OmnimindMcpServer {
    private server;
    private store;
    private predictor;
    private initialized;
    constructor();
    init(): Promise<void>;
    start(): Promise<void>;
    private setupHandlers;
    private handleSearch;
    private handleStore;
    private handlePredict;
    private handleStatus;
}
//# sourceMappingURL=server.d.ts.map