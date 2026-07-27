<script lang="ts">
  import { onMount } from 'svelte';
  import { appState, setError } from '../stores.svelte.ts';
  import { api, type WingCount } from '../api';
  import MemoryCard from './MemoryCard.svelte';

  let query = $state('');
  let isLoading = $state(false);
  let dateFrom = $state('');
  let dateTo = $state('');
  let filterWing = $state('');
  let wings = $state<WingCount[]>([]);
  let showNewForm = $state(false);
  let newContent = $state('');
  let newWing = $state('general');
  let newRoom = $state('');
  let isCreating = $state(false);

  const wingNames = $derived([...new Set(wings.map((w) => w.wing))]);
  const roomsOfNewWing = $derived([...new Set(wings.filter((w) => w.wing === newWing).map((w) => w.room))]);

  onMount(async () => {
    try {
      const res = await api.wings();
      wings = res.wings;
    } catch {
      // Older sidecar without /api/wings — autocomplete stays empty
    }
  });

  async function doSearch() {
    if (!query.trim() && !dateFrom && !dateTo && !filterWing) return;
    isLoading = true;
    try {
      const from = dateFrom ? new Date(dateFrom).getTime() : undefined;
      const to = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 : undefined; // inclusive
      const res = await api.search(query, 20, undefined, from, to, filterWing || undefined);
      appState.searchResults = res.results;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      isLoading = false;
    }
  }

  async function createMemory() {
    if (!newContent.trim() || !newWing.trim()) return;
    isCreating = true;
    try {
      await api.createMemory(newContent.trim(), newWing.trim(), newRoom.trim() || undefined);
      newContent = '';
      newRoom = '';
      showNewForm = false;
      await doSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create memory');
    } finally {
      isCreating = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') doSearch();
  }
</script>

<div class="space-y-4">
  <div class="space-y-3">
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
        onclick={() => (showNewForm = !showNewForm)}
        class="px-4 py-2.5 bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
      >
        + New
      </button>
    </div>

    {#if showNewForm}
      <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
        <textarea
          bind:value={newContent}
          placeholder="Memory content..."
          rows="3"
          class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
        ></textarea>
        <div class="flex items-center gap-3">
          <input
            type="text"
            bind:value={newWing}
            placeholder="Wing (category)"
            list="wing-suggestions"
            class="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
          />
          <datalist id="wing-suggestions">
            {#each wingNames as name}
              <option value={name}></option>
            {/each}
          </datalist>
          <input
            type="text"
            bind:value={newRoom}
            placeholder="Room (optional)"
            list="room-suggestions"
            class="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
          />
          <datalist id="room-suggestions">
            {#each roomsOfNewWing as name}
              <option value={name}></option>
            {/each}
          </datalist>
          <button
            onclick={createMemory}
            disabled={isCreating || !newContent.trim() || !newWing.trim()}
            class="px-4 py-2 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isCreating ? 'Saving...' : 'Save'}
          </button>
          <button
            onclick={() => (showNewForm = false)}
            class="px-4 py-2 bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
    <div class="flex items-center gap-3">
      {#if wingNames.length > 0}
        <div class="flex items-center gap-2">
          <span class="text-xs text-[var(--text-muted)]">Wing</span>
          <select
            bind:value={filterWing}
            onchange={doSearch}
            class="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="">All</option>
            {#each wingNames as name}
              <option value={name}>{name}</option>
            {/each}
          </select>
        </div>
      {/if}
      <div class="flex items-center gap-2">
        <span class="text-xs text-[var(--text-muted)]">From</span>
        <input type="date" bind:value={dateFrom} class="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-[var(--text-muted)]">To</span>
        <input type="date" bind:value={dateTo} class="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
      </div>
      {#if dateFrom || dateTo}
        <button onclick={() => { dateFrom = ''; dateTo = ''; }} class="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
          Clear dates
        </button>
      {/if}
    </div>
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
