<script lang="ts">
  import { appState } from '../stores.svelte.ts';
  import { api } from '../api';

  $effect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  });

  async function loadStats() {
    try {
      appState.stats = await api.stats();
    } catch {
      // silent fail
    }
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<div class="p-3 border-t border-[var(--border)] text-xs space-y-2">
  {#if appState.stats?.store}
    <div class="flex justify-between">
      <span class="text-[var(--text-muted)]">Memories</span>
      <span class="font-medium">{appState.stats.store.totalMemories}</span>
    </div>
    <div class="flex justify-between">
      <span class="text-[var(--text-muted)]">Size</span>
      <span class="font-medium">{formatBytes(appState.stats.store.databaseSizeBytes)}</span>
    </div>
  {/if}
  {#if appState.stats?.predictor}
    <div class="flex justify-between">
      <span class="text-[var(--text-muted)]">Patterns</span>
      <span class="font-medium">{appState.stats.predictor.totalPatterns}</span>
    </div>
  {/if}
  {#if appState.stats?.bus}
    <div class="flex justify-between">
      <span class="text-[var(--text-muted)]">Bus Events</span>
      <span class="font-medium">{appState.stats.bus.eventsPublished}</span>
    </div>
  {/if}
</div>
