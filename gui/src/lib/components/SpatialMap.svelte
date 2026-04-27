<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../api';
  import type { Memory } from '../api';
  import * as d3 from 'd3';

  let svgEl: SVGSVGElement;
  let containerEl: HTMLDivElement;
  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let selectedMemory = $state<Memory | null>(null);

  let memories = $state<Memory[]>([]);

  const layerColors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'];
  const layerNames = ['Verbatim', 'Compressed', 'Concept', 'Wisdom'];

  onMount(async () => {
    try {
      const data = await api.memories(undefined, 200);
      memories = data.memories.map((r: any) => r.memory);
      renderMap();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load map';
    } finally {
      isLoading = false;
    }
  });

  function renderMap() {
    if (!svgEl || memories.length === 0) return;

    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    const svg = d3.select(svgEl)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    svg.selectAll('*').remove();

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Group memories by wing -> room
    const wingMap = new Map<string, Map<string, Memory[]>>();
    for (const mem of memories) {
      if (!wingMap.has(mem.wing)) wingMap.set(mem.wing, new Map());
      const roomMap = wingMap.get(mem.wing)!;
      if (!roomMap.has(mem.room)) roomMap.set(mem.room, []);
      roomMap.get(mem.room)!.push(mem);
    }

    const wings = Array.from(wingMap.entries());
    const wingSpacing = 320;
    const roomSpacing = 160;
    const roomSize = 140;
    const margin = 60;

    // Draw wings
    wings.forEach(([wingName, roomMap], wingIdx) => {
      const wingX = margin + wingIdx * wingSpacing;
      const wingY = margin;

      // Wing label
      g.append('text')
        .attr('x', wingX + roomSize / 2)
        .attr('y', wingY - 20)
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .attr('fill', '#c4c4d0')
        .text(wingName);

      const rooms = Array.from(roomMap.entries());
      rooms.forEach(([roomName, roomMemories], roomIdx) => {
        const rx = wingX;
        const ry = wingY + roomIdx * roomSpacing;

        // Room box
        g.append('rect')
          .attr('x', rx)
          .attr('y', ry)
          .attr('width', roomSize)
          .attr('height', roomSize)
          .attr('rx', 8)
          .attr('fill', 'none')
          .attr('stroke', '#2a2a35')
          .attr('stroke-width', 1.5);

        // Room label
        g.append('text')
          .attr('x', rx + roomSize / 2)
          .attr('y', ry + 14)
          .attr('text-anchor', 'middle')
          .attr('font-size', '10px')
          .attr('fill', '#7a7a8a')
          .text(roomName);

        // Memory dots
        const cols = 4;
        roomMemories.forEach((mem, idx) => {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const cx = rx + 20 + col * 28;
          const cy = ry + 32 + row * 24;

          const radius = 6 + Math.min(mem.accessCount * 0.5, 6);

          g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', radius)
            .attr('fill', layerColors[mem.layer] || '#6b7280')
            .attr('stroke', mem.pinned ? '#f59e0b' : 'none')
            .attr('stroke-width', mem.pinned ? 2 : 0)
            .attr('opacity', 0.85)
            .attr('cursor', 'pointer')
            .on('click', () => {
              selectedMemory = mem;
            })
            .append('title')
            .text(`${mem.content.substring(0, 80)}${mem.content.length > 80 ? '...' : ''}`);
        });
      });
    });

    // Center the content initially
    const totalWidth = wings.length * wingSpacing;
    const maxRooms = Math.max(...wings.map(([, rm]) => rm.size), 1);
    const totalHeight = maxRooms * roomSpacing;

    const scale = Math.min(width / (totalWidth + margin * 2), height / (totalHeight + margin * 2), 1);
    const tx = (width - totalWidth * scale) / 2;
    const ty = (height - totalHeight * scale) / 2;

    svg.call(zoom.transform as any, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  onDestroy(() => {
    d3.select(svgEl).selectAll('*').remove();
  });
</script>

<div class="flex h-full">
  <div bind:this={containerEl} class="flex-1 relative bg-[var(--bg)]">
    {#if isLoading}
      <div class="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
        <div class="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mr-3"></div>
        Loading spatial map...
      </div>
    {:else if error}
      <div class="absolute inset-0 flex items-center justify-center text-red-400">
        {error}
      </div>
    {:else if memories.length === 0}
      <div class="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
        No memories to display. Store some memories first.
      </div>
    {/if}
    <svg bind:this={svgEl} class="w-full h-full"></svg>
  </div>

  {#if selectedMemory}
    <aside class="w-80 border-l border-[var(--border)] bg-[var(--surface)] p-4 overflow-auto">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-[var(--text-h)]">Memory Details</h3>
        <button onclick={() => selectedMemory = null} class="text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
      </div>
      <div class="space-y-3 text-sm">
        <div>
          <span class="text-[var(--text-muted)]">Content</span>
          <div class="text-[var(--text)] mt-1 leading-relaxed">{selectedMemory.content}</div>
        </div>
        <div class="flex gap-4">
          <div>
            <span class="text-[var(--text-muted)]">Wing</span>
            <div class="text-[var(--text)]">{selectedMemory.wing}</div>
          </div>
          <div>
            <span class="text-[var(--text-muted)]">Room</span>
            <div class="text-[var(--text)]">{selectedMemory.room}</div>
          </div>
        </div>
        <div>
          <span class="text-[var(--text-muted)]">Layer</span>
          <span class="ml-2 px-2 py-0.5 rounded-full text-xs" style="background: {layerColors[selectedMemory.layer]}20; color: {layerColors[selectedMemory.layer]}">
            {layerNames[selectedMemory.layer]}
          </span>
        </div>
        <div class="flex gap-4">
          <div>
            <span class="text-[var(--text-muted)]">Accessed</span>
            <div class="text-[var(--text)]">{selectedMemory.accessCount} times</div>
          </div>
          <div>
            <span class="text-[var(--text-muted)]">Created</span>
            <div class="text-[var(--text)]">{new Date(selectedMemory.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
        {#if selectedMemory.pinned}
          <div class="text-amber-400 text-xs">📌 Pinned</div>
        {/if}
      </div>
    </aside>
  {/if}
</div>
