/**
 * Omnimind HTTP API Client
 *
 * Talks to the Node.js sidecar server.
 */

import { invoke } from '@tauri-apps/api/core';

let baseUrlPromise: Promise<string> | null = null;

async function getBaseUrl(): Promise<string> {
  if (baseUrlPromise) return baseUrlPromise;

  baseUrlPromise = (async () => {
    // Try Tauri invoke first (bundled app)
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      try {
        const url = await invoke<string>('get_api_base');
        if (url) return url;
      } catch {
        // fall through
      }
    }
    // Fallback for dev mode or standalone browser
    return 'http://localhost:8844';
  })();

  return baseUrlPromise;
}

export interface Memory {
  id: string;
  content: string;
  wing: string;
  room: string;
  layer: number;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  pinned: boolean;
  sourceTool: string;
  sourceId: string | null;
}

export interface SearchResult {
  memory: Memory;
  score: number;
  matchType: string;
}

export interface Prediction {
  memoryId: string;
  confidence: number;
  reason: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  description: string | null;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
}

export interface Relation {
  id: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  validFrom: number | null;
  validTo: number | null;
  sourceMemory: string | null;
  confidence: number;
}

export interface ArchivedMemory {
  id: string;
  content: string;
  wing: string;
  room: string;
  layer: number;
  namespace: string;
  sourceTool: string;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  archivedAt: number;
}

export interface WisdomPattern {
  id: string;
  pattern: string;
  predicate: string;
  subjectType: string;
  objectType: string;
  frequency: number;
  namespaces: string[];
  firstSeen: number;
  lastSeen: number;
  exampleMemoryIds: string[];
}

export interface BusStats {
  adapterCount: number;
  subscriptionCount: number;
  eventsPublished: number;
  eventsRouted: number;
  conflictsDetected: number;
  conflictsResolved: number;
  deadLetterCount: number;
}

export interface McpClientStatus {
  id: 'claude-code' | 'cursor' | 'claude-desktop' | 'kimi';
  name: string;
  detected: boolean;
  configured: boolean;
  configPath: string;
}

export interface SetupClientsResponse {
  clients: McpClientStatus[];
  cli: { installed: string | null };
}

export interface RegisterResponse {
  registered: Array<{ id: string; name: string; path: string }>;
  clients: McpClientStatus[];
}

export interface SystemStats {
  store: {
    totalMemories: number;
    memoriesByLayer: Record<number, number>;
    databaseSizeBytes: number;
  } | null;
  bus: BusStats;
  predictor: { totalPatterns: number; uniqueContexts: number };
  activity: { isRunning: boolean; recentFiles: number; recentTools: number };
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetchJson<{ status: string; version?: string; phase?: string }>('/api/health'),

  search: (q: string, limit = 20, namespaces?: string[], from?: number, to?: number) => {
    const params = new URLSearchParams();
    params.set('q', q);
    params.set('limit', String(limit));
    if (namespaces) params.set('namespaces', namespaces.join(','));
    if (from) params.set('from', String(from));
    if (to) params.set('to', String(to));
    return fetchJson<{ results: SearchResult[] }>(`/api/search?${params.toString()}`);
  },

  memories: (q?: string, limit = 50, wing?: string, room?: string, namespace?: string, namespaces?: string[], from?: number, to?: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    if (wing) params.set('wing', wing);
    if (room) params.set('room', room);
    if (namespace) params.set('namespace', namespace);
    if (namespaces) params.set('namespaces', namespaces.join(','));
    if (from) params.set('from', String(from));
    if (to) params.set('to', String(to));
    return fetchJson<{ memories: SearchResult[] }>(`/api/memories?${params.toString()}`);
  },

  getMemory: (id: string) => fetchJson<{ memory: Memory }>(`/api/memories/${encodeURIComponent(id)}`),

  createMemory: (content: string, wing: string, room?: string, namespace?: string) =>
    fetchJson<{ memory: Memory }>('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, wing, room, namespace }),
    }),

  deleteMemory: (id: string) =>
    fetch(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  updateMemory: (id: string, updates: Partial<Pick<Memory, 'content' | 'wing' | 'room' | 'pinned'>>) =>
    fetchJson<{ memory: Memory }>(`/api/memories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }),

  predictions: () => fetchJson<{ predictions: Prediction[] }>('/api/predictions'),

  stats: () => fetchJson<SystemStats>('/api/stats'),

  context: () => fetchJson<{ injection: string }>('/api/context'),

  entities: (opts?: { type?: string; search?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.type) params.set('type', opts.type);
    if (opts?.search) params.set('search', opts.search);
    params.set('limit', String(opts?.limit ?? 100));
    return fetchJson<{ entities: import('./api').Entity[] }>(`/api/entities?${params.toString()}`);
  },

  relations: (opts?: { subjectId?: string; objectId?: string; predicate?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.subjectId) params.set('subjectId', opts.subjectId);
    if (opts?.objectId) params.set('objectId', opts.objectId);
    if (opts?.predicate) params.set('predicate', opts.predicate);
    params.set('limit', String(opts?.limit ?? 100));
    return fetchJson<{ relations: import('./api').Relation[] }>(`/api/relations?${params.toString()}`);
  },

  graph: (entityId?: string, depth?: number) => {
    const params = new URLSearchParams();
    if (depth !== undefined) params.set('depth', String(depth));
    const path = entityId ? `/api/graph/${encodeURIComponent(entityId)}` : '/api/graph';
    return fetchJson<{ entities: import('./api').Entity[]; relations: import('./api').Relation[] }>(`${path}?${params.toString()}`);
  },

  settings: () => fetchJson<Record<string, string>>('/api/settings'),

  setSetting: (key: string, value: string) =>
    fetchJson<{ ok: boolean }>('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }),

  importMemories: (json: string) =>
    fetchJson<{ imported: number }>('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json }),
    }),

  exportMemories: () =>
    fetchJson<{ version: string; exportedAt: number; memories: unknown[] }>('/api/export'),

  ageMemories: () =>
    fetchJson<{ aged: number; skipped: number }>('/api/age', { method: 'POST' }),

  evictMemories: (maxAgeDays?: number, limit?: number) =>
    fetchJson<{ evicted: number }>('/api/evict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxAgeDays, limit }),
    }),

  listArchive: (opts?: { namespace?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.namespace) params.set('namespace', opts.namespace);
    params.set('limit', String(opts?.limit ?? 50));
    params.set('offset', String(opts?.offset ?? 0));
    return fetchJson<{ archive: ArchivedMemory[] }>(`/api/archive?${params.toString()}`);
  },

  searchArchive: (q: string, opts?: { namespace?: string; limit?: number }) => {
    const params = new URLSearchParams();
    params.set('q', q);
    if (opts?.namespace) params.set('namespace', opts.namespace);
    params.set('limit', String(opts?.limit ?? 50));
    return fetchJson<{ archive: ArchivedMemory[] }>(`/api/archive/search?${params.toString()}`);
  },

  restoreArchive: (id: string) =>
    fetchJson<{ memory: Memory }>('/api/archive/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }),

  restoreAllArchive: (opts?: { namespace?: string; limit?: number }) =>
    fetchJson<{ restored: number }>('/api/archive/restore/all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts ?? {}),
    }),

  wisdomPatterns: (opts?: { predicate?: string; minFrequency?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.predicate) params.set('predicate', opts.predicate);
    if (opts?.minFrequency !== undefined) params.set('minFrequency', String(opts.minFrequency));
    params.set('limit', String(opts?.limit ?? 50));
    return fetchJson<{ patterns: WisdomPattern[] }>(`/api/wisdom?${params.toString()}`);
  },

  aggregateWisdom: (minFrequency?: number) =>
    fetchJson<{ aggregated: number }>('/api/wisdom/aggregate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minFrequency }),
    }),

  conflicts: () => fetchJson<{ conflicts: Array<{ resolution: string; winningEvent: { sourceTool: string; payload: { wing?: string; content?: string } }; losingEvent: { sourceTool: string; payload: { wing?: string; content?: string } }; explanation: string }> }>('/api/bus/conflicts'),

  setupClients: () => fetchJson<SetupClientsResponse>('/api/setup/clients'),

  registerMcpClients: (clients?: string[]) =>
    fetchJson<RegisterResponse>('/api/setup/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clients ? { clients } : {}),
    }),

  installCli: () =>
    fetchJson<{ ok: boolean; path?: string }>('/api/setup/install-cli', { method: 'POST' }),
};
