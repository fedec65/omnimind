/**
 * Omnimind HTTP API Client
 *
 * Talks to the Node.js sidecar server.
 */

const BASE_URL = 'http://localhost:8844';

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

export interface BusStats {
  adapterCount: number;
  subscriptionCount: number;
  eventsPublished: number;
  eventsRouted: number;
  conflictsDetected: number;
  conflictsResolved: number;
  deadLetterCount: number;
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
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetchJson<{ status: string; version: string }>('/api/health'),

  search: (q: string, limit = 20) =>
    fetchJson<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  memories: (q?: string, limit = 50, wing?: string, room?: string, namespace?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    if (wing) params.set('wing', wing);
    if (room) params.set('room', room);
    if (namespace) params.set('namespace', namespace);
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
};
