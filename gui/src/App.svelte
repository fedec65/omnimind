<script lang="ts">
  import { appState, setError } from './lib/stores.svelte.ts';
  import { api } from './lib/api';
  import { checkForUpdates, skipVersion } from './lib/updates';
  import SearchPanel from './lib/components/SearchPanel.svelte';
  import StatsPanel from './lib/components/StatsPanel.svelte';
  import TimelineView from './lib/components/TimelineView.svelte';
  import GraphView from './lib/components/GraphView.svelte';
  import SpatialMap from './lib/components/SpatialMap.svelte';
  import SettingsPanel from './lib/components/SettingsPanel.svelte';
  import ArchivePanel from './lib/components/ArchivePanel.svelte';
  import PredictionsPanel from './lib/components/PredictionsPanel.svelte';
  import ConflictsPanel from './lib/components/ConflictsPanel.svelte';

  let serverReady = $state(false);
  let version = $state('');
  let updateInfo = $state<{
    latestVersion: string;
    releaseUrl: string;
  } | null>(null);

  $effect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 3000);
    return () => clearInterval(interval);
  });

  async function checkHealth() {
    try {
      const health = await api.health();
      serverReady = true;
      if (health.version && !version) {
        version = health.version;
        // Check for updates once we know the version
        const update = await checkForUpdates(health.version);
        if (update) {
          updateInfo = {
            latestVersion: update.latestVersion,
            releaseUrl: update.releaseUrl,
          };
        }
      }
    } catch {
      serverReady = false;
    }
  }

  function dismissUpdate() {
    if (updateInfo) {
      skipVersion(updateInfo.latestVersion);
      updateInfo = null;
    }
  }

  function openRelease() {
    if (updateInfo?.releaseUrl) {
      window.open(updateInfo.releaseUrl, '_blank');
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
        <div class="text-xs text-[var(--text-muted)] mt-1 flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
          <span>v{version || '...'}</span>
        </div>
      </div>

      <nav class="flex-1 p-2 space-y-1">
        {#each [
          { id: 'search', label: 'Search', icon: '🔍' },
          { id: 'timeline', label: 'Timeline', icon: '📅' },
          { id: 'spatial', label: 'Spatial Map', icon: '🗺️' },
          { id: 'graph', label: 'Concept Graph', icon: '🕸️' },
          { id: 'predictions', label: 'Predictions', icon: '🔮' },
          { id: 'conflicts', label: 'Conflicts', icon: '⚡' },
          { id: 'archive', label: 'Archive', icon: '📦' },
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
      {#if updateInfo}
        <div class="bg-[var(--accent-glow)] border-b border-[var(--accent)]/30 text-[var(--accent)] px-4 py-2 text-sm flex items-center justify-between shrink-0">
          <span>Omnimind {updateInfo.latestVersion} is available</span>
          <div class="flex items-center gap-3">
            <button class="hover:underline font-medium" onclick={openRelease}>Download</button>
            <button class="hover:underline text-[var(--text-muted)]" onclick={dismissUpdate}>Later</button>
          </div>
        </div>
      {/if}

      {#if appState.error}
        <div class="bg-red-500/10 border-b border-red-500/20 text-red-400 px-4 py-2 text-sm flex items-center justify-between shrink-0">
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
        {:else if appState.activeTab === 'archive'}
          <ArchivePanel />
        {:else if appState.activeTab === 'predictions'}
          <PredictionsPanel />
        {:else if appState.activeTab === 'conflicts'}
          <ConflictsPanel />
        {:else if appState.activeTab === 'settings'}
          <SettingsPanel />
        {/if}
      </div>
    </main>
  </div>
{/if}
