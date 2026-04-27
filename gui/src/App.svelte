<script lang="ts">
  import { appState, setError } from './lib/stores.svelte.ts';
  import { api } from './lib/api';
  import SearchPanel from './lib/components/SearchPanel.svelte';
  import StatsPanel from './lib/components/StatsPanel.svelte';
  import TimelineView from './lib/components/TimelineView.svelte';
  import GraphView from './lib/components/GraphView.svelte';
  import SpatialMap from './lib/components/SpatialMap.svelte';
  import SettingsPanel from './lib/components/SettingsPanel.svelte';

  let serverReady = $state(false);

  $effect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 3000);
    return () => clearInterval(interval);
  });

  async function checkHealth() {
    try {
      await api.health();
      serverReady = true;
    } catch {
      serverReady = false;
    }
  }
</script>

{#if !serverReady}
  <div class="flex items-center justify-center h-screen bg-[var(--bg)] text-[var(--text)]">
    <div class="text-center">
      <div class="text-2xl font-semibold mb-2">Omnimind Explorer</div>
      <div class="text-sm text-[var(--text-muted)]">Waiting for server...</div>
      <div class="mt-4 w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto"></div>
    </div>
  </div>
{:else}
  <div class="flex h-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden">
    <!-- Sidebar -->
    <aside class="w-56 flex-shrink-0 border-r border-[var(--border)] flex flex-col">
      <div class="p-4 border-b border-[var(--border)]">
        <h1 class="text-lg font-bold text-[var(--text-h)]">Omnimind</h1>
        <div class="text-xs text-[var(--text-muted)] mt-1">v0.4.2</div>
      </div>

      <nav class="flex-1 p-2 space-y-1">
        {#each [
          { id: 'search', label: 'Search', icon: '🔍' },
          { id: 'timeline', label: 'Timeline', icon: '📅' },
          { id: 'spatial', label: 'Spatial Map', icon: '🗺️' },
          { id: 'graph', label: 'Concept Graph', icon: '🕸️' },
          { id: 'settings', label: 'Settings', icon: '⚙️' },
        ] as tab}
          <button
            class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2
              {appState.activeTab === tab.id ? 'bg-[var(--accent-glow)] text-[var(--accent)]' : 'hover:bg-[var(--surface-hover)] text-[var(--text)]'}"
            onclick={() => appState.activeTab = tab.id as typeof appState.activeTab}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        {/each}
      </nav>

      <StatsPanel />
    </aside>

    <!-- Main content -->
    <main class="flex-1 flex flex-col min-w-0">
      {#if appState.error}
        <div class="bg-red-500/10 border-b border-red-500/20 text-red-400 px-4 py-2 text-sm flex items-center justify-between">
          <span>{appState.error}</span>
          <button class="text-xs hover:underline" onclick={() => setError(null)}>Dismiss</button>
        </div>
      {/if}

      <div class="flex-1 overflow-auto p-6">
        {#if appState.activeTab === 'search'}
          <SearchPanel />
        {:else if appState.activeTab === 'timeline'}
          <TimelineView />
        {:else if appState.activeTab === 'graph'}
          <GraphView />
        {:else if appState.activeTab === 'spatial'}
          <SpatialMap />
        {:else if appState.activeTab === 'settings'}
          <SettingsPanel />
        {/if}
      </div>
    </main>
  </div>
{/if}
