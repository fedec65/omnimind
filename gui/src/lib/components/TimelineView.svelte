<script lang="ts">
  import { appState, setError } from '../stores';
  import { api } from '../api';
  import MemoryCard from './MemoryCard.svelte';

  let isLoading = $state(false);

  $effect(() => {
    loadMemories();
  });

  async function loadMemories() {
    isLoading = true;
    try {
      const res = await api.memories(undefined, 100);
      appState.searchResults = res.memories;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timeline');
    } finally {
      isLoading = false;
    }
  }

  function groupByDate(results: typeof appState.searchResults) {
    const groups = new Map<string, typeof results>();
    for (const r of results) {
      const date = new Date(r.memory.createdAt).toLocaleDateString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
      });
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date)!.push(r);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      return new Date(b[1][0]!.memory.createdAt).getTime() - new Date(a[1][0]!.memory.createdAt).getTime();
    });
  }

  const grouped = $derived(groupByDate(appState.searchResults));
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold">Temporal Timeline</h2>
    {#if isLoading}
      <div class="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"></div>
    {/if}
  </div>

  {#if grouped.length === 0}
    <div class="text-center py-12 text-[var(--text-muted)]">
      No memories to display
    </div>
  {:else}
    <div class="space-y-6">
      {#each grouped as [date, results]}
        <div>
          <div class="sticky top-0 bg-[var(--bg)] py-2 mb-3 border-b border-[var(--border)]">
            <h3 class="text-sm font-medium text-[var(--accent)]">{date}</h3>
          </div>
          <div class="grid gap-3">
            {#each results as result}
              <MemoryCard {result} />
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
