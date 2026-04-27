import type { SearchResult, SystemStats, Prediction } from './api.js';

export const appState = $state({
  activeTab: 'search' as 'search' | 'timeline' | 'spatial' | 'graph' | 'settings',
  searchQuery: '',
  searchResults: [] as SearchResult[],
  isSearching: false,
  selectedMemoryId: null as string | null,
  stats: null as SystemStats | null,
  predictions: [] as Prediction[],
  error: null as string | null,
});

export function setError(msg: string | null) {
  appState.error = msg;
  if (msg) {
    setTimeout(() => (appState.error = null), 5000);
  }
}
