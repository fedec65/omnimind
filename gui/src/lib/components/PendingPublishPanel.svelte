<script lang="ts">
  import { CloudUpload, RefreshCw, Check } from '@lucide/svelte';
  import { api, type SharedSuggestionDto } from '../api';
  import { appState } from '../stores.svelte';

  let suggestions = $state<SharedSuggestionDto[]>([]);
  let notConfigured = $state(false);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let visibility = $state<Record<string, 'org' | 'team'>>({});
  let publishing = $state<Record<string, boolean>>({});
  let published = $state<Record<string, boolean>>({});
  let rowError = $state<Record<string, string>>({});

  function ageOf(suggestedAt: number): string {
    const hours = Math.floor((Date.now() - suggestedAt) / 3_600_000);
    if (hours < 1) return 'just now';
    if (hours === 1) return '1h ago';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      suggestions = await api.sharedSuggestions();
      if (suggestions.length === 0) {
        // An empty list is ambiguous: shared may be unconfigured, or simply
        // nothing is pending. Disambiguate via the test endpoint.
        try {
          const test = await api.sharedTest();
          notConfigured =
            !test.connected && (test.reason === 'not configured' || test.reason === 'disabled');
        } catch {
          notConfigured = false;
        }
      } else {
        notConfigured = false;
      }
    } catch (e) {
      // Distinguish "shared not configured" from real errors via the test
      // endpoint (already exists in api.ts).
      try {
        const test = await api.sharedTest();
        if (!test.connected && (test.reason === 'not configured' || test.reason === 'disabled')) {
          notConfigured = true;
        } else {
          loadError = e instanceof Error ? e.message : String(e);
        }
      } catch {
        loadError = e instanceof Error ? e.message : String(e);
      }
    }
    loading = false;
  }

  async function publish(memoryId: string): Promise<void> {
    publishing = { ...publishing, [memoryId]: true };
    rowError = { ...rowError, [memoryId]: '' };
    try {
      await api.sharedPublish(memoryId, visibility[memoryId] ?? 'org');
      published = { ...published, [memoryId]: true };
      suggestions = suggestions.filter((s) => s.memoryId !== memoryId);
    } catch (e) {
      rowError = { ...rowError, [memoryId]: e instanceof Error ? e.message : String(e) };
    } finally {
      publishing = { ...publishing, [memoryId]: false };
    }
  }

  load();
</script>

<div class="max-w-3xl space-y-4">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-lg font-semibold text-[var(--text-h)]">Shared — Pending publish</h2>
      <p class="text-xs text-[var(--text-muted)] mt-1">
        Promoted (L2/L3) memories awaiting your decision to publish to the team/org server.
      </p>
    </div>
    <button
      onclick={load}
      disabled={loading}
      class="p-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
      title="Refresh"
      aria-label="Refresh"
    >
      <RefreshCw size={16} class={loading ? 'animate-spin' : ''} />
    </button>
  </div>

  {#if loading && suggestions.length === 0}
    <div class="text-sm text-[var(--text-muted)]">Loading…</div>
  {:else if notConfigured}
    <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 text-center space-y-3">
      <CloudUpload size={24} class="mx-auto text-[var(--text-muted)]" />
      <p class="text-sm text-[var(--text)]">Shared memory is not configured.</p>
      <button
        onclick={() => (appState.activeTab = 'settings')}
        class="px-4 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors"
      >
        Open Settings
      </button>
    </div>
  {:else if loadError}
    <div class="text-sm text-yellow-400">Backend starting… ({loadError})</div>
  {:else if suggestions.length === 0}
    <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 text-center">
      <p class="text-sm text-[var(--text-muted)]">
        Nothing pending — promoted memories will appear here for 24h.
      </p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each suggestions as s (s.memoryId)}
        <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-start gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span class="px-1.5 py-0.5 rounded bg-[var(--accent-glow)] text-[var(--accent)]">
                L{s.level}
              </span>
              <span>{ageOf(s.suggestedAt)}</span>
            </div>
            <p class="text-sm text-[var(--text)] mt-1 line-clamp-2">{s.content}</p>
            {#if rowError[s.memoryId]}
              <p class="text-xs text-yellow-400 mt-1">{rowError[s.memoryId]}</p>
            {/if}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div class="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
              {#each ['org', 'team'] as v (v)}
                <button
                  onclick={() => (visibility = { ...visibility, [s.memoryId]: v as 'org' | 'team' })}
                  class="px-2 py-1.5 capitalize transition-colors
                    {(visibility[s.memoryId] ?? 'org') === v
                      ? 'bg-[var(--accent-glow)] text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'}"
                >
                  {v}
                </button>
              {/each}
            </div>
            <button
              onclick={() => publish(s.memoryId)}
              disabled={publishing[s.memoryId] || published[s.memoryId]}
              class="px-3 py-1.5 text-xs rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1"
            >
              {#if published[s.memoryId]}
                <Check size={12} /> Published
              {:else}
                {publishing[s.memoryId] ? 'Publishing…' : 'Publish'}
              {/if}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
