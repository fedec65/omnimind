<script lang="ts">
  import { appState, setError } from '../stores.svelte.ts';
  import { api } from '../api';
  import MemoryCard from './MemoryCard.svelte';

  let query = $state('');
  let isLoading = $state(false);

  async function doSearch() {
    if (!query.trim()) return;
    isLoading = true;
    try {
      const res = await api.search(query, 20);
      appState.searchResults = res.results;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      isLoading = false;
    }
  }

  async function createMemory() {
    const content = prompt('Memory content:');
    if (!content) return;
    const wing = prompt('Wing (category):', 'general');
    if (!wing) return;
    try {
      await api.createMemory(content, wing);
      await doSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create memory');
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') doSearch();
  }
</script>

<div class="space-y-4">
  <div class="flex items-center gap-3">
    <div class="flex-1 relative">
      <input
        type="text"
        bind:value={query}
        onkeydown={handleKeydown}
        placeholder="Search memories..."
        class="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm
          focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]
          placeholder:text-[var(--text-muted)]"
      />
      {#if isLoading}
        <div class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"></div>
      {/if}
    </div>
    <button
      onclick={doSearch}
      class="px-4 py-2.5 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
    >
      Search
    </button>
    <button
      onclick={createMemory}
      class="px-4 py-2.5 bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
    >
      + New
    </button>
  </div>

  {#if appState.searchResults.length > 0}
    <div class="text-xs text-[var(--text-muted)]">
      {appState.searchResults.length} result{appState.searchResults.length === 1 ? '' : 's'}
    </div>
    <div class="grid gap-3">
      {#each appState.searchResults as result}
        <MemoryCard {result} />
      {/each}
    </div>
  {:else if query && !isLoading}
    <div class="text-center py-12 text-[var(--text-muted)]">
      No memories found for "{query}"
    </div>
  {:else}
    <div class="text-center py-12 text-[var(--text-muted)]">
      Type a query and press Enter to search
    </div>
  {/if}
</div>
