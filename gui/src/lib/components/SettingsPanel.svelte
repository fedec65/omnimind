<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type McpClientStatus } from '../api';
  import { appState, setError } from '../stores.svelte.ts';

  let isLoading = $state(true);
  let isSaving = $state(false);
  let saveMsg = $state<string | null>(null);
  let isImporting = $state(false);
  let isAging = $state(false);
  let isEvicting = $state(false);
  let actionMsg = $state<string | null>(null);

  let mcpClients = $state<McpClientStatus[]>([]);
  let cliInstalled = $state<string | null>(null);
  let isRegistering = $state(false);
  let isInstallingCli = $state(false);
  let connectMsg = $state<string | null>(null);

  let settings = $state<Record<string, string>>({});
  let form = $state({
    dataDir: '',
    modelPath: '',
    theme: 'dark',
    autoStart: 'false',
    defaultWing: 'general',
    autoEvictDays: '90',
  });

  onMount(async () => {
    try {
      settings = await api.settings();
      form.dataDir = settings.dataDir || '';
      form.modelPath = settings.modelPath || '';
      form.theme = settings.theme || 'dark';
      form.autoStart = settings.autoStart || 'false';
      form.defaultWing = settings.defaultWing || 'general';
      form.autoEvictDays = settings.autoEvictDays || '90';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      isLoading = false;
    }
    await loadSetupStatus();
  });

  async function loadSetupStatus() {
    try {
      const status = await api.setupClients();
      mcpClients = status.clients;
      cliInstalled = status.cli.installed;
    } catch {
      // Sidecar too old to expose setup endpoints — hide the section
      mcpClients = [];
    }
  }

  async function handleRegister(clientIds?: string[]) {
    isRegistering = true;
    connectMsg = null;
    try {
      const result = await api.registerMcpClients(clientIds);
      mcpClients = result.clients;
      const names = result.registered.map((r) => r.name).join(', ');
      connectMsg = `Registered in ${names}. Restart the client(s) to load the Omnimind tools.`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'MCP registration failed');
    } finally {
      isRegistering = false;
    }
  }

  async function handleInstallCli() {
    isInstallingCli = true;
    connectMsg = null;
    try {
      const result = await api.installCli();
      cliInstalled = result.path ?? null;
      connectMsg = `omnimind command installed at ${result.path}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CLI install failed');
    } finally {
      isInstallingCli = false;
    }
  }

  async function save() {
    isSaving = true;
    saveMsg = null;
    try {
      for (const [key, value] of Object.entries(form)) {
        await api.setSetting(key, value);
      }
      settings = await api.settings();
      saveMsg = 'Settings saved successfully';
      setTimeout(() => (saveMsg = null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      isSaving = false;
    }
  }

  function reset() {
    form.dataDir = settings.dataDir || '';
    form.modelPath = settings.modelPath || '';
    form.theme = settings.theme || 'dark';
    form.autoStart = settings.autoStart || 'false';
    form.defaultWing = settings.defaultWing || 'general';
    form.autoEvictDays = settings.autoEvictDays || '90';
    saveMsg = 'Form reset to saved values';
    setTimeout(() => (saveMsg = null), 3000);
  }

  async function handleImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    isImporting = true;
    actionMsg = null;
    try {
      const text = await file.text();
      const result = await api.importMemories(text);
      actionMsg = `Imported ${result.imported} memories`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      isImporting = false;
      input.value = '';
    }
  }

  async function handleExport() {
    try {
      const data = await api.exportMemories();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `omnimind-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      actionMsg = 'Export downloaded';
      setTimeout(() => (actionMsg = null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  }

  async function handleAge() {
    isAging = true;
    actionMsg = null;
    try {
      const result = await api.ageMemories();
      actionMsg = `Aged ${result.aged} memories (${result.skipped} skipped)`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aging failed');
    } finally {
      isAging = false;
      setTimeout(() => (actionMsg = null), 5000);
    }
  }

  async function handleEvict() {
    if (!confirm('This will archive old unaccessed memories to keep search fast. Pinned memories are never archived. Continue?')) return;
    isEvicting = true;
    actionMsg = null;
    try {
      const days = parseInt(form.autoEvictDays, 10);
      const result = await api.evictMemories(days > 0 ? days : 90);
      actionMsg = `Archived ${result.evicted} stale memories`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eviction failed');
    } finally {
      isEvicting = false;
      setTimeout(() => (actionMsg = null), 5000);
    }
  }
</script>

<div class="max-w-2xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold text-[var(--text-h)]">Settings</h2>
    {#if saveMsg}
      <span class="text-sm text-green-400">{saveMsg}</span>
    {/if}
  </div>

  {#if isLoading}
    <div class="flex items-center justify-center py-12 text-[var(--text-muted)]">
      <div class="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mr-2"></div>
      Loading settings...
    </div>
  {:else}
    <div class="space-y-6">
      <!-- General -->
      <section class="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)]">
        <h3 class="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">General</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Data Directory</label>
            <input
              type="text"
              bind:value={form.dataDir}
              placeholder="/Users/.../.omnimind"
              class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
            <p class="text-xs text-[var(--text-muted)] mt-1">Path where Omnimind stores its database and models.</p>
          </div>

          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Model Path</label>
            <input
              type="text"
              bind:value={form.modelPath}
              placeholder="Path to ONNX model file"
              class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
            <p class="text-xs text-[var(--text-muted)] mt-1">Override the default embedding model path.</p>
          </div>

          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Default Wing</label>
            <input
              type="text"
              bind:value={form.defaultWing}
              placeholder="general"
              class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
            <p class="text-xs text-[var(--text-muted)] mt-1">Default category for new memories.</p>
          </div>
        </div>
      </section>

      <!-- Appearance -->
      <section class="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)]">
        <h3 class="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">Appearance</h3>
        <div>
          <label class="block text-sm text-[var(--text)] mb-1">Theme</label>
          <select
            bind:value={form.theme}
            class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </div>
      </section>

      <!-- Advanced -->
      <section class="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)]">
        <h3 class="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">Advanced</h3>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-sm text-[var(--text)]">Auto-start Server</div>
              <div class="text-xs text-[var(--text-muted)]">Start Omnimind server automatically on login.</div>
            </div>
            <button
              onclick={() => form.autoStart = form.autoStart === 'true' ? 'false' : 'true'}
              class="relative w-11 h-6 rounded-full transition-colors {form.autoStart === 'true' ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}"
            >
              <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform {form.autoStart === 'true' ? 'translate-x-5' : ''}"></span>
            </button>
          </div>
          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Auto-Evict After (days)</label>
            <input
              type="number"
              bind:value={form.autoEvictDays}
              min="0"
              placeholder="90"
              class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
            <p class="text-xs text-[var(--text-muted)] mt-1">Archive memories unaccessed for this many days (0 = disabled).</p>
          </div>
        </div>
      </section>

      <!-- Connect AI Tools -->
      {#if mcpClients.length > 0}
        <section class="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)]">
          <h3 class="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">Connect AI Tools</h3>
          <p class="text-xs text-[var(--text-muted)] mb-4">
            Register the Omnimind MCP server in your AI clients so they can store and search memories.
            No npm install needed — the registration points at this app's bundled backend.
          </p>
          <div class="space-y-3">
            {#each mcpClients as client (client.id)}
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-sm text-[var(--text)]">{client.name}</span>
                  {#if !client.detected}
                    <span class="text-xs px-2 py-0.5 rounded-full bg-[var(--border)] text-[var(--text-muted)]">not installed</span>
                  {:else if client.configured}
                    <span class="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">connected</span>
                  {:else}
                    <span class="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">detected</span>
                  {/if}
                </div>
                {#if client.detected}
                  <button
                    onclick={() => handleRegister([client.id])}
                    disabled={isRegistering}
                    class="px-3 py-1.5 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-lg hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
                  >
                    {client.configured ? 'Re-register' : 'Connect'}
                  </button>
                {/if}
              </div>
            {/each}
          </div>
          <div class="flex flex-wrap items-center gap-3 mt-4">
            <button
              onclick={() => handleRegister()}
              disabled={isRegistering || !mcpClients.some((c) => c.detected)}
              class="px-4 py-2 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isRegistering ? 'Connecting...' : 'Connect All Detected'}
            </button>
            {#if cliInstalled}
              <span class="text-xs text-[var(--text-muted)]">CLI installed: {cliInstalled}</span>
            {:else}
              <button
                onclick={handleInstallCli}
                disabled={isInstallingCli}
                class="px-4 py-2 bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
              >
                {isInstallingCli ? 'Installing...' : 'Install omnimind Command'}
              </button>
            {/if}
          </div>
          {#if connectMsg}
            <p class="text-sm text-green-400 mt-3">{connectMsg}</p>
          {/if}
        </section>
      {/if}

      <!-- Data Management -->
      <section class="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)]">
        <h3 class="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">Data Management</h3>
        <div class="flex flex-wrap items-center gap-3">
          <label class="px-5 py-2.5 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">
            {isImporting ? 'Importing...' : 'Import Memories'}
            <input type="file" accept=".json" class="hidden" onchange={handleImport} disabled={isImporting} />
          </label>
          <button onclick={handleExport} class="px-5 py-2.5 bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--surface-hover)] transition-colors">
            Export Memories
          </button>
          <button onclick={handleAge} disabled={isAging} class="px-5 py-2.5 bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50">
            {isAging ? 'Aging...' : 'Age Memories Now'}
          </button>
          <button onclick={handleEvict} disabled={isEvicting} class="px-5 py-2.5 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50">
            {isEvicting ? 'Archiving...' : 'Evict Stale Memories'}
          </button>
        </div>
        {#if actionMsg}
          <p class="text-sm text-green-400 mt-3">{actionMsg}</p>
        {/if}
      </section>

      <!-- Actions -->
      <div class="flex items-center gap-3">
        <button
          onclick={save}
          disabled={isSaving}
          class="px-5 py-2.5 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
        <button
          onclick={reset}
          class="px-5 py-2.5 bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  {/if}
</div>
