/**
 * Bus-specific type definitions for Cross-Tool Memory Bus
 *
 * Types for event routing, conflict resolution, and tool adapters.
 * Integrates with core types from src/core/types.ts.
 */

// Bus-specific types — no core imports needed at top level

/** Event types that can flow through the bus */
export const EventType = {
  Create: 'create',
  Update: 'update',
  Delete: 'delete',
  Access: 'access',
  SyncRequest: 'sync_request',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

/** Priority levels for conflict resolution */
export const EventPriority = {
  Auto: 'auto',
  User: 'user',
  System: 'system',
} as const;

export type EventPriority = (typeof EventPriority)[keyof typeof EventPriority];

/** A memory event flowing through the bus */
export interface MemoryEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly sourceTool: string;
  readonly eventType: EventType;
  readonly memoryId: string | null;
  readonly payload: {
    readonly content?: string;
    readonly wing?: string;
    readonly room?: string;
    readonly metadata?: Record<string, unknown>;
    readonly validFrom?: number;
    readonly validTo?: number;
  };
  readonly vectorClock: Record<string, number>;
  readonly priority: EventPriority;
}

/** Subscription filter for selective event routing */
export interface BusSubscription {
  readonly toolId: string;
  readonly filter?: {
    readonly wings?: string[];
    readonly eventTypes?: EventType[];
    readonly minPriority?: EventPriority;
  };
}

/** Adapter configuration */
export interface AdapterConfig {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly AdapterCapability[];
}

export type AdapterCapability = 'read' | 'write' | 'sync' | 'notify';

/** Interface that every tool adapter must implement */
export interface ToolAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly AdapterCapability[];

  onConnect(): Promise<void>;
  onDisconnect(): Promise<void>;
  onMemoryEvent(event: MemoryEvent): Promise<void>;
  publishEvent(event: MemoryEvent): Promise<void>;
}

/** Result of conflict resolution */
export interface ConflictResolution {
  readonly resolution: 'accepted' | 'rejected' | 'merged' | 'manual_review';
  readonly winningEvent: MemoryEvent;
  readonly losingEvent: MemoryEvent;
  readonly action: 'replace' | 'supersede' | 'branch' | 'flag';
  readonly explanation: string;
}

/** Tool priority for conflict tiebreaking (higher = wins) */
export const ToolPriority: Record<string, number> = {
  'user-edit': 100,
  'claude-code': 80,
  cursor: 80,
  vscode: 70,
  chatgpt: 50,
  generic: 10,
};

/** Priority order for filter comparison */
export const PriorityOrder: Record<EventPriority, number> = {
  auto: 0,
  user: 1,
  system: 2,
};

/** Dead-letter event for failed routing */
export interface DeadLetterEvent {
  readonly id: string;
  readonly event: MemoryEvent;
  readonly targetToolId: string;
  readonly error: string;
  readonly failedAt: number;
  readonly retryCount: number;
}

/** Bus health and statistics */
export interface BusStats {
  readonly adapterCount: number;
  readonly subscriptionCount: number;
  readonly eventsPublished: number;
  readonly eventsRouted: number;
  readonly conflictsDetected: number;
  readonly conflictsResolved: number;
  readonly deadLetterCount: number;
  readonly vectorClock: Record<string, number>;
}

/** Input for bus subscription (MCP / API) */
export interface SubscribeInput {
  readonly wings?: string[];
  readonly rooms?: string[];
  readonly eventTypes?: EventType[];
}

/** Input for sync request (MCP / API) */
export interface SyncInput {
  readonly since?: number;
  readonly toolId?: string;
}

/** Factory for creating MemoryEvent objects */
export function createMemoryEvent(
  sourceTool: string,
  eventType: EventType,
  memoryId: string | null,
  payload: MemoryEvent['payload'],
  vectorClock: Record<string, number> = {},
  priority: EventPriority = 'auto',
): MemoryEvent {
  return {
    id: `${sourceTool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    sourceTool,
    eventType,
    memoryId,
    payload,
    vectorClock: { ...vectorClock },
    priority,
  };
}
