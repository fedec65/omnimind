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

  memories: (q?: string, limit = 50, wing?: string, room?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    if (wing) params.set('wing', wing);
    if (room) params.set('room', room);
    return fetchJson<{ memories: SearchResult[] }>(`/api/memories?${params.toString()}`);
  },

  getMemory: (id: string) => fetchJson<{ memory: Memory }>(`/api/memories/${encodeURIComponent(id)}`),

  createMemory: (content: string, wing: string, room?: string) =>
    fetchJson<{ memory: Memory }>('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, wing, room }),
    }),

  deleteMemory: (id: string) =>
    fetch(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  predictions: () => fetchJson<{ predictions: Prediction[] }>('/api/predictions'),

  stats: () => fetchJson<SystemStats>('/api/stats'),

  context: () => fetchJson<{ injection: string }>('/api/context'),
};
