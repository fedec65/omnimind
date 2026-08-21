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
  InitializeRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { randomUUID } from 'crypto';
import { MemoryStore } from '../core/MemoryStore.js';
import { IntentPredictor, buildFingerprint, resolveGitBranch } from '../prediction/IntentPredictor.js';
import { MemoryBus } from '../bus/MemoryBus.js';
import { Omnimind } from '../index.js';
import { getNerEngineInfo } from '../core/ner/NerEngine.js';
import { EventType } from '../bus/types.js';
import { join } from 'path';
import { readFileSync } from 'node:fs';

/** Version reported to MCP clients, read from package.json (dist/mcp → repo root) */
const SERVER_VERSION = ((): string => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
import { homedir } from 'os';
import { URLSearchParams, pathToFileURL } from 'node:url';
import { NamespaceRegistry } from './namespace.js';
import { compressContext } from '../prediction/ContextCompressor.js';
import { ContextInjector } from '../prediction/ContextInjector.js';

// ─── Schemas ──────────────────────────────────────────────────────

const SearchInput = z.object({
  query: z.string().min(1).max(1000).describe('Search query text'),
  limit: z.number().min(1).max(50).optional().describe('Maximum results (default: 10)'),
  wing: z.string().optional().describe('Filter by wing/category'),
  room: z.string().optional().describe('Filter by room/subcategory'),
  namespace: z.string().optional().describe('Filter by agent namespace (default: default)'),
  layer: z.number().min(0).max(3).optional().describe('Filter by memory layer (0-3)'),
});

const StoreInput = z.object({
  content: z.string().min(1).max(10000).describe('Memory content to store'),
  wing: z.string().min(1).max(100).describe('Wing/category (e.g., "project-alpha")'),
  room: z.string().max(100).optional().describe('Room/subcategory (e.g., "architecture")'),
  sourceTool: z.string().max(50).optional().describe('Tool that created this memory'),
  namespace: z.string().optional().describe('Agent namespace (default: default)'),
  pin: z.boolean().optional().describe('Pin this memory to prevent aging'),
});

const StoreConversationInput = z.object({
  turns: z.array(z.string().min(1)).min(1).describe('Array of conversation turns (e.g., ["user: Hello", "assistant: Hi there"])'),
  wing: z.string().min(1).max(100).describe('Wing/category'),
  room: z.string().max(100).optional().describe('Room/subcategory'),
  sourceTool: z.string().max(50).optional().describe('Tool that created this memory'),
  namespace: z.string().optional().describe('Agent namespace (default: default)'),
  sourceId: z.string().optional().describe('Shared session ID for all turns'),
  pin: z.boolean().optional().describe('Pin these memories to prevent aging'),
});

const PredictInput = z.object({
  projectPath: z.string().describe('Current project directory'),
  gitBranch: z.string().optional().describe('Current git branch'),
  currentFile: z.string().optional().describe('Currently open file'),
  recentTools: z.array(z.string()).optional().describe('Recently used tools'),
  namespace: z.string().optional().describe('Agent namespace for predictions (default: default)'),
});

const SubscribeInput = z.object({
  wings: z.array(z.string()).optional().describe('Wings to subscribe to'),
  rooms: z.array(z.string()).optional().describe('Rooms to subscribe to'),
  namespaces: z.array(z.string()).optional().describe('Namespaces to subscribe to (default: same as client)'),
  eventTypes: z.array(z.enum(['create', 'update', 'delete'])).optional().describe('Event types to subscribe to'),
});

const SyncInput = z.object({
  since: z.number().optional().describe('Unix timestamp — get events after this time'),
  toolId: z.string().optional().describe('Only sync from specific tool (e.g., "cursor")'),
});

const CompressContextInput = z.object({
  history: z.string().describe('Chat history or context to compress'),
  tokenBudget: z.number().min(1).max(2000).describe('Max tokens in the output'),
});

// ─── Server Implementation ────────────────────────────────────────

export class OmnimindMcpServer {
  private server: Server;
  private store: MemoryStore;
  private predictor: IntentPredictor;
  private bus: MemoryBus;
  /** Facade backing this server once init() runs — single source of wiring. */
  private omni: Omnimind | null = null;
  private initialized = false;
  private clientNamespace: string = 'default';
  private instanceId: string = randomUUID();
  private static registry = new NamespaceRegistry();

  constructor() {
    const dbPath = join(homedir(), '.omnimind', 'memory.db');
    this.store = new MemoryStore({ dbPath });
    this.predictor = new IntentPredictor();
    this.bus = new MemoryBus(this.store);

    this.server = new Server(
      {
        name: 'omnimind',
        version: SERVER_VERSION,
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
    // Ride on the Omnimind facade so the MCP server shares the exact same
    // wiring as every other entry point: pattern persistence (PatternStore),
    // activity tracking, aging pipeline, and bus adapters.
    this.omni = await Omnimind.create({
      dataDir: process.env.OMNIMIND_DATA_DIR ?? join(homedir(), '.omnimind'),
    });

    // Swap the constructor's standalone components for the facade's wired ones.
    // (The constructor's MemoryStore is lazy — it never opened the DB.)
    this.store = this.omni.memoryStore;
    this.predictor = this.omni.predictor;
    this.bus = this.omni.bus;

    this.initialized = true;
    console.error('[Omnimind MCP] Server initialized');

    // Backfill aging in the background — aging is otherwise lazy (on access),
    // so memories that are never read would sit at L0 forever. Fire-and-forget:
    // the loop awaits per memory, keeping the stdio server responsive.
    void this.omni.bulkAge()
      .then((result) => {
        if (result.ok && result.value.aged > 0) {
          console.error(
            `[Omnimind MCP] Startup aging: ${result.value.aged} aged, ${result.value.skipped} skipped`,
          );
        }
      })
      .catch((e) => console.error('[Omnimind MCP] Startup aging failed:', e));
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
    // Bind client identity -> namespace from the initialize handshake.
    // Per MCP spec this is the first request on a connection; the binding
    // is then stable for the rest of the connection's lifetime.
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const info = request.params.clientInfo;
      this.clientNamespace = OmnimindMcpServer.registry.register(this.instanceId, info);
      console.error(
        `[Omnimind MCP] Client bound to namespace: ${this.clientNamespace} (client: ${info?.name ?? 'unknown'})`,
      );
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'omnimind', version: SERVER_VERSION },
      };
    });

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
          name: 'omnimind_store_conversation',
          description: 'Store a conversation as individual turns for fine-grained retrieval. Each turn gets its own embedding so a single relevant turn can surface the entire session.',
          inputSchema: convertZodToJsonSchema(StoreConversationInput),
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
        {
          name: 'omnimind_compress_context',
          description: 'Compress a chat history to a token budget while preserving any <omnimind_predictions> blocks intact. Use this when the host LLM is about to truncate a long context and you want Omnimind\'s predictions to survive.',
          inputSchema: convertZodToJsonSchema(CompressContextInput),
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
          case 'omnimind_store_conversation':
            return await this.handleStoreConversation(request.params.arguments);
          case 'omnimind_predict':
            return await this.handlePredict(request.params.arguments);
          case 'omnimind_status':
            return await this.handleStatus();
          case 'omnimind_subscribe':
            return await this.handleSubscribe(request.params.arguments);
          case 'omnimind_sync':
            return await this.handleSync(request.params.arguments);
          case 'omnimind_compress_context':
            return await this.handleCompressContext(request.params.arguments);
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

    // Default the read side to the auto-derived client namespace so two
    // connected clients cannot see each other's memories. Explicit
    // `namespace` parameter always wins. The default-client case still
    // sees cross-namespace results (preserves current behavior).
    const effectiveNamespace =
      input.namespace ?? (this.clientNamespace !== 'default' ? this.clientNamespace : undefined);

    const searchOpts: import('../core/types.js').SearchOptions = {
      limit: input.limit,
      ...(input.wing !== undefined ? { wing: input.wing } : {}),
      ...(input.room !== undefined ? { room: input.room } : {}),
      ...(effectiveNamespace !== undefined ? { namespace: effectiveNamespace } : {}),
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

    // Facade wiring: feed prediction learning and lazy aging on access.
    // Only meaningful after init(); tests inject a bare store and skip this.
    if (this.omni) {
      for (const m of memories.slice(0, 5)) {
        this.omni.activityTracker.recordMemoryAccess(m.memory.id);
        void this.omni.checkAging(m.memory.id).catch(() => {});
      }
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
    storeMeta.namespace = input.namespace ?? this.clientNamespace;
    if (input.pin !== undefined) storeMeta.pinned = input.pin;
    const result = await this.store.store(input.content, storeMeta);

    if (!result.ok) {
      throw result.error;
    }

    const memory = result.value;
    // Facade wiring: storing in this context is a prediction-learning signal.
    this.omni?.activityTracker.recordMemoryAccess(memory.id);
    return {
      content: [
        {
          type: 'text',
          text: `Stored memory ${memory.id.substring(0, 8)} in ${memory.wing}/${memory.room}.`,
        },
      ],
    };
  }

  private async handleStoreConversation(args: unknown) {
    const input = StoreConversationInput.parse(args);

    const storeMeta: import('../core/types.js').MemoryMeta = { wing: input.wing };
    if (input.room !== undefined) storeMeta.room = input.room;
    if (input.sourceTool !== undefined) storeMeta.sourceTool = input.sourceTool;
    storeMeta.namespace = input.namespace ?? this.clientNamespace;
    if (input.sourceId !== undefined) storeMeta.sourceId = input.sourceId;
    if (input.pin !== undefined) storeMeta.pinned = input.pin;

    const result = await this.store.storeTurns(input.turns, storeMeta);

    if (!result.ok) {
      throw result.error;
    }

    const memories = result.value;
    // Facade wiring: prediction-learning signal for each stored turn.
    if (this.omni) {
      for (const m of memories) {
        this.omni.activityTracker.recordMemoryAccess(m.id);
      }
    }
    return {
      content: [
        {
          type: 'text',
          text: `Stored ${memories.length} conversation turns in ${memories[0]!.wing}/${memories[0]!.room} with shared sourceId ${memories[0]!.sourceId}.`,
        },
      ],
    };
  }

  private async handlePredict(args: unknown) {
    const input = PredictInput.parse(args);

    const fingerprint = buildFingerprint({
      projectPath: input.projectPath,
      // Align with the recording side: real branch, empty extension when
      // no file is known (never the literal 'unknown').
      gitBranch: input.gitBranch ?? resolveGitBranch(input.projectPath),
      currentFile: input.currentFile ?? '',
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
        {
          uri: 'omnimind://memories/recent',
          name: 'Recent Memories',
          mimeType: 'application/json',
          description:
            'Most recent memories in the active namespace. Append ?limit=N (default 20, max 100) and ?namespace=foo to override.',
        },
        {
          uri: 'omnimind://entities/list',
          name: 'Knowledge Graph Entities',
          mimeType: 'application/json',
          description: 'All entities extracted from stored memories.',
        },
        {
          uri: 'omnimind://relations/list',
          name: 'Knowledge Graph Relations',
          mimeType: 'application/json',
          description: 'All relations between entities (subject-predicate-object triples).',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
      this.handleReadResource(request.params.uri),
    );
  }

  /** Public-for-tests: handle a resources/read request by URI. */
  async handleReadResource(uri: string) {
    if (uri === 'omnimind://context/predictions') {
        const fingerprint = buildFingerprint({
          projectPath: process.cwd(),
          gitBranch: process.env.GIT_BRANCH ?? resolveGitBranch(process.cwd()),
          currentFile: process.env.CURRENT_FILE ?? '',
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

      if (uri.startsWith('omnimind://memories/recent')) {
        const params = this.parseResourceQuery(uri);
        const requestedLimit = Number(params.get('limit') ?? 20);
        const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 20));
        const overrideNamespace = params.get('namespace') ?? undefined;
        const effectiveNamespace =
          overrideNamespace ?? (this.clientNamespace !== 'default' ? this.clientNamespace : undefined);

        const idsResult = this.store.getAllMemoryIds();
        const memories: unknown[] = [];
        if (idsResult.ok) {
          for (const id of idsResult.value) {
            const r = await this.store.get(id);
            if (r.ok && r.value) {
              if (effectiveNamespace && r.value.namespace !== effectiveNamespace) continue;
              memories.push(r.value);
            }
          }
        }
        memories.sort((a, b) => (b as { createdAt: number }).createdAt - (a as { createdAt: number }).createdAt);
        const slice = memories.slice(0, limit);

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  namespace: effectiveNamespace ?? 'all',
                  count: slice.length,
                  memories: slice,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (uri === 'omnimind://entities/list') {
        const entitiesResult = this.store.queryEntities({ limit: 1000 });
        const entities = entitiesResult.ok ? entitiesResult.value : [];
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ count: entities.length, entities }, null, 2),
            },
          ],
        };
      }

      if (uri === 'omnimind://relations/list') {
        const relationsResult = this.store.queryRelations({ limit: 1000 });
        const relations = relationsResult.ok ? relationsResult.value : [];
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ count: relations.length, relations }, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
  }

  private parseResourceQuery(uri: string): URLSearchParams {
    const qIdx = uri.indexOf('?');
    if (qIdx < 0) return new URLSearchParams();
    return new URLSearchParams(uri.slice(qIdx + 1));
  }

  private setupPromptHandlers(): void {
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'memory-aware',
          description: 'System prompt with injected memory predictions',
          arguments: [
            {
              name: 'projectPath',
              description: 'Current project directory',
              required: false,
            },
            {
              name: 'gitBranch',
              description: 'Current git branch',
              required: false,
            },
            {
              name: 'currentFile',
              description: 'Currently open file',
              required: false,
            },
          ],
        },
        {
          name: 'compact-context',
          description:
            'Compact a long conversation history to fit a token budget while preserving <omnimind_predictions> blocks',
          arguments: [
            { name: 'history', description: 'Full chat history to compact', required: true },
            {
              name: 'tokenBudget',
              description: 'Max tokens in the output (default 150)',
              required: false,
            },
          ],
        },
      ],
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) =>
      this.handleGetPrompt(request.params.name, request.params.arguments ?? {}),
    );
  }

  /** Public-for-tests: handle a prompts/get request by name + args. */
  async handleGetPrompt(name: string, args: Record<string, unknown>) {
    if (name === 'memory-aware') {
      const projectPath = (args.projectPath as string) ?? process.cwd();
      const fingerprint = buildFingerprint({
        projectPath,
        gitBranch: (args.gitBranch as string) ?? resolveGitBranch(projectPath),
        currentFile: (args.currentFile as string) ?? '',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });

      const injector = new ContextInjector(
        this.predictor,
        async (id) => {
          const r = await this.store.get(id);
          return r.ok ? r.value : null;
        },
      );
      const promptResult = await injector.getMemoryAwarePrompt(fingerprint);
      if (!promptResult.ok) throw promptResult.error;

      return {
        description: 'Memory-aware system prompt',
        messages: [
          {
            role: 'system',
            content: { type: 'text', text: promptResult.value },
          },
        ],
      };
    }

    if (name === 'compact-context') {
      const history = (args.history as string) ?? '';
      const tokenBudget = Number(args.tokenBudget ?? 150);
      const result = compressContext(history, { tokenBudget });
      if (!result.ok) throw result.error;
      const r = result.value;
      const summary = `Compressed ${r.tokensBefore} -> ${r.tokensAfter} tokens.`;

      return {
        description: 'Memory-aware compacted context',
        messages: [
          {
            role: 'system',
            content: {
              type: 'text',
              text: 'You are a helpful assistant. The following is a compacted conversation history:',
            },
          },
          {
            role: 'user',
            content: { type: 'text', text: `${r.text}\n\n${summary}` },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
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
    const ner = getNerEngineInfo();
    const nerDetail = ner.configured === 'onnx'
      ? ner.modelLoaded
        ? 'onnx (multilingual model)'
        : ner.loadFailed
          ? 'heuristic (onnx unavailable, fallback)'
          : 'heuristic (onnx model loading, fallback active)'
      : 'heuristic';

    return {
      content: [
        {
          type: 'text',
          text: [
            `Omnimind Status`,
            `================`,
            `Namespace: ${this.clientNamespace}`,
            `Instance: ${this.instanceId.substring(0, 8)}`,
            `Total memories: ${s.totalMemories}`,
            `By layer:`,
            layerInfo,
            `Database size: ${(s.databaseSizeBytes / 1024 / 1024).toFixed(1)} MB`,
            `Predictor patterns: ${predStats.totalPatterns} across ${predStats.uniqueContexts} contexts`,
            `NER engine: ${nerDetail}`,
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
    if (input.namespaces !== undefined) (filter as Record<string, unknown>).namespaces = input.namespaces;
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

  private async handleCompressContext(args: unknown) {
    const input = CompressContextInput.parse(args);

    const result = compressContext(input.history, { tokenBudget: input.tokenBudget });
    if (!result.ok) {
      throw result.error;
    }

    const r = result.value;
    const summary =
      `Compressed ${r.tokensBefore} -> ${r.tokensAfter} tokens ` +
      `(kept ${r.predictionsKept} prediction block(s)` +
      `${r.predictionsTruncated ? ', some truncated' : ''}).`;

    return {
      content: [
        { type: 'text', text: r.text },
        { type: 'text', text: r.warning ? `${summary}\n${r.warning}` : summary },
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

// Auto-start only when executed directly (`node dist/mcp/server.js`).
// When imported (tests, or the mcp-server.ts bin entry) the caller
// drives start() — importing this module must have no side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = new OmnimindMcpServer();
  server.start().catch(console.error);
}
