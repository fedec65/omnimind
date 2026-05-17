<script lang="ts">
  import { setError } from '../stores.svelte.ts';
  import { api } from '../api';
  import type { SearchResult } from '../api';

  let { result }: { result: SearchResult } = $props();
  const m = $derived(result.memory);
  const layerNames = ['Verbatim', 'Compressed', 'Concept', 'Wisdom'];
  const layerColors = ['bg-blue-500/20 text-blue-300', 'bg-amber-500/20 text-amber-300', 'bg-purple-500/20 text-purple-300', 'bg-emerald-500/20 text-emerald-300'];

  let isEditing = $state(false);
  let editContent = $state('');
  let editWing = $state('');
  let editRoom = $state('');
  let editPinned = $state(false);

  async function deleteMemory() {
    if (!confirm('Delete this memory?')) return;
    try {
      await api.deleteMemory(m.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  function startEdit() {
    editContent = m.content;
    editWing = m.wing;
    editRoom = m.room;
    editPinned = m.pinned;
    isEditing = true;
  }

  function cancelEdit() {
    isEditing = false;
  }

  async function saveEdit() {
    try {
      const updates: Partial<Pick<typeof m, 'content' | 'wing' | 'room' | 'pinned'>> = {};
      if (editContent !== m.content) updates.content = editContent;
      if (editWing !== m.wing) updates.wing = editWing;
      if (editRoom !== m.room) updates.room = editRoom;
      if (editPinned !== m.pinned) updates.pinned = editPinned;
      if (Object.keys(updates).length > 0) {
        await api.updateMemory(m.id, updates);
      }
      isEditing = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  }

  const date = $derived(new Date(m.createdAt).toLocaleDateString());
</script>

<div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)]/30 transition-colors">
  {#if isEditing}
    <div class="space-y-3">
      <textarea
        bind:value={editContent}
        class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-y min-h-[80px]"
      ></textarea>
      <div class="flex items-center gap-3">
        <input
          type="text"
          bind:value={editWing}
          placeholder="Wing"
          class="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
        />
        <input
          type="text"
          bind:value={editRoom}
          placeholder="Room"
          class="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
        />
        <label class="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
          <input type="checkbox" bind:checked={editPinned} class="accent-[var(--accent)]" />
          Pinned
        </label>
      </div>
      <div class="flex items-center gap-2 justify-end">
        <button
          onclick={cancelEdit}
          class="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          Cancel
        </button>
        <button
          onclick={saveEdit}
          class="px-3 py-1.5 bg-[var(--accent)] text-white text-xs font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          Save
        </button>
      </div>
    </div>
  {:else}
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
          <span>{result.matchType}</span>
          <span>{m.accessCount} access{m.accessCount === 1 ? '' : 'es'}</span>
          {#if m.pinned}
            <span class="text-[var(--accent)]">📌 Pinned</span>
          {/if}
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button
          onclick={startEdit}
          class="text-[var(--text-muted)] hover:text-[var(--accent)] text-xs px-2 py-1 rounded transition-colors"
          title="Edit"
        >
          ✎
        </button>
        <button
          onclick={deleteMemory}
          class="text-[var(--text-muted)] hover:text-red-400 text-xs px-2 py-1 rounded transition-colors"
          title="Delete"
        >
          ✕
        </button>
      </div>
    </div>
  {/if}
</div>
