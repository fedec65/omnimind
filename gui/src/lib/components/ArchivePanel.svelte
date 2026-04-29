<script lang="ts">
  import { api, type ArchivedMemory } from '../api';
  import { appState, setError } from '../stores.svelte.ts';

  let archive = $state<ArchivedMemory[]>([]);
  let query = $state('');
  let isLoading = $state(false);
  let offset = $state(0);
  let limit = $state(25);
  let totalEstimate = $state(0);
  let isRestoring = $state<string | null>(null);
  let isRestoringAll = $state(false);

  $effect(() => {
    loadArchive();
  });

  async function loadArchive() {
    isLoading = true;
    try {
      if (query.trim()) {
        const res = await api.searchArchive(query, { limit, offset });
        archive = res.archive;
      } else {
        const res = await api.listArchive({ limit, offset });
        archive = res.archive;
      }
      // Rough estimate for pagination
      if (archive.length === limit) {
        totalEstimate = offset + limit + 1;
      } else {
        totalEstimate = offset + archive.length;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load archive');
    } finally {
      isLoading = false;
    }
  }

  async function doSearch() {
    offset = 0;
    await loadArchive();
  }

  function nextPage() {
    offset += limit;
    loadArchive();
  }

  function prevPage() {
    offset = Math.max(0, offset - limit);
    loadArchive();
  }

  async function restore(id: string) {
    isRestoring = id;
    try {
      await api.restoreArchive(id);
      archive = archive.filter(m => m.id !== id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      isRestoring = null;
    }
  }

  async function restoreAll() {
    if (!confirm(`Restore all ${archive.length} visible archived memories?`)) return;
    isRestoringAll = true;
    try {
      const res = await api.restoreAllArchive({ limit });
      setError(`Restored ${res.restored} memories`);
      archive = [];
      offset = 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Batch restore failed');
    } finally {
      isRestoringAll = false;
    }
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString();
  }

  function formatLayer(layer: number): string {
    const labels = ['L0 Verbatim', 'L1 Compressed', 'L2 Concept', 'L3 Wisdom'];
    return labels[layer] ?? `L${layer}`;
  }
</script>

<div class="max-w-4xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-semibold text-[var(--text-h)]">Archive</h2>
    <div class="text-sm text-[var(--text-muted)]">
      {#if archive.length > 0}
        {offset + 1}–{offset + archive.length} shown
      {:else}
        No archived memories
      {/if}
    </div>
  </div>

  <!-- Search & Controls -->
  <div class="flex gap-3 mb-4">
    <input
      type="text"
      bind:value={query}
      placeholder="Search archived memories..."
      class="flex-1 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && doSearch()}
    />
    <button
      class="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
      onclick={doSearch}
      disabled={isLoading}
    >
      {isLoading ? '...' : 'Search'}
    </button>
    {#if archive.length > 0}
      <button
        class="px-4 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50"
        onclick={restoreAll}
        disabled={isRestoringAll}
      >
        {isRestoringAll ? 'Restoring...' : 'Restore All'}
      </button>
    {/if}
  </div>

  <!-- Results -->
  <div class="space-y-2">
    {#each archive as memory (memory.id)}
      <div class="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="text-sm text-[var(--text)] leading-relaxed line-clamp-3">{memory.content}</div>
            <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-[var(--text-muted)]">
              <span class="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)]">{formatLayer(memory.layer)}</span>
              <span>{memory.wing}</span>
              <span>·</span>
              <span>{memory.room}</span>
              <span>·</span>
              <span>{memory.namespace}</span>
              <span>·</span>
              <span>Archived {formatDate(memory.archivedAt)}</span>
              <span>·</span>
              <span>Created {formatDate(memory.createdAt)}</span>
            </div>
          </div>
          <button
            class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-glow)] disabled:opacity-50"
            onclick={() => restore(memory.id)}
            disabled={isRestoring === memory.id}
          >
            {isRestoring === memory.id ? '...' : 'Restore'}
          </button>
        </div>
      </div>
    {:else}
      {#if !isLoading}
        <div class="text-center py-12 text-[var(--text-muted)] text-sm">
          No archived memories found.
        </div>
      {/if}
    {/each}
  </div>

  <!-- Pagination -->
  {#if archive.length > 0 || offset > 0}
    <div class="flex items-center justify-between mt-6">
      <button
        class="px-3 py-1.5 rounded-lg text-sm border border-[var(--border)] hover:bg-[var(--surface-hover)] disabled:opacity-30"
        onclick={prevPage}
        disabled={offset === 0 || isLoading}
      >
        ← Previous
      </button>
      <button
        class="px-3 py-1.5 rounded-lg text-sm border border-[var(--border)] hover:bg-[var(--surface-hover)] disabled:opacity-30"
        onclick={nextPage}
        disabled={archive.length < limit || isLoading}
      >
        Next →
      </button>
    </div>
  {/if}
</div>
