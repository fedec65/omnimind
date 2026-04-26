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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { MemoryStore } from '../core/MemoryStore.js';
import { IntentPredictor, buildFingerprint } from '../prediction/IntentPredictor.js';
import { MemoryBus } from '../bus/MemoryBus.js';
import { ClaudeAdapter } from '../bus/adapters/ClaudeAdapter.js';
import { EventType } from '../bus/types.js';
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

const SubscribeInput = z.object({
  wings: z.array(z.string()).optional().describe('Wings to subscribe to'),
  rooms: z.array(z.string()).optional().describe('Rooms to subscribe to'),
  eventTypes: z.array(z.enum(['create', 'update', 'delete'])).optional().describe('Event types to subscribe to'),
});

const SyncInput = z.object({
  since: z.number().optional().describe('Unix timestamp — get events after this time'),
  toolId: z.string().optional().describe('Only sync from specific tool (e.g., "cursor")'),
});

// ─── Server Implementation ────────────────────────────────────────

export class OmnimindMcpServer {
  private server: Server;
  private store: MemoryStore;
  private predictor: IntentPredictor;
  private bus: MemoryBus;
  private initialized = false;

  constructor() {
    const dbPath = join(homedir(), '.omnimind', 'memory.db');
    this.store = new MemoryStore({ dbPath });
    this.predictor = new IntentPredictor();
    this.bus = new MemoryBus(this.store);

    this.server = new Server(
      {
        name: 'omnimind',
        version: '0.2.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );

    this.setupHandlers();
    this.setupResourceHandlers();
    this.setupPromptHandlers();
  }

  async init(): Promise<void> {
    const result = await this.store.init();
    if (!result.ok) {
      throw new Error(`Failed to initialize memory store: ${result.error.message}`);
    }

    // Initialize bus with Claude adapter
    const claudeAdapter = new ClaudeAdapter(this.bus);
    const busResult = await this.bus.registerAdapter(claudeAdapter);
    if (!busResult.ok) {
      console.error(`[Omnimind MCP] Claude adapter failed: ${busResult.error.message}`);
    }

    this.initialized = true;
    console.error('[Omnimind MCP] Server initialized');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[Omnimind MCP] Server running on stdio');
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'omnimind_search',
          description: 'Search your memory for relevant information. Use this when you need to recall past conversations, decisions, or context.',
          inputSchema: convertZodToJsonSchema(SearchInput),
        },
        {
          name: 'omnimind_store',
          description: 'Store new information in your memory. Use this to save important decisions, user preferences, or context that should persist across sessions.',
          inputSchema: convertZodToJsonSchema(StoreInput),
        },
        {
          name: 'omnimind_predict',
          description: 'Get predicted memories based on current activity context. Returns memories you might need before you ask.',
          inputSchema: convertZodToJsonSchema(PredictInput),
        },
        {
          name: 'omnimind_status',
          description: 'Get system health and memory statistics.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'omnimind_subscribe',
          description: 'Subscribe to memory updates from a specific wing or room. Get notified when other tools update shared memories.',
          inputSchema: convertZodToJsonSchema(SubscribeInput),
        },
        {
          name: 'omnimind_sync',
          description: 'Sync memories from other tools. Call this when starting a new session to pull missed updates.',
          inputSchema: convertZodToJsonSchema(SyncInput),
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
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
          case 'omnimind_subscribe':
            return await this.handleSubscribe(request.params.arguments);
          case 'omnimind_sync':
            return await this.handleSync(request.params.arguments);
          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
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

  private async handleSearch(args: unknown) {
    const input = SearchInput.parse(args);

    const searchOpts: import('../core/types.js').SearchOptions = {
      limit: input.limit,
      ...(input.wing !== undefined ? { wing: input.wing } : {}),
      ...(input.room !== undefined ? { room: input.room } : {}),
      ...(input.layer !== undefined ? { layer: input.layer as import('../core/types.js').MemoryLayerId } : {}),
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

    const lines = memories.map((m: import('../core/types.js').SearchResult, i: number) => {
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

  private async handleStore(args: unknown) {
    const input = StoreInput.parse(args);

    const storeMeta: import('../core/types.js').MemoryMeta = { wing: input.wing };
    if (input.room !== undefined) storeMeta.room = input.room;
    if (input.sourceTool !== undefined) storeMeta.sourceTool = input.sourceTool;
    if (input.pin !== undefined) storeMeta.pinned = input.pin;
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

  private async handlePredict(args: unknown) {
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
    const lines: string[] = [];
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

  private setupResourceHandlers(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'omnimind://context/predictions',
          name: 'Omnimind Predictions',
          mimeType: 'application/json',
          description: 'Current memory predictions based on activity context',
        },
        {
          uri: 'omnimind://stats/overview',
          name: 'Omnimind Stats',
          mimeType: 'application/json',
          description: 'System health and memory statistics',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      if (uri === 'omnimind://context/predictions') {
        const fingerprint = buildFingerprint({
          projectPath: process.cwd(),
          gitBranch: 'unknown',
          currentFile: 'unknown',
          recentTools: [],
          recentWings: [],
          recentRooms: [],
        });

        const predictions = await this.predictor.predict(fingerprint, async (id) => {
          const result = await this.store.get(id);
          return result.ok ? result.value : null;
        });

        const predStats = this.predictor.getStats();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  timestamp: Date.now(),
                  predictions: predictions.ok ? predictions.value : [],
                  stats: predStats,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (uri === 'omnimind://stats/overview') {
        const stats = await this.store.getStats();
        const busStats = this.bus.getStats();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  memories: stats.ok ? stats.value : null,
                  bus: busStats,
                  predictor: this.predictor.getStats(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });
  }

  private setupPromptHandlers(): void {
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'memory-aware',
          description: 'System prompt with injected memory predictions',
        },
      ],
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === 'memory-aware') {
        const fingerprint = buildFingerprint({
          projectPath: process.cwd(),
          gitBranch: 'unknown',
          currentFile: 'unknown',
          recentTools: [],
          recentWings: [],
          recentRooms: [],
        });

        const predictions = await this.predictor.predict(fingerprint, async (id) => {
          const result = await this.store.get(id);
          return result.ok ? result.value : null;
        });

        let injectionText = '';
        if (predictions.ok && predictions.value.length > 0) {
          const lines = [];
          for (const pred of predictions.value.slice(0, 3)) {
            const mem = await this.store.get(pred.memoryId);
            if (mem.ok && mem.value) {
              lines.push(`[${mem.value.wing}] ${mem.value.content.substring(0, 200)}`);
            }
          }
          if (lines.length > 0) {
            injectionText = `\n<omnimind_predictions>\n${lines.join('\n')}\n</omnimind_predictions>\n`;
          }
        }

        return {
          description: 'Memory-aware system prompt',
          messages: [
            {
              role: 'system',
              content: {
                type: 'text',
                text: `You have access to the user's Omnimind memory system.${injectionText}`,
              },
            },
          ],
        };
      }

      throw new Error(`Unknown prompt: ${request.params.name}`);
    });
  }

  private async handleStatus() {
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
    const busStats = this.bus.getStats();

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
            ``,
            `Bus:`,
            `  Adapters: ${busStats.adapterCount}`,
            `  Events published: ${busStats.eventsPublished}`,
            `  Events routed: ${busStats.eventsRouted}`,
            `  Conflicts: ${busStats.conflictsDetected} detected, ${busStats.conflictsResolved} resolved`,
          ].join('\n'),
        },
      ],
    };
  }

  private async handleSubscribe(args: unknown) {
    const input = SubscribeInput.parse(args);

    // Use a generic tool ID for MCP subscriptions
    const toolId = 'mcp-client';

    const eventTypes = input.eventTypes ?? [EventType.Create, EventType.Update, EventType.Delete];

    const filter: import('../bus/types.js').BusSubscription['filter'] = {};
    if (input.wings !== undefined) (filter as Record<string, unknown>).wings = input.wings;
    (filter as Record<string, unknown>).eventTypes = eventTypes as import('../bus/types.js').EventType[];
    this.bus.subscribe(toolId, filter);

    return {
      content: [
        {
          type: 'text',
          text: `Subscribed to ${input.wings?.join(', ') ?? 'all wings'} for events: ${eventTypes.join(', ')}`,
        },
      ],
    };
  }

  private async handleSync(args: unknown) {
    const input = SyncInput.parse(args);
    const toolId = input.toolId ?? 'mcp-client';

    const events = await this.bus.sync(toolId, input.since);
    if (!events.ok) {
      throw events.error;
    }

    if (events.value.length === 0) {
      return {
        content: [{ type: 'text', text: 'No new events to sync.' }],
      };
    }

    const lines = events.value.map((e) =>
      `[${e.sourceTool}] ${e.payload.wing ?? 'general'}: ${e.payload.content?.substring(0, 200) ?? ''}`,
    );

    return {
      content: [
        {
          type: 'text',
          text: `Synced ${events.value.length} events:\n${lines.join('\n')}`,
        },
      ],
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Convert Zod schema to JSON schema for MCP */
function convertZodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown>;
}

// ─── Entry Point ──────────────────────────────────────────────────

const server = new OmnimindMcpServer();
server.start().catch(console.error);
