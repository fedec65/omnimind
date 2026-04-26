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
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';
import { Omnimind } from './index.js';

const PORT = process.env.OMNIMIND_PORT ? parseInt(process.env.OMNIMIND_PORT, 10) : 8844;
const DATA_DIR = process.env.OMNIMIND_DATA_DIR;

let omni: Omnimind | null = null;
let serverPort = 0;

async function main(): Promise<void> {
  omni = await Omnimind.create({ dataDir: DATA_DIR });

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

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${serverPort}`);
  const method = req.method ?? 'GET';
  const path = url.pathname;

  // Health check
  if (path === '/api/health' && method === 'GET') {
    sendJson(res, 200, { status: 'ok', version: '0.4.0' });
    return;
  }

  // Memories list / create
  if (path === '/api/memories') {
    if (method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
      const wing = url.searchParams.get('wing') ?? undefined;
      const room = url.searchParams.get('room') ?? undefined;

      const result = await omni!.search(query, { limit, wing, room });
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
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
      if (!content || !wing) {
        sendJson(res, 400, { error: 'content and wing are required' });
        return;
      }
      const result = await omni!.store(content, { wing, room, sourceTool });
      if (!result.ok) {
        sendJson(res, 500, { error: result.error.message });
        return;
      }
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
  }

  // Search
  if (path === '/api/search' && method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
    const result = await omni!.search(query, { limit });
    if (!result.ok) {
      sendJson(res, 500, { error: result.error.message });
      return;
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

  // Graph
  if (path === '/api/graph' && method === 'GET') {
    // Placeholder — full graph query not yet implemented in core
    sendJson(res, 200, { entities: [], relations: [] });
    return;
  }

  // Bus status
  if (path === '/api/bus/status' && method === 'GET') {
    sendJson(res, 200, omni!.bus.getStats());
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
