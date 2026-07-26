#!/usr/bin/env node
/**
 * Omnimind HTTP API Server
 *
 * Lightweight REST server wrapping the Omnimind engine.
 * Designed to run as a Tauri sidecar process.
 *
 * Endpoints:
 *   GET  /api/health
 *   GET  /api/memories?q=&limit=&wing=&room
 *   POST /api/memories        { content, wing, room, sourceTool }
 *   GET  /api/memories/:id
 *   DELETE /api/memories/:id
 *   GET  /api/search?q=&limit=&wing=&room
 *   GET  /api/predictions
 *   GET  /api/stats
 *   GET  /api/graph?entityId=&depth=
 *   GET  /api/bus/status
 *   POST /api/bus/sync
 *   POST /api/import          { json }
 *   GET  /api/export
 *   POST /api/age
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';
import { readFile } from 'fs/promises';
import { resolve, extname } from 'path';
import { fileURLToPath } from 'url';
import { Omnimind } from './index.js';
import { type EntityType } from './core/types.js';
import {
  runSetup,
  getClientsStatus,
  buildExplicitEntry,
  MCP_CLIENTS,
  type McpClientId,
} from './setup/mcpSetup.js';
import { installCliWrapper, isCliInstalled } from './setup/installCli.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const STATIC_DIR = resolve(__dirname, '../gui/dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const PORT = process.env.OMNIMIND_PORT ? parseInt(process.env.OMNIMIND_PORT, 10) : 8844;
const DATA_DIR = process.env.OMNIMIND_DATA_DIR;

let omni: Omnimind | null = null;
let serverPort = 0;

async function main(): Promise<void> {
  const skipAdapters = process.env.OMNIMIND_SKIP_ADAPTERS === '1';
  omni = await Omnimind.create({ dataDir: DATA_DIR, adapters: !skipAdapters });

  const server = createServer((req, res) => {
    // CORS for Tauri origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    handleRequest(req, res).catch((err) => {
      console.error('[Server] Unhandled error:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    });
  });

  server.listen(PORT, () => {
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      serverPort = addr.port;
      console.log(`[Omnimind Server] Listening on http://localhost:${serverPort}`);
      // Signal parent process (Tauri) that we're ready
      if (process.send) {
        process.send({ type: 'ready', port: serverPort });
      }
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => shutdown(server));
  process.on('SIGINT', () => shutdown(server));
}

async function serveStatic(_req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<void> {
  const filePath = resolve(STATIC_DIR, urlPath === '/' ? 'index.html' : urlPath.slice(1));
  console.log('[Static] Request:', urlPath, '→ trying:', filePath);
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    try {
      const data = await readFile(resolve(STATIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(data);
    } catch {
      sendJson(res, 404, { error: 'Not found' });
    }
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${serverPort}`);
  const method = req.method ?? 'GET';
  const path = url.pathname;

  if (method === 'GET' && !path.startsWith('/api/')) {
    await serveStatic(req, res, path);
    return;
  }

  // Health check
  if (path === '/api/health' && method === 'GET') {
    sendJson(res, 200, { status: 'ok', version: '0.6.8' });
    return;
  }

  // Memories list / create
  if (path === '/api/memories') {
    if (method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
      const wing = url.searchParams.get('wing') ?? undefined;
      const room = url.searchParams.get('room') ?? undefined;
      const namespace = url.searchParams.get('namespace') ?? undefined;
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const timeRange = from && to ? [parseInt(from, 10), parseInt(to, 10)] as const : undefined;

      const result = await omni!.search(query, { limit, wing, room, namespace, timeRange });
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
      }
      // Feed prediction learning: GUI usage counts as context access too
      for (const r of result.value.slice(0, 5)) {
        omni!.activityTracker.recordMemoryAccess(r.memory.id);
      }
      sendJson(res, 200, { memories: result.value });
      return;
    }

    if (method === 'POST') {
      const body = await readBody(req);
      const content = body.content as string | undefined;
      const wing = body.wing as string | undefined;
      const room = body.room as string | undefined;
      const sourceTool = body.sourceTool as string | undefined;
      const namespace = body.namespace as string | undefined;
      if (!content || !wing) {
        sendJson(res, 400, { error: 'content and wing are required' });
        return;
      }
      const result = await omni!.store(content, { wing, room, sourceTool, namespace });
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
      }
      // Feed prediction learning: storing in this context is a signal
      omni!.activityTracker.recordMemoryAccess(result.value.id);
      sendJson(res, 201, { memory: result.value });
      return;
    }
  }

  // Memory by ID
  const memoryMatch = path.match(/^\/api\/memories\/(.+)$/);
  if (memoryMatch) {
    const id = memoryMatch[1]!;

    if (method === 'GET') {
      const result = await omni!.get(id);
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
      }
      if (!result.value) {
        sendJson(res, 404, { error: 'Memory not found' });
        return;
      }
      // Feed prediction learning: reading a memory is an access
      omni!.activityTracker.recordMemoryAccess(id);
      sendJson(res, 200, { memory: result.value });
      return;
    }

    if (method === 'DELETE') {
      const result = await omni!.delete(id);
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
      }
      sendJson(res, 204, null);
      return;
    }

    if (method === 'PUT') {
      const body = await readBody(req);
      const updates: { content?: string; wing?: string; room?: string; pinned?: boolean } = {};
      if (body.content !== undefined) updates.content = body.content as string;
      if (body.wing !== undefined) updates.wing = body.wing as string;
      if (body.room !== undefined) updates.room = body.room as string;
      if (body.pinned !== undefined) updates.pinned = Boolean(body.pinned);
      if (Object.keys(updates).length === 0) {
        sendJson(res, 400, { error: 'No fields to update' });
        return;
      }
      const result = await omni!.update(id, updates);
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
      }
      sendJson(res, 200, { memory: result.value });
      return;
    }
  }

  // Search
  if (path === '/api/search' && method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
    const namespace = url.searchParams.get('namespace') ?? undefined;
    const namespacesParam = url.searchParams.get('namespaces');
    const namespaces = namespacesParam ? namespacesParam.split(',') : undefined;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const timeRange = from && to ? [parseInt(from, 10), parseInt(to, 10)] as const : undefined;
    const result = await omni!.search(query, { limit, namespace, namespaces, timeRange });
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    // Feed prediction learning: record top search hits as context accesses
    for (const r of result.value.slice(0, 5)) {
      omni!.activityTracker.recordMemoryAccess(r.memory.id);
    }
    sendJson(res, 200, { results: result.value });
    return;
  }

  // Predictions
  if (path === '/api/predictions' && method === 'GET') {
    const projectPath = url.searchParams.get('projectPath') ?? process.cwd();
    const currentFile = url.searchParams.get('currentFile') ?? 'unknown';
    const result = await omni!.predict({
      projectPath,
      gitBranch: 'unknown',
      currentFile,
      recentTools: [],
    });
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { predictions: result.value });
    return;
  }

  // Stats
  if (path === '/api/stats' && method === 'GET') {
    const stats = await omni!.stats();
    const busStats = omni!.bus.getStats();
    const predStats = omni!.predictor.getStats();
    const activityStats = omni!.getActivityStats();

    sendJson(res, 200, {
      store: stats.ok ? stats.value : null,
      bus: busStats,
      predictor: predStats,
      activity: activityStats,
    });
    return;
  }

  // Entities
  if (path === '/api/entities' && method === 'GET') {
    const opts: { type?: EntityType; search?: string; limit?: number } = {};
    const type = url.searchParams.get('type');
    const search = url.searchParams.get('search');
    const limit = url.searchParams.get('limit');
    const validEntityTypes: EntityType[] = ['person', 'project', 'concept', 'file', 'api', 'class'];
    if (type && validEntityTypes.includes(type as EntityType)) {
      opts.type = type as EntityType;
    }
    if (search) opts.search = search;
    if (limit) opts.limit = parseInt(limit, 10);
    const result = omni!.getEntities(opts);
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { entities: result.value });
    return;
  }

  // Relations
  if (path === '/api/relations' && method === 'GET') {
    const opts: { subjectId?: string; objectId?: string; predicate?: string; limit?: number } = {};
    const subjectId = url.searchParams.get('subjectId');
    const objectId = url.searchParams.get('objectId');
    const predicate = url.searchParams.get('predicate');
    const limit = url.searchParams.get('limit');
    if (subjectId) opts.subjectId = subjectId;
    if (objectId) opts.objectId = objectId;
    if (predicate) opts.predicate = predicate;
    if (limit) opts.limit = parseInt(limit, 10);
    const result = omni!.getRelations(opts);
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { relations: result.value });
    return;
  }

  // Graph
  if (path === '/api/graph' && method === 'GET') {
    const entityId = url.searchParams.get('entityId') ?? undefined;
    const depth = parseInt(url.searchParams.get('depth') ?? '1', 10);
    if (entityId) {
      const result = omni!.getSubgraph(entityId, depth);
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
      }
      sendJson(res, 200, result.value);
      return;
    }
    // Fallback: return a coherent subgraph sample — keep only relations
    // whose endpoints are both in the returned entity set. Dangling
    // references otherwise break graph rendering ("node not found").
    const entResult = omni!.getEntities({ limit: 500 });
    if (!entResult.ok) {
      sendJson(res, 500, { error: 'Failed to load graph data' });
      return;
    }
    const entityIds = new Set(entResult.value.map((e) => e.id));
    const relResult = omni!.getRelations({ limit: 5000 });
    if (!relResult.ok) {
      sendJson(res, 500, { error: 'Failed to load graph data' });
      return;
    }
    const relations = relResult.value
      .filter((r) => entityIds.has(r.subjectId) && entityIds.has(r.objectId))
      .slice(0, 1000);
    sendJson(res, 200, { entities: entResult.value, relations });
    return;
  }

  // Settings
  if (path === '/api/settings') {
    if (method === 'GET') {
      const result = omni!.getSettings();
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
      }
      sendJson(res, 200, result.value);
      return;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const key = body.key as string | undefined;
      const value = body.value as string | undefined;
      if (!key || value === undefined) {
        sendJson(res, 400, { error: 'key and value are required' });
        return;
      }
      const result = omni!.setSetting(key, String(value));
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  // MCP client setup (Connect AI tools)
  if (path === '/api/setup/clients' && method === 'GET') {
    const cliTargets = process.env.OMNIMIND_CLI_TARGETS?.split(':');
    sendJson(res, 200, {
      clients: getClientsStatus(),
      cli: { installed: isCliInstalled(cliTargets ? { targets: cliTargets } : {}) },
    });
    return;
  }

  if (path === '/api/setup/register' && method === 'POST') {
    const body = await readBody(req);
    const requested = body.clients as string[] | undefined;
    const validIds = new Set(MCP_CLIENTS.map((c) => c.id));
    const invalid = (requested ?? []).filter((id) => !validIds.has(id as McpClientId));
    if (invalid.length > 0) {
      sendJson(res, 400, { error: `Unknown clients: ${invalid.join(', ')}` });
      return;
    }

    // Explicit entry: this server's own Node binary + bundled mcp-server.js,
    // so no npm/npx install is required (works for DMG users).
    const entry = buildExplicitEntry(
      process.execPath,
      resolve(__dirname, 'mcp-server.js'),
    );
    try {
      const results = runSetup({
        ...(requested !== undefined ? { clients: requested as McpClientId[] } : {}),
        entry,
      });
      sendJson(res, 200, {
        registered: results.map((r) => ({ id: r.client.id, name: r.client.name, path: r.path })),
        clients: getClientsStatus(),
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (path === '/api/setup/install-cli' && method === 'POST') {
    const cliTargets = process.env.OMNIMIND_CLI_TARGETS?.split(':');
    const result = installCliWrapper({
      nodePath: process.execPath,
      cliPath: resolve(__dirname, 'cli.js'),
      ...(cliTargets ? { targets: cliTargets } : {}),
    });
    if (result.ok) {
      sendJson(res, 200, { ok: true, path: result.path });
    } else {
      sendJson(res, 400, { error: result.error });
    }
    return;
  }

  // Bus status
  if (path === '/api/bus/status' && method === 'GET') {
    sendJson(res, 200, omni!.bus.getStats());
    return;
  }

  // Bus conflicts
  if (path === '/api/bus/conflicts' && method === 'GET') {
    const result = omni!.getConflictReport();
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { conflicts: result.value });
    return;
  }

  // Bus sync
  if (path === '/api/bus/sync' && method === 'POST') {
    const body = await readBody(req);
    const toolId = body.toolId as string | undefined;
    const result = await omni!.sync(toolId ?? 'gui-client');
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { events: result.value });
    return;
  }

  // Context injection
  if (path === '/api/context' && method === 'GET') {
    const result = await omni!.getContextInjection();
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { injection: result.value });
    return;
  }

  // Import memories from JSON
  if (path === '/api/import' && method === 'POST') {
    const body = await readBody(req);
    const json = body.json as string | undefined;
    if (!json) {
      sendJson(res, 400, { error: 'json is required' });
      return;
    }
    const result = await omni!.importFromJson(json);
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { imported: result.value });
    return;
  }

  // Export memories to JSON
  if (path === '/api/export' && method === 'GET') {
    const result = omni!.exportToJson();
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, JSON.parse(result.value));
    return;
  }

  // Bulk age all eligible memories
  if (path === '/api/age' && method === 'POST') {
    const result = await omni!.bulkAge();
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, result.value);
    return;
  }

  // Evict stale memories to archive
  if (path === '/api/evict' && method === 'POST') {
    const body = await readBody(req);
    const maxAgeDays = body.maxAgeDays !== undefined ? parseInt(String(body.maxAgeDays), 10) : undefined;
    const limit = body.limit !== undefined ? parseInt(String(body.limit), 10) : undefined;
    const result = omni!.evict({ maxAgeDays, limit });
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { evicted: result.value });
    return;
  }

  // Archive: list
  if (path === '/api/archive' && method === 'GET') {
    const namespace = url.searchParams.get('namespace') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const result = omni!.listArchive({ namespace, limit, offset });
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { archive: result.value });
    return;
  }

  // Archive: search
  if (path === '/api/archive/search' && method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    const namespace = url.searchParams.get('namespace') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const result = omni!.searchArchive(query, { namespace, limit });
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { archive: result.value });
    return;
  }

  // Archive: restore single
  if (path === '/api/archive/restore' && method === 'POST') {
    const body = await readBody(req);
    const id = body.id as string | undefined;
    if (!id) {
      sendJson(res, 400, { error: 'id is required' });
      return;
    }
    const result = omni!.restoreFromArchive(id);
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { memory: result.value });
    return;
  }

  // Archive: restore all
  if (path === '/api/archive/restore/all' && method === 'POST') {
    const body = await readBody(req);
    const namespace = body.namespace as string | undefined;
    const limit = body.limit !== undefined ? parseInt(String(body.limit), 10) : undefined;
    const result = omni!.restoreAllFromArchive({ namespace, limit });
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { restored: result.value });
    return;
  }

  // Wisdom patterns: list
  if (path === '/api/wisdom' && method === 'GET') {
    const predicate = url.searchParams.get('predicate') ?? undefined;
    const minFrequency = url.searchParams.get('minFrequency') ? parseInt(url.searchParams.get('minFrequency')!, 10) : undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const result = omni!.getWisdomPatterns({ predicate, minFrequency, limit });
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { patterns: result.value });
    return;
  }

  // Wisdom patterns: aggregate
  if (path === '/api/wisdom/aggregate' && method === 'POST') {
    const body = await readBody(req);
    const minFrequency = body.minFrequency !== undefined ? parseInt(String(body.minFrequency), 10) : undefined;
    const result = omni!.aggregateWisdomPatterns(minFrequency);
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
    }
    sendJson(res, 200, { aggregated: result.value });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function shutdown(server: ReturnType<typeof createServer>): void {
  console.log('[Omnimind Server] Shutting down...');
  omni?.close();
  server.close(() => {
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
