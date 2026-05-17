<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../api';
  import type { Memory, Relation } from '../api';
  import * as d3 from 'd3';

  let svgEl: SVGSVGElement;
  let containerEl: HTMLDivElement;
  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let selectedMemory = $state<Memory | null>(null);

  let memories = $state<Memory[]>([]);
  let relations = $state<Relation[]>([]);
  let dragOffsets = $state<Map<string, { dx: number; dy: number }>>(new Map());

  const layerColors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'];
  const layerNames = ['Verbatim', 'Compressed', 'Concept', 'Wisdom'];

  onMount(async () => {
    try {
      const [memData, relData] = await Promise.all([
        api.memories(undefined, 200),
        api.relations({ limit: 500 }),
      ]);
      memories = memData.memories.map((r: any) => r.memory);
      relations = relData.relations;
      renderMap();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load map';
    } finally {
      isLoading = false;
    }
  });

  function getBasePosition(mem: Memory) {
    const wingMap = new Map<string, Map<string, Memory[]>>();
    for (const m of memories) {
      if (!wingMap.has(m.wing)) wingMap.set(m.wing, new Map());
      const roomMap = wingMap.get(m.wing)!;
      if (!roomMap.has(m.room)) roomMap.set(m.room, []);
      roomMap.get(m.room)!.push(m);
    }

    const wings = Array.from(wingMap.entries());
    const wingSpacing = 320;
    const roomSpacing = 160;
    const roomSize = 140;
    const margin = 60;

    const wingIdx = wings.findIndex(([w]) => w === mem.wing);
    const wingX = margin + (wingIdx >= 0 ? wingIdx : 0) * wingSpacing;
    const wingY = margin;

    const rooms = wingIdx >= 0 ? Array.from(wings[wingIdx]![1].entries()) : [];
    const roomIdx = rooms.findIndex(([r]) => r === mem.room);
    const rx = wingX;
    const ry = wingY + (roomIdx >= 0 ? roomIdx : 0) * roomSpacing;

    const roomMemories = roomIdx >= 0 ? rooms[roomIdx]![1] : [];
    const memIdx = roomMemories.findIndex((m) => m.id === mem.id);
    const cols = 4;
    const col = memIdx >= 0 ? memIdx % cols : 0;
    const row = memIdx >= 0 ? Math.floor(memIdx / cols) : 0;

    return {
      cx: rx + 20 + col * 28,
      cy: ry + 32 + row * 24,
    };
  }

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
      });
    });

    // Build memory positions
    const posMap = new Map<string, { cx: number; cy: number }>();
    for (const mem of memories) {
      posMap.set(mem.id, getBasePosition(mem));
    }

    // Apply drag offsets
    for (const [id, offset] of dragOffsets) {
      const pos = posMap.get(id);
      if (pos) {
        pos.cx += offset.dx;
        pos.cy += offset.dy;
      }
    }

    // Draw connection lines between related memories (same sourceId)
    const sourceGroups = new Map<string, string[]>();
    for (const mem of memories) {
      if (mem.sourceId) {
        if (!sourceGroups.has(mem.sourceId)) sourceGroups.set(mem.sourceId, []);
        sourceGroups.get(mem.sourceId)!.push(mem.id);
      }
    }

    const linkGroup = g.append('g').attr('class', 'links');
    for (const [, ids] of sourceGroups) {
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length - 1; i++) {
        const a = posMap.get(ids[i]!);
        const b = posMap.get(ids[i + 1]!);
        if (a && b) {
          linkGroup.append('line')
            .attr('x1', a.cx)
            .attr('y1', a.cy)
            .attr('x2', b.cx)
            .attr('y2', b.cy)
            .attr('stroke', '#2a2a35')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '3,3')
            .attr('opacity', 0.5);
        }
      }
    }

    // Draw memory dots
    const dotGroup = g.append('g').attr('class', 'dots');
    const cols = 4;

    for (const mem of memories) {
      const pos = posMap.get(mem.id);
      if (!pos) continue;
      const radius = 6 + Math.min(mem.accessCount * 0.5, 6);
      const offset = dragOffsets.get(mem.id);

      const circle = dotGroup.append('circle')
        .attr('cx', pos.cx)
        .attr('cy', pos.cy)
        .attr('r', radius)
        .attr('fill', layerColors[mem.layer] || '#6b7280')
        .attr('stroke', mem.pinned ? '#f59e0b' : 'none')
        .attr('stroke-width', mem.pinned ? 2 : 0)
        .attr('opacity', 0.85)
        .attr('cursor', 'pointer')
        .on('click', () => {
          selectedMemory = mem;
        });

      circle.append('title')
        .text(`${mem.content.substring(0, 80)}${mem.content.length > 80 ? '...' : ''}`);

      // Drag behavior
      const drag = d3.drag<SVGCircleElement, unknown>()
        .on('start', function () {
          d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2);
        })
        .on('drag', function (event) {
          const currentOffset = dragOffsets.get(mem.id) ?? { dx: 0, dy: 0 };
          const newOffset = { dx: currentOffset.dx + event.dx, dy: currentOffset.dy + event.dy };
          dragOffsets = new Map(dragOffsets);
          dragOffsets.set(mem.id, newOffset);
          d3.select(this)
            .attr('cx', pos.cx + newOffset.dx)
            .attr('cy', pos.cy + newOffset.dy);
        })
        .on('end', function () {
          d3.select(this)
            .attr('stroke', mem.pinned ? '#f59e0b' : 'none')
            .attr('stroke-width', mem.pinned ? 2 : 0);
        });

      circle.call(drag as any);
    }

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
        {#if selectedMemory.sourceId}
          <div class="text-[var(--text-muted)] text-xs">Session: {selectedMemory.sourceId.substring(0, 8)}</div>
        {/if}
      </div>
    </aside>
  {/if}
</div>
