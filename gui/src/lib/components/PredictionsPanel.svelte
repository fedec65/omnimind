<script lang="ts">
  import { appState, setError } from '../stores.svelte.ts';
  import { api } from '../api';
  import type { Prediction, Memory } from '../api';

  let isLoading = $state(false);
  let predictionMemories = $state<Map<string, Memory>>(new Map());

  async function loadPredictions() {
    isLoading = true;
    try {
      const res = await api.predictions();
      appState.predictions = res.predictions;
      // Fetch full memory details for each prediction
      const memMap = new Map<string, Memory>();
      for (const pred of res.predictions) {
        try {
          const mem = await api.getMemory(pred.memoryId);
          memMap.set(pred.memoryId, mem.memory);
        } catch {
          // ignore missing memories
        }
      }
      predictionMemories = memMap;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load predictions');
    } finally {
      isLoading = false;
    }
  }

  // Load on mount (the panel is remounted on each tab switch, so this also
  // refreshes every time the Predictions tab is opened) — same pattern as
  // StatsPanel/TimelineView. Without it the tab opens empty until the user
  // clicks Refresh.
  $effect(() => {
    loadPredictions();
  });

  const layerNames = ['Verbatim', 'Compressed', 'Concept', 'Wisdom'];
  const layerColors = ['bg-blue-500/20 text-blue-300', 'bg-amber-500/20 text-amber-300', 'bg-purple-500/20 text-purple-300', 'bg-emerald-500/20 text-emerald-300'];
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold text-[var(--text-h)]">Predicted Memories</h2>
    <button
      onclick={loadPredictions}
      class="px-3 py-1.5 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if appState.predictions.length === 0 && !isLoading}
    <div class="text-center py-12 text-[var(--text-muted)]">
      <p>No predictions yet.</p>
      <p class="text-sm mt-1">Interact with memories to build prediction patterns.</p>
    </div>
  {:else}
    <div class="grid gap-3">
      {#each appState.predictions as pred}
        {@const mem = predictionMemories.get(pred.memoryId)}
        <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)]/30 transition-colors">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-2">
                {#if mem}
                  <span class="text-xs px-2 py-0.5 rounded-full {layerColors[mem.layer]}">
                    {layerNames[mem.layer]}
                  </span>
                  <span class="text-xs text-[var(--text-muted)]">{mem.wing}{mem.room ? ` / ${mem.room}` : ''}</span>
                {:else}
                  <span class="text-xs text-[var(--text-muted)]">{pred.memoryId.substring(0, 8)}</span>
                {/if}
                <span class="ml-auto text-xs font-medium text-[var(--accent)]">
                  {(pred.confidence * 100).toFixed(0)}% confidence
                </span>
              </div>
              {#if mem}
                <p class="text-sm leading-relaxed text-[var(--text)]">{mem.content}</p>
              {:else}
                <p class="text-sm text-[var(--text-muted)]">Memory details unavailable</p>
              {/if}
              {#if pred.reason}
                <p class="text-xs text-[var(--text-muted)] mt-2 italic">{pred.reason}</p>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
