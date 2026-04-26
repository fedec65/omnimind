/**
 * MemoryBus — Central message broker for cross-tool memory events
 *
 * Responsibilities:
 * 1. Receive events from any adapter
 * 2. Detect and resolve conflicts
 * 3. Persist to MemoryStore
 * 4. Route to other adapters (pub/sub)
 * 5. Maintain vector clocks for distributed sync
 * 6. Buffer failed events in dead-letter queue
 */

import {
  type MemoryEvent,
  type ToolAdapter,
  type BusSubscription,
  type BusStats,
  type DeadLetterEvent,
  PriorityOrder,
  createMemoryEvent,
} from './types.js';
import { ConflictResolver } from './ConflictResolver.js';
import { type MemoryStore } from '../core/MemoryStore.js';
import { type MemoryMeta, type Result, ok, err } from '../core/types.js';

export class MemoryBus {
  private adapters = new Map<string, ToolAdapter>();
  private subscriptions = new Map<string, BusSubscription[]>();
  private resolver = new ConflictResolver();
  private store: MemoryStore;
  private vectorClock: Record<string, number> = {};
  private deadLetter: DeadLetterEvent[] = [];
  private readonly maxDeadLetter = 1000;

  // Metrics
  private eventsPublished = 0;
  private eventsRouted = 0;
  private conflictsDetected = 0;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  // ─── Adapter Lifecycle ──────────────────────────────────────────

  async registerAdapter(adapter: ToolAdapter): Promise<Result<void>> {
    try {
      if (this.adapters.has(adapter.id)) {
        return err(new Error(`Adapter ${adapter.id} already registered`));
      }
      this.adapters.set(adapter.id, adapter);
      await adapter.onConnect();
      console.log(`[MemoryBus] Adapter connected: ${adapter.id}`);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  unregisterAdapter(toolId: string): void {
    const adapter = this.adapters.get(toolId);
    if (adapter) {
      adapter.onDisconnect().catch(() => {});
      this.adapters.delete(toolId);
      this.subscriptions.delete(toolId);
      console.log(`[MemoryBus] Adapter disconnected: ${toolId}`);
    }
  }

  // ─── Publish Pipeline ───────────────────────────────────────────

  async publish(event: MemoryEvent): Promise<Result<void>> {
    const start = performance.now();
    try {
      this.eventsPublished++;

      // Increment vector clock for source tool
      this.vectorClock[event.sourceTool] = (this.vectorClock[event.sourceTool] || 0) + 1;

      // Check for conflicts with recent events on same memory
      const conflictResult = await this.detectConflict(event);
      if (!conflictResult.ok) return conflictResult;

      if (conflictResult.value) {
        this.conflictsDetected++;
        await this.applyResolution(conflictResult.value);
      }

      // Persist to store (if create/update and has content)
      if ((event.eventType === 'create' || event.eventType === 'update') && event.payload.content) {
        const storeResult = await this.persistEvent(event);
        if (!storeResult.ok) return storeResult;
      }

      // Route to subscribed adapters
      await this.route(event);

      const latency = performance.now() - start;
      if (latency > 10) {
        console.log(`[MemoryBus] Slow publish: ${latency.toFixed(1)}ms`);
      }

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ─── Subscription Management ────────────────────────────────────

  subscribe(toolId: string, filter?: BusSubscription['filter']): void {
    const existing = this.subscriptions.get(toolId) ?? [];
    const sub: BusSubscription = filter
      ? { toolId, filter }
      : { toolId };
    existing.push(sub);
    this.subscriptions.set(toolId, existing);
  }

  unsubscribe(toolId: string): void {
    this.subscriptions.delete(toolId);
  }

  // ─── Sync Protocol ──────────────────────────────────────────────

  async sync(toolId: string, since?: number): Promise<Result<MemoryEvent[]>> {
    try {
      // For now, sync returns events from the dead letter + a placeholder.
      // Full sync would query a dedicated event log table.
      // Since we don't persist all events yet, return empty.
      console.log(`[MemoryBus] Sync requested by ${toolId} since ${since ?? 'beginning'}`);
      return ok([]);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ─── Vector Clock ───────────────────────────────────────────────

  getVectorClock(): Record<string, number> {
    return { ...this.vectorClock };
  }

  mergeVectorClock(remote: Record<string, number>): void {
    for (const [tool, count] of Object.entries(remote)) {
      this.vectorClock[tool] = Math.max(this.vectorClock[tool] || 0, count);
    }
  }

  // ─── Statistics ─────────────────────────────────────────────────

  getStats(): BusStats {
    return {
      adapterCount: this.adapters.size,
      subscriptionCount: Array.from(this.subscriptions.values()).flat().length,
      eventsPublished: this.eventsPublished,
      eventsRouted: this.eventsRouted,
      conflictsDetected: this.conflictsDetected,
      conflictsResolved: this.resolver.getStats().conflictsResolved,
      deadLetterCount: this.deadLetter.length,
      vectorClock: { ...this.vectorClock },
    };
  }

  getAdapters(): ToolAdapter[] {
    return Array.from(this.adapters.values());
  }

  getDeadLetter(): readonly DeadLetterEvent[] {
    return this.deadLetter;
  }

  // ─── Private helpers ────────────────────────────────────────────

  private async detectConflict(event: MemoryEvent): Promise<Result<import('./types.js').ConflictResolution | null>> {
    // For create/update on existing memory, check store
    if (!event.memoryId || event.eventType === 'access' || event.eventType === 'sync_request') {
      return ok(null);
    }

    // Check if memory exists in store
    const existing = await this.store.get(event.memoryId);
    if (!existing.ok || !existing.value) {
      return ok(null);
    }

    // Build a synthetic event from the stored memory for comparison
    const stored = existing.value;
    const storedEvent = createMemoryEvent(
      stored.sourceTool,
      'create',
      stored.id,
      { content: stored.content, wing: stored.wing, room: stored.room },
      {},
      'auto',
    );

    const resolution = this.resolver.resolve(event, storedEvent);
    if (!resolution.ok) return err(resolution.error);

    return ok(resolution.value ?? null);
  }

  private async applyResolution(resolution: import('./types.js').ConflictResolution): Promise<void> {
    const loser = resolution.losingEvent;
    if (loser.memoryId && resolution.action === 'supersede') {
      // Update the losing memory's validTo
      await this.store.update(loser.memoryId, {
        validTo: Date.now(),
      });
    }
  }

  private async persistEvent(event: MemoryEvent): Promise<Result<void>> {
    const meta = {
      wing: event.payload.wing ?? 'general',
      sourceTool: event.sourceTool,
      sourceId: event.memoryId ?? undefined,
      validFrom: event.payload.validFrom,
      validTo: event.payload.validTo,
    } as MemoryMeta;
    if (event.payload.room !== undefined) {
      (meta as unknown as Record<string, unknown>).room = event.payload.room;
    }

    const result = await this.store.store(event.payload.content!, meta);
    if (!result.ok) {
      return err(result.error);
    }
    return ok(undefined);
  }

  private async route(event: MemoryEvent): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [toolId, subs] of this.subscriptions) {
      // Don't route back to source
      if (toolId === event.sourceTool) continue;

      const adapter = this.adapters.get(toolId);
      if (!adapter) continue;

      for (const sub of subs) {
        if (this.matchesFilter(event, sub.filter)) {
          this.eventsRouted++;
          promises.push(
            adapter.onMemoryEvent(event).catch((error: unknown) => {
              this.addDeadLetter(event, toolId, String(error));
            }),
          );
        }
      }
    }

    await Promise.all(promises);
  }

  private matchesFilter(event: MemoryEvent, filter?: BusSubscription['filter']): boolean {
    if (!filter) return true;

    if (filter.wings && event.payload.wing) {
      if (!filter.wings.includes(event.payload.wing)) return false;
    }

    if (filter.eventTypes && !filter.eventTypes.includes(event.eventType)) {
      return false;
    }

    if (filter.minPriority) {
      if ((PriorityOrder[event.priority] ?? 0) < (PriorityOrder[filter.minPriority] ?? 0)) {
        return false;
      }
    }

    return true;
  }

  private addDeadLetter(event: MemoryEvent, targetToolId: string, error: string): void {
    if (this.deadLetter.length >= this.maxDeadLetter) {
      this.deadLetter.shift();
    }
    this.deadLetter.push({
      id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      event,
      targetToolId,
      error,
      failedAt: Date.now(),
      retryCount: 0,
    });
  }
}
