<script lang="ts">
  import { appState, setError } from '../stores';
  import { api } from '../api';

  let isLoading = $state(false);

  $effect(() => {
    loadGraph();
  });

  async function loadGraph() {
    isLoading = true;
    try {
      // Placeholder — graph query not yet implemented in core
      await api.stats();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load graph');
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold">Concept Graph</h2>
    {#if isLoading}
      <div class="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"></div>
    {/if}
  </div>

  <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-12 text-center">
    <div class="text-4xl mb-4">🕸️</div>
    <h3 class="text-lg font-medium mb-2">Concept Graph Explorer</h3>
    <p class="text-sm text-[var(--text-muted)] max-w-md mx-auto">
      Visualize relationships between entities and memories.
      This feature will be fully implemented with D3.js force-directed layout in an upcoming release.
    </p>
    <div class="mt-6 inline-flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg)] px-3 py-1.5 rounded-full border border-[var(--border)]">
      <span class="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse"></span>
      Coming soon
    </div>
  </div>
</div>
