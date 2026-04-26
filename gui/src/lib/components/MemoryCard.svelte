<script lang="ts">
  import { setError } from '../stores';
  import { api } from '../api';
  import type { SearchResult } from '../api';

  let { result }: { result: SearchResult } = $props();
  const m = $derived(result.memory);
  const layerNames = ['Verbatim', 'Compressed', 'Concept', 'Wisdom'];
  const layerColors = ['bg-blue-500/20 text-blue-300', 'bg-amber-500/20 text-amber-300', 'bg-purple-500/20 text-purple-300', 'bg-emerald-500/20 text-emerald-300'];

  async function deleteMemory() {
    if (!confirm('Delete this memory?')) return;
    try {
      await api.deleteMemory(m.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  const date = new Date(m.createdAt).toLocaleDateString();
</script>

<div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)]/30 transition-colors">
  <div class="flex items-start justify-between gap-3">
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xs px-2 py-0.5 rounded-full {layerColors[m.layer]}">
          {layerNames[m.layer]}
        </span>
        <span class="text-xs text-[var(--text-muted)]">{m.wing}{m.room ? ` / ${m.room}` : ''}</span>
        <span class="text-xs text-[var(--text-muted)] ml-auto">{date}</span>
      </div>
      <p class="text-sm leading-relaxed text-[var(--text)]">{m.content}</p>
      <div class="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
        <span>Score: {result.score.toFixed(3)}</span>
        <span>{m.matchType}</span>
        <span>{m.accessCount} access{m.accessCount === 1 ? '' : 'es'}</span>
        {#if m.pinned}
          <span class="text-[var(--accent)]">📌 Pinned</span>
        {/if}
      </div>
    </div>
    <button
      onclick={deleteMemory}
      class="text-[var(--text-muted)] hover:text-red-400 text-xs px-2 py-1 rounded transition-colors"
      title="Delete"
    >
      ✕
    </button>
  </div>
</div>
