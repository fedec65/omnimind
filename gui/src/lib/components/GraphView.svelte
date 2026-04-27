<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../api';
  import type { Entity, Relation } from '../api';
  import * as d3 from 'd3';

  let svgEl: SVGSVGElement;
  let containerEl: HTMLDivElement;
  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let selectedEntity = $state<Entity | null>(null);

  let entities = $state<Entity[]>([]);
  let relations = $state<Relation[]>([]);

  const typeColors: Record<string, string> = {
    person: '#ef4444',
    project: '#22c55e',
    concept: '#8b5cf6',
    file: '#f59e0b',
    api: '#3b82f6',
    class: '#ec4899',
    function: '#06b6d4',
    database: '#10b981',
    service: '#f97316',
    unknown: '#6b7280',
  };

  onMount(async () => {
    try {
      const data = await api.entities();
      entities = data.entities;
      const relData = await api.relations();
      relations = relData.relations;
      renderGraph();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load graph';
    } finally {
      isLoading = false;
    }
  });

  function renderGraph() {
    if (!svgEl || entities.length === 0) return;

    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    const svg = d3.select(svgEl)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    svg.selectAll('*').remove();

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    const nodeById = new Map(entities.map(e => [e.id, e]));

    const links = relations.map(r => ({
      source: r.subjectId,
      target: r.objectId,
      predicate: r.predicate,
      relation: r,
    }));

    const simulation = d3.forceSimulation(entities as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    const linkGroup = g.append('g').attr('class', 'links');
    const linkElements = linkGroup.selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#2a2a35')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    const linkLabelGroup = g.append('g').attr('class', 'link-labels');
    const linkLabels = linkLabelGroup.selectAll('text')
      .data(links)
      .join('text')
      .text(d => d.predicate)
      .attr('font-size', '9px')
      .attr('fill', '#7a7a8a')
      .attr('text-anchor', 'middle')
      .attr('dy', -3);

    const nodeGroup = g.append('g').attr('class', 'nodes');
    const nodeElements = nodeGroup.selectAll('g')
      .data(entities)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<any, any>()
        .on('start', (event, d: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d: any) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d: any) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      )
      .on('click', (_event, d) => {
        selectedEntity = d;
      });

    nodeElements.append('circle')
      .attr('r', (d: Entity) => 8 + Math.min(d.mentionCount * 2, 16))
      .attr('fill', (d: Entity) => typeColors[d.type] || typeColors.unknown)
      .attr('stroke', '#1a1a22')
      .attr('stroke-width', 2);

    nodeElements.append('text')
      .text((d: Entity) => d.name)
      .attr('font-size', '11px')
      .attr('fill', '#c4c4d0')
      .attr('dy', 20)
      .attr('text-anchor', 'middle')
      .style('pointer-events', 'none');

    simulation.on('tick', () => {
      linkElements
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      linkLabels
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2);

      nodeElements.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });
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
        Loading graph...
      </div>
    {:else if error}
      <div class="absolute inset-0 flex items-center justify-center text-red-400">
        {error}
      </div>
    {:else if entities.length === 0}
      <div class="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
        No graph data available. Memories will populate the graph as they are processed.
      </div>
    {/if}
    <svg bind:this={svgEl} class="w-full h-full"></svg>
  </div>

  {#if selectedEntity}
    <aside class="w-72 border-l border-[var(--border)] bg-[var(--surface)] p-4 overflow-auto">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-[var(--text-h)]">Entity Details</h3>
        <button onclick={() => selectedEntity = null} class="text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
      </div>
      <div class="space-y-3 text-sm">
        <div>
          <span class="text-[var(--text-muted)]">Name</span>
          <div class="font-medium text-[var(--text)]">{selectedEntity.name}</div>
        </div>
        <div>
          <span class="text-[var(--text-muted)]">Type</span>
          <span class="ml-2 px-2 py-0.5 rounded-full text-xs" style="background: {typeColors[selectedEntity.type]}20; color: {typeColors[selectedEntity.type]}">
            {selectedEntity.type}
          </span>
        </div>
        {#if selectedEntity.description}
          <div>
            <span class="text-[var(--text-muted)]">Description</span>
            <div class="text-[var(--text)] mt-1">{selectedEntity.description}</div>
          </div>
        {/if}
        <div>
          <span class="text-[var(--text-muted)]">Mentions</span>
          <div class="text-[var(--text)]">{selectedEntity.mentionCount}</div>
        </div>
      </div>
    </aside>
  {/if}
</div>
