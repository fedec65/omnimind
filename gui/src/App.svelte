<script lang="ts">
  import { appState, setError } from './lib/stores.svelte.ts';
  import { api } from './lib/api';
  import { checkForUpdates, skipVersion } from './lib/updates';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import { check as checkUpdater } from '@tauri-apps/plugin-updater';
  import { relaunch } from '@tauri-apps/plugin-process';
  import SearchPanel from './lib/components/SearchPanel.svelte';
  import StatsPanel from './lib/components/StatsPanel.svelte';
  import TimelineView from './lib/components/TimelineView.svelte';
  import GraphView from './lib/components/GraphView.svelte';
  import SpatialMap from './lib/components/SpatialMap.svelte';
  import SettingsPanel from './lib/components/SettingsPanel.svelte';
  import ArchivePanel from './lib/components/ArchivePanel.svelte';
  import PredictionsPanel from './lib/components/PredictionsPanel.svelte';
  import ConflictsPanel from './lib/components/ConflictsPanel.svelte';
  import PendingPublishPanel from './lib/components/PendingPublishPanel.svelte';
  import { Search, Calendar, Map, Network, Sparkles, Zap, Archive, CloudUpload, Settings } from '@lucide/svelte';

  let serverReady = $state(false);
  let version = $state('');
  let startPhase = $state('boot');
  let waitingSeconds = $state(0);
  let updateInfo = $state<{
    latestVersion: string;
    releaseUrl: string;
  } | null>(null);
  interface NativeUpdate {
    version: string;
    downloadAndInstall: () => Promise<void>;
  }
  let nativeUpdate = $state<NativeUpdate | null>(null);
  let installingUpdate = $state(false);
  let nativeUpdateError = $state(false);

  const PHASE_LABELS: Record<string, string> = {
    boot: 'Starting backend…',
    store: 'Opening database and loading AI models…',
    bus: 'Starting services…',
    ready: 'Ready',
    failed: 'Backend failed to start — check the logs',
  };

  $effect(() => {
    checkHealth();
    const interval = setInterval(() => {
      if (!serverReady) waitingSeconds += 3;
      checkHealth();
    }, 3000);
    return () => clearInterval(interval);
  });

  async function checkHealth() {
    try {
      const health = await api.health();
      if (health.status === 'starting') {
        startPhase = health.phase ?? 'boot';
        return;
      }
      if (health.status === 'failed') {
        startPhase = 'failed';
        return;
      }
      serverReady = true;
      if (health.version && !version) {
        version = health.version;
        // Prefer the native updater (signed, installs automatically). Fall
        // back to the GitHub-release banner when it is unavailable (dev
        // browser, or a build without the updater plugin).
        const native = await checkNativeUpdate();
        if (native) {
          nativeUpdate = native;
        } else {
          const update = await checkForUpdates(health.version);
          if (update) {
            updateInfo = {
              latestVersion: update.latestVersion,
              releaseUrl: update.releaseUrl,
            };
          }
        }
      }
    } catch {
      serverReady = false;
    }
  }

  async function checkNativeUpdate(): Promise<NativeUpdate | null> {
    try {
      // Throws outside the Tauri webview (e.g. dev in a plain browser) —
      // the GitHub-release banner handles that case.
      const update = await checkUpdater();
      return update ?? null;
    } catch {
      return null;
    }
  }

  async function installNativeUpdate() {
    if (!nativeUpdate) return;
    installingUpdate = true;
    nativeUpdateError = false;
    try {
      await nativeUpdate.downloadAndInstall();
      await relaunch();
    } catch {
      // Leave the banner up so the user can retry; fall back to the release
      // page if the in-app install keeps failing.
      nativeUpdateError = true;
      installingUpdate = false;
    }
  }

  function dismissNativeUpdate() {
    if (nativeUpdate) {
      skipVersion(nativeUpdate.version);
      nativeUpdate = null;
    }
  }

  function dismissUpdate() {
    if (updateInfo) {
      skipVersion(updateInfo.latestVersion);
      updateInfo = null;
    }
  }

  async function openRelease() {
    const url =
      updateInfo?.releaseUrl ??
      'https://github.com/fedec65/omnimind/releases/latest';
    try {
      // window.open is a no-op inside the Tauri webview — use the shell
      // plugin so the URL opens in the system browser.
      await shellOpen(url);
    } catch {
      // Fallback for dev in a plain browser
      window.open(url, '_blank');
    }
  }
</script>

{#if !serverReady}
  <div class="flex items-center justify-center h-screen bg-[var(--bg)] text-[var(--text)]">
    <div class="text-center max-w-sm">
      <div class="text-2xl font-semibold mb-2">Omnimind Explorer</div>
      <div class="text-sm text-[var(--text-muted)]">{PHASE_LABELS[startPhase] ?? 'Waiting for server…'}</div>
      {#if startPhase !== 'failed'}
        <div class="mt-4 w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto"></div>
        {#if waitingSeconds >= 9}
          <div class="mt-4 text-xs text-[var(--text-muted)]">
            Still loading ({waitingSeconds}s) — this is normal. On first launch Omnimind loads
            its local AI models, which can take up to a minute. Everything runs on your machine.
          </div>
        {/if}
      {/if}
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
          { id: 'search', label: 'Search', icon: Search },
          { id: 'timeline', label: 'Timeline', icon: Calendar },
          { id: 'spatial', label: 'Spatial Map', icon: Map },
          { id: 'graph', label: 'Concept Graph', icon: Network },
          { id: 'predictions', label: 'Predictions', icon: Sparkles },
          { id: 'conflicts', label: 'Conflicts', icon: Zap },
          { id: 'archive', label: 'Archive', icon: Archive },
          { id: 'shared', label: 'Shared', icon: CloudUpload },
          { id: 'settings', label: 'Settings', icon: Settings },
        ] as tab}
          <button
            class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2
              {appState.activeTab === tab.id ? 'bg-[var(--accent-glow)] text-[var(--accent)]' : 'hover:bg-[var(--surface-hover)] text-[var(--text)]'}"
            onclick={() => appState.activeTab = tab.id as typeof appState.activeTab}
          >
            {#if typeof tab.icon === 'string'}
              <span>{tab.icon}</span>
            {:else}
              {@const Icon = tab.icon}
              <Icon size={16} />
            {/if}
            <span>{tab.label}</span>
          </button>
        {/each}
      </nav>

      <StatsPanel />
    </aside>

    <!-- Main content -->
    <main class="flex-1 flex flex-col min-w-0">
      {#if nativeUpdate}
        <div class="bg-[var(--accent-glow)] border-b border-[var(--accent)]/30 text-[var(--accent)] px-4 py-2 text-sm flex items-center justify-between shrink-0">
          <span>Omnimind {nativeUpdate.version} is available</span>
          <div class="flex items-center gap-3">
            {#if nativeUpdateError}
              <button class="hover:underline font-medium" onclick={installNativeUpdate}>Retry update</button>
              <button class="hover:underline text-[var(--text-muted)]" onclick={openRelease}>Download manually</button>
            {:else}
              <button class="hover:underline font-medium disabled:opacity-50" disabled={installingUpdate} onclick={installNativeUpdate}>
                {installingUpdate ? 'Installing…' : 'Update & Restart'}
              </button>
              <button class="hover:underline text-[var(--text-muted)]" onclick={dismissNativeUpdate}>Later</button>
            {/if}
          </div>
        </div>
      {:else if updateInfo}
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
        {:else if appState.activeTab === 'shared'}
          <PendingPublishPanel />
        {:else if appState.activeTab === 'settings'}
          <SettingsPanel />
        {/if}
      </div>
    </main>
  </div>
{/if}
