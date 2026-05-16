<script lang="ts">
  import { setError } from '../stores.svelte.ts';
  import { api } from '../api';

  type Conflict = {
    resolution: string;
    winningEvent: { sourceTool: string; payload: { wing?: string; content?: string } };
    losingEvent: { sourceTool: string; payload: { wing?: string; content?: string } };
    explanation: string;
    action: string;
  };

  let conflicts = $state<Conflict[]>([]);
  let isLoading = $state(false);

  async function loadConflicts() {
    isLoading = true;
    try {
      const res = await api.conflicts();
      conflicts = res.conflicts;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conflicts');
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold text-[var(--text-h)]">Sync Conflicts</h2>
    <button
      onclick={loadConflicts}
      class="px-3 py-1.5 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if conflicts.length === 0 && !isLoading}
    <div class="text-center py-12 text-[var(--text-muted)]">
      <p>No conflicts detected.</p>
      <p class="text-sm mt-1">Cross-tool memory conflicts will appear here.</p>
    </div>
  {:else}
    <div class="grid gap-3">
      {#each conflicts as conflict}
        <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-xs px-2 py-0.5 rounded-full
              {conflict.resolution === 'accepted' ? 'bg-green-500/20 text-green-300' :
               conflict.resolution === 'merged' ? 'bg-blue-500/20 text-blue-300' :
               'bg-amber-500/20 text-amber-300'}">
              {conflict.resolution}
            </span>
            <span class="text-xs text-[var(--text-muted)]">{conflict.action}</span>
          </div>

          <p class="text-sm text-[var(--text)] mb-3">{conflict.explanation}</p>

          <div class="grid grid-cols-2 gap-3 text-xs">
            <div class="bg-[var(--bg)] rounded-lg p-3 border border-green-500/20">
              <div class="text-green-400 font-medium mb-1">Winner — {conflict.winningEvent.sourceTool}</div>
              <div class="text-[var(--text-muted)]">{conflict.winningEvent.payload.wing ?? 'general'}</div>
              <div class="text-[var(--text)] mt-1 line-clamp-2">{conflict.winningEvent.payload.content ?? ''}</div>
            </div>
            <div class="bg-[var(--bg)] rounded-lg p-3 border border-red-500/20">
              <div class="text-red-400 font-medium mb-1">Loser — {conflict.losingEvent.sourceTool}</div>
              <div class="text-[var(--text-muted)]">{conflict.losingEvent.payload.wing ?? 'general'}</div>
              <div class="text-[var(--text)] mt-1 line-clamp-2">{conflict.losingEvent.payload.content ?? ''}</div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
