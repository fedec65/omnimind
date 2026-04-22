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
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MemoryStore } from '../core/MemoryStore.js';
import { IntentPredictor, buildFingerprint } from '../prediction/IntentPredictor.js';
import { join } from 'path';
import { homedir } from 'os';
// ─── Schemas ──────────────────────────────────────────────────────
const SearchInput = z.object({
    query: z.string().min(1).max(1000).describe('Search query text'),
    limit: z.number().min(1).max(50).optional().describe('Maximum results (default: 10)'),
    wing: z.string().optional().describe('Filter by wing/category'),
    room: z.string().optional().describe('Filter by room/subcategory'),
    layer: z.number().min(0).max(3).optional().describe('Filter by memory layer (0-3)'),
});
const StoreInput = z.object({
    content: z.string().min(1).max(10000).describe('Memory content to store'),
    wing: z.string().min(1).max(100).describe('Wing/category (e.g., "project-alpha")'),
    room: z.string().max(100).optional().describe('Room/subcategory (e.g., "architecture")'),
    sourceTool: z.string().max(50).optional().describe('Tool that created this memory'),
    pin: z.boolean().optional().describe('Pin this memory to prevent aging'),
});
const PredictInput = z.object({
    projectPath: z.string().describe('Current project directory'),
    gitBranch: z.string().optional().describe('Current git branch'),
    currentFile: z.string().optional().describe('Currently open file'),
    recentTools: z.array(z.string()).optional().describe('Recently used tools'),
});
// ─── Server Implementation ────────────────────────────────────────
export class OmnimindMcpServer {
    server;
    store;
    predictor;
    initialized = false;
    constructor() {
        const dbPath = join(homedir(), '.omnimind', 'memory.db');
        this.store = new MemoryStore({ dbPath });
        this.predictor = new IntentPredictor();
        this.server = new Server({
            name: 'omnimind',
            version: '0.1.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
    }
    async init() {
        const result = await this.store.init();
        if (!result.ok) {
            throw new Error(`Failed to initialize memory store: ${result.error.message}`);
        }
        this.initialized = true;
        console.error('[Omnimind MCP] Server initialized');
    }
    async start() {
        if (!this.initialized) {
            await this.init();
        }
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('[Omnimind MCP] Server running on stdio');
    }
    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'omnimind_search',
                    description: 'Search your memory for relevant information. Use this when you need to recall past conversations, decisions, or context.',
                    inputSchema: zodToJsonSchema(SearchInput),
                },
                {
                    name: 'omnimind_store',
                    description: 'Store new information in your memory. Use this to save important decisions, user preferences, or context that should persist across sessions.',
                    inputSchema: zodToJsonSchema(StoreInput),
                },
                {
                    name: 'omnimind_predict',
                    description: 'Get predicted memories based on current activity context. Returns memories you might need before you ask.',
                    inputSchema: zodToJsonSchema(PredictInput),
                },
                {
                    name: 'omnimind_status',
                    description: 'Get system health and memory statistics.',
                    inputSchema: { type: 'object', properties: {} },
                },
            ],
        }));
        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case 'omnimind_search':
                        return await this.handleSearch(request.params.arguments);
                    case 'omnimind_store':
                        return await this.handleStore(request.params.arguments);
                    case 'omnimind_predict':
                        return await this.handlePredict(request.params.arguments);
                    case 'omnimind_status':
                        return await this.handleStatus();
                    default:
                        throw new Error(`Unknown tool: ${request.params.name}`);
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${message}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    // ─── Tool Handlers ──────────────────────────────────────────────
    async handleSearch(args) {
        const input = SearchInput.parse(args);
        const searchOpts = {
            limit: input.limit,
            ...(input.wing !== undefined ? { wing: input.wing } : {}),
            ...(input.room !== undefined ? { room: input.room } : {}),
            ...(input.layer !== undefined ? { layer: input.layer } : {}),
        };
        const result = await this.store.search(input.query, searchOpts);
        if (!result.ok) {
            throw result.error;
        }
        const memories = result.value;
        if (memories.length === 0) {
            return {
                content: [{ type: 'text', text: 'No matching memories found.' }],
            };
        }
        const lines = memories.map((m, i) => {
            const layerNames = ['verbatim', 'compressed', 'concept', 'wisdom'];
            return `${i + 1}. [${m.memory.wing}/${m.memory.room}] (${layerNames[m.memory.layer]})\n   ${m.memory.content.substring(0, 300)}${m.memory.content.length > 300 ? '...' : ''}`;
        });
        return {
            content: [
                {
                    type: 'text',
                    text: `Found ${memories.length} memories:\n\n${lines.join('\n\n')}`,
                },
            ],
        };
    }
    async handleStore(args) {
        const input = StoreInput.parse(args);
        const storeMeta = { wing: input.wing };
        if (input.room !== undefined)
            storeMeta.room = input.room;
        if (input.sourceTool !== undefined)
            storeMeta.sourceTool = input.sourceTool;
        if (input.pin !== undefined)
            storeMeta.pinned = input.pin;
        const result = await this.store.store(input.content, storeMeta);
        if (!result.ok) {
            throw result.error;
        }
        const memory = result.value;
        return {
            content: [
                {
                    type: 'text',
                    text: `Stored memory ${memory.id.substring(0, 8)} in ${memory.wing}/${memory.room}.`,
                },
            ],
        };
    }
    async handlePredict(args) {
        const input = PredictInput.parse(args);
        const fingerprint = buildFingerprint({
            projectPath: input.projectPath,
            gitBranch: input.gitBranch ?? 'unknown',
            currentFile: input.currentFile ?? 'unknown',
            recentTools: input.recentTools ?? [],
            recentWings: [],
            recentRooms: [],
        });
        const predictions = await this.predictor.predict(fingerprint, async (id) => {
            const result = await this.store.get(id);
            return result.ok ? result.value : null;
        });
        if (!predictions.ok) {
            throw predictions.error;
        }
        if (predictions.value.length === 0) {
            return {
                content: [{ type: 'text', text: 'No predictions for current context.' }],
            };
        }
        // Fetch full memory content for predictions
        const lines = [];
        for (const pred of predictions.value) {
            const mem = await this.store.get(pred.memoryId);
            if (mem.ok && mem.value) {
                lines.push(`[${mem.value.wing}] ${mem.value.content.substring(0, 250)} (confidence: ${(pred.confidence * 100).toFixed(0)}%)`);
            }
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `Predicted memories (${predictions.value.length}):\n\n${lines.join('\n\n')}`,
                },
            ],
        };
    }
    async handleStatus() {
        const stats = await this.store.getStats();
        if (!stats.ok) {
            throw stats.error;
        }
        const s = stats.value;
        const layerNames = ['Verbatim', 'Compressed', 'Concept', 'Wisdom'];
        const layerInfo = Object.entries(s.memoriesByLayer)
            .map(([layer, count]) => `  ${layerNames[Number(layer)]}: ${count}`)
            .join('\n');
        const predStats = this.predictor.getStats();
        return {
            content: [
                {
                    type: 'text',
                    text: [
                        `Omnimind Status`,
                        `================`,
                        `Total memories: ${s.totalMemories}`,
                        `By layer:`,
                        layerInfo,
                        `Database size: ${(s.databaseSizeBytes / 1024 / 1024).toFixed(1)} MB`,
                        `Predictor patterns: ${predStats.totalPatterns} across ${predStats.uniqueContexts} contexts`,
                    ].join('\n'),
                },
            ],
        };
    }
}
// ─── Helpers ──────────────────────────────────────────────────────
/** Convert Zod schema to JSON schema for MCP */
function zodToJsonSchema(schema) {
    // Simplified conversion — full implementation would use zod-to-json-schema
    return schema instanceof z.ZodObject
        ? { type: 'object', properties: {} }
        : { type: 'string' };
}
// ─── Entry Point ──────────────────────────────────────────────────
const server = new OmnimindMcpServer();
server.start().catch(console.error);
//# sourceMappingURL=server.js.map