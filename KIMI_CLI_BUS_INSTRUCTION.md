# KIMI-CLI Development Instruction: Cross-Tool Memory Bus

## Feature Overview

Implement the **Cross-Tool Memory Bus** for Omnimind — a universal, local message broker that enables multiple AI tools (Claude Code, Cursor, ChatGPT, etc.) to share a single memory namespace via MCP protocol.

This is the **Phase 3** feature from the Omnimind ROADMAP.md. It sits between the core memory engine (already implemented) and external MCP clients, routing memory events, resolving conflicts, and keeping all tools synchronized.

---

## Core Concept

**One brain, many tools.** Every AI tool reads from and writes to the same Omnimind instance. When one tool learns something, all tools know it.

```
┌─────────────────────────────────────────────────┐
│           CROSS-TOOL MEMORY BUS                    │
│                                                   │
│  ┌──────────────┐     ┌──────────────────┐        │
│  │  MemoryBus   │◄───►│ ConflictResolver │        │
│  │  (router)    │     │ (merge strategy)  │        │
│  └──────┬───────┘     └──────────────────┘        │
│         │                                         │
│    ┌────┴────┬────────┬────────┐                  │
│    ▼         ▼        ▼        ▼                  │
│ ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐              │
│ │Claude│  │Cursor│  │Chat │  │Any  │              │
│ │Code  │  │IDE   │  │GPT  │  │MCP  │              │
│ └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘              │
│    └─────────┴────────┴────────┘                  │
│              │                                    │
│         ┌────▼────┐                               │
│         │  Core   │                               │
│         │ Memory  │                               │
│         │ Store   │                               │
│         └─────────┘                               │
└─────────────────────────────────────────────────┘
```

---

## What to Build

### 5 New Files + 1 Modified File

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `src/bus/types.ts` | Bus-specific type definitions | ~80 |
| `src/bus/ConflictResolver.ts` | Temporal conflict resolution | ~200 |
| `src/bus/MemoryBus.ts` | Core event router and publisher | ~250 |
| `src/bus/adapters/ClaudeAdapter.ts` | Claude Code integration | ~180 |
| `src/bus/adapters/BaseAdapter.ts` | Adapter interface and common logic | ~120 |
| `src/mcp/server.ts` | **MODIFY** — Add bus-integrated tools | ~50 additions |

---

## Technical Architecture

### 1. Event System

All tool interactions happen through `MemoryEvent` objects:

```typescript
// src/bus/types.ts

interface MemoryEvent {
  id: string;                    // UUID v4
  timestamp: number;             // Unix ms
  sourceTool: string;              // "claude-code", "cursor", "chatgpt", "generic"
  eventType: 'create' | 'update' | 'delete' | 'access' | 'sync_request';
  memoryId: string | null;       // Affected memory (null for bulk ops)
  payload: {
    content?: string;
    wing?: string;
    room?: string;
    metadata?: Record<string, unknown>;
    validFrom?: number;          // For temporal facts
    validTo?: number;            // For superseded facts
  };
  vectorClock: Record<string, number>;  // CRDT-style: { "claude-code": 5, "cursor": 3 }
  priority: 'auto' | 'user' | 'system';  // Conflict resolution priority
}

interface ToolAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ('read' | 'write' | 'sync' | 'notify')[];
  
  onConnect(): Promise<void>;
  onDisconnect(): Promise<void>;
  onMemoryEvent(event: MemoryEvent): Promise<void>;
  publishEvent(event: MemoryEvent): Promise<void>;
}

interface BusSubscription {
  toolId: string;
  filter?: {
    wings?: string[];
    eventTypes?: MemoryEvent['eventType'][];
    minPriority?: MemoryEvent['priority'];
  };
}
```

### 2. Conflict Resolution Strategy

```typescript
// src/bus/ConflictResolver.ts

/**
 * Conflict resolution for the same fact from different tools.
 * 
 * Strategy: Temporal Validity with Tool Priority
 * 
 * When two tools report conflicting facts (e.g., "use JWT" vs "use OAuth2"):
 * 1. If timestamps differ: later timestamp wins, earlier gets valid_to set
 * 2. If concurrent (vector clock): use tool priority as tiebreaker
 * 3. Always preserve both facts with validity windows
 */

interface ConflictResolution {
  resolution: 'accepted' | 'rejected' | 'merged' | 'manual_review';
  winningEvent: MemoryEvent;
  losingEvent: MemoryEvent;
  action: 'replace' | 'supersede' | 'branch' | 'flag';
  explanation: string;
}

// Tool priority for tiebreaking (higher = wins)
const ToolPriority: Record<string, number> = {
  'user-edit': 100,      // User manually editing always wins
  'claude-code': 80,     // IDE-integrated tools high priority
  'cursor': 80,
  'vscode': 70,
  'chatgpt': 50,         // Web chat lower priority
  'generic': 10,
};
```

### 3. MemoryBus Core

```typescript
// src/bus/MemoryBus.ts

/**
 * Central message broker for memory events.
 * 
 * Responsibilities:
 * 1. Receive events from any adapter
 * 2. Persist to MemoryStore
 * 3. Route to other adapters (pub/sub)
 * 4. Detect and resolve conflicts
 * 5. Maintain vector clocks for distributed sync
 */

class MemoryBus {
  private adapters: Map<string, ToolAdapter> = new Map();
  private subscriptions: Map<string, BusSubscription[]> = new Map();
  private resolver: ConflictResolver;
  private store: MemoryStore;
  private localClock: Record<string, number> = {};
  
  // Core methods
  registerAdapter(adapter: ToolAdapter): Promise<Result<void>>;
  unregisterAdapter(toolId: string): void;
  
  publish(event: MemoryEvent): Promise<Result<void>>;           // Incoming from tool
  route(event: MemoryEvent): Promise<void>;                      // Outgoing to tools
  
  subscribe(toolId: string, filter?: BusSubscription['filter']): void;
  unsubscribe(toolId: string): void;
  
  sync(toolId: string, since?: number): Promise<Result<MemoryEvent[]>>;  // Pull missed events
  
  getVectorClock(): Record<string, number>;
  mergeVectorClock(remote: Record<string, number>): void;
}
```

### 4. Tool Adapters

```typescript
// src/bus/adapters/BaseAdapter.ts

/**
 * Abstract base for all tool adapters.
 * Handles common logic: event serialization, reconnection, heartbeat.
 */

abstract class BaseAdapter implements ToolAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ('read' | 'write' | 'sync' | 'notify')[];
  
  protected bus: MemoryBus;
  protected connected = false;
  protected lastSeen = 0;
  
  constructor(bus: MemoryBus, config: AdapterConfig);
  
  abstract onConnect(): Promise<void>;
  abstract onDisconnect(): Promise<void>;
  abstract onMemoryEvent(event: MemoryEvent): Promise<void>;
  
  // Common implementation
  async publishEvent(event: MemoryEvent): Promise<void> {
    // Add our vector clock entry before publishing
    event.vectorClock[this.id] = (event.vectorClock[this.id] || 0) + 1;
    await this.bus.publish(event);
  }
  
  protected heartbeat(): void;  // Every 30s while connected
}
```

```typescript
// src/bus/adapters/ClaudeAdapter.ts

/**
 * Claude Code integration adapter.
 * 
 * How it works:
 * - Watches ~/.claude/projects/ directory for conversation files
 * - Auto-extracts decisions, preferences, architecture choices
 * - Publishes to bus on file change
 * - Receives notifications when other tools update shared memories
 * - Injects relevant memories via CLAUDE.md or MCP
 */

class ClaudeAdapter extends BaseAdapter {
  private watchPath: string;
  private watcher: FSWatcher | null = null;
  
  constructor(bus: MemoryBus, config: { watchPath?: string } = {});
  
  async onConnect(): Promise<void> {
    // Set up file watcher on Claude conversation directory
    // Start polling or use fs.watch for conversation file changes
  }
  
  async onMemoryEvent(event: MemoryEvent): Promise<void> {
    // Received notification that another tool updated memory
    // Update local CLAUDE.md or trigger context refresh if relevant
  }
  
  private extractMemoryFromConversation(filePath: string): MemoryEvent {
    // Parse conversation JSON/text
    // Extract: user decisions, preferences, code choices, architecture
    // Return as MemoryEvent for bus publication
  }
}
```

---

## Implementation Steps (Do in This Order)

### Step 1: Define Types (`src/bus/types.ts`)

Create all bus-specific types. Must integrate with existing types from `src/core/types.ts`.

**Requirements:**
- `MemoryEvent` must include temporal fields (`validFrom`, `validTo`)
- `ToolAdapter` interface must be async throughout
- Vector clock must be serializable as JSON
- Event priority levels: `'auto' < 'user' < 'system'`

### Step 2: Build ConflictResolver (`src/bus/ConflictResolver.ts`)

Implement the conflict resolution engine.

**Algorithm:**

```
resolve(eventA, eventB):
  // Same memory, different content = conflict
  if eventA.memoryId != eventB.memoryId: return no_conflict
  
  // Check temporal validity
  if eventA.payload.validFrom != eventB.payload.validFrom:
    // Different time periods = both valid (temporal evolution)
    return { resolution: 'merged', action: 'supersede' }
  
  // Concurrent events (same time)
  if compareVectorClocks(eventA, eventB) == 'concurrent':
    // Tool priority tiebreaker
    priorityA = ToolPriority[eventA.sourceTool] || 10
    priorityB = ToolPriority[eventB.sourceTool] || 10
    
    if priorityA != priorityB:
      winner = priorityA > priorityB ? eventA : eventB
      loser = priorityA > priorityB ? eventB : eventA
      return { resolution: 'accepted', winningEvent: winner, action: 'replace' }
    
    // Same priority = flag for manual review
    return { resolution: 'manual_review', action: 'branch' }
```

**Test cases your resolver MUST handle:**
1. Same fact from same tool at different times → later wins, earlier gets `validTo`
2. Different facts about same topic from different tools → both accepted with different `validFrom`
3. Conflicting facts at same time, different tools → tool priority decides
4. Conflicting facts at same time, same priority → manual review flag
5. User-edited fact vs auto-extracted fact → user edit always wins

### Step 3: Build MemoryBus (`src/bus/MemoryBus.ts`)

The core router. Implement in this order:

1. **Adapter registry** — `registerAdapter()`, `unregisterAdapter()`
2. **Publish pipeline** — receive event → check for conflicts → resolve → store → route
3. **Routing engine** — filter events by subscription, send to matching adapters
4. **Subscription management** — `subscribe()`, `unsubscribe()` with wing/type filters
5. **Sync protocol** — `sync()` for catching up after disconnect
6. **Vector clock management** — `getVectorClock()`, `mergeVectorClock()`

**Pub/Sub Routing Logic:**

```typescript
private async route(event: MemoryEvent): Promise<void> {
  for (const [toolId, subs] of this.subscriptions) {
    // Don't route back to source
    if (toolId === event.sourceTool) continue;
    
    for (const sub of subs) {
      if (this.matchesFilter(event, sub.filter)) {
        const adapter = this.adapters.get(toolId);
        if (adapter) {
          await adapter.onMemoryEvent(event);
        }
      }
    }
  }
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
    const priorityOrder = { auto: 0, user: 1, system: 2 };
    if (priorityOrder[event.priority] < priorityOrder[filter.minPriority]) {
      return false;
    }
  }
  
  return true;
}
```

### Step 4: Build BaseAdapter (`src/bus/adapters/BaseAdapter.ts`)

Abstract base class with common functionality.

**Must include:**
- Event serialization/deserialization
- Reconnection logic with exponential backoff
- Heartbeat mechanism (every 30 seconds)
- Graceful error handling (don't crash bus if one adapter fails)

### Step 5: Build ClaudeAdapter (`src/bus/adapters/ClaudeAdapter.ts`)

First concrete adapter. This proves the system works.

**Implementation approach:**

Since Claude Code stores conversations in `~/.claude/projects/`, the adapter:

1. Watches that directory for file changes
2. Parses conversation files (JSON format)
3. Extracts "decision moments" — look for patterns like:
   - "We decided to..."
   - "Let's use..."
   - "The approach will be..."
   - "I prefer..."
   - Code review comments that resolve discussions
4. Publishes extracted decisions as `MemoryEvent`
5. When other tools update shared memories, writes notification to `CLAUDE.md`

**Decision Extraction Pattern:**

```typescript
private DECISION_PATTERNS = [
  /(?:we decided|let's use|we'll use|going with|chosen|selected)\s+(.{10,200})/i,
  /(?:I prefer|let's go with|best option is|approach will be)\s+(.{10,200})/i,
  /(?:agreed|consensus|decided|conclusion)\s*:?\s*(.{10,300})/i,
];
```

**File watching strategy:**
- Use `fs.watchFile()` or `fs.watch()` on `~/.claude/projects/**/*.jsonl`
- Debounce: wait 2 seconds after last change before processing
- Track processed files by hash to avoid re-processing

### Step 6: Integrate with MCP Server (`src/mcp/server.ts`)

Add two new MCP tools that expose bus functionality:

```typescript
// Add to ListToolsRequestSchema handler:
{
  name: 'omnimind_subscribe',
  description: 'Subscribe to memory updates from a specific wing or room. Get notified when other tools update shared memories.',
  inputSchema: zodToJsonSchema(SubscribeInput),
},
{
  name: 'omnimind_sync',
  description: 'Sync memories from other tools. Call this when starting a new session to pull missed updates.',
  inputSchema: zodToJsonSchema(SyncInput),
}
```

```typescript
// Input schemas:
const SubscribeInput = z.object({
  wings: z.array(z.string()).optional().describe('Wings to subscribe to'),
  rooms: z.array(z.string()).optional().describe('Rooms to subscribe to'),
  eventTypes: z.array(z.enum(['create', 'update', 'delete'])).optional(),
});

const SyncInput = z.object({
  since: z.number().optional().describe('Unix timestamp — get events after this time'),
  toolId: z.string().optional().describe('Only sync from specific tool (e.g., "cursor")'),
});
```

**Tool handlers:**

```typescript
// In CallToolRequestSchema handler, add:
case 'omnimind_subscribe':
  return await this.handleSubscribe(request.params.arguments);
case 'omnimind_sync':
  return await this.handleSync(request.params.arguments);

// Implementation:
private async handleSubscribe(args: unknown) {
  const input = SubscribeInput.parse(args);
  const toolId = this.getCurrentToolId(); // From MCP connection metadata
  
  this.bus.subscribe(toolId, {
    wings: input.wings,
    eventTypes: input.eventTypes,
  });
  
  return {
    content: [{ type: 'text', text: `Subscribed to ${input.wings?.join(', ') || 'all wings'}` }],
  };
}

private async handleSync(args: unknown) {
  const input = SyncInput.parse(args);
  const toolId = this.getCurrentToolId();
  
  const events = await this.bus.sync(toolId, input.since);
  
  if (!events.ok) throw events.error;
  
  const lines = events.value.map(e => 
    `[${e.sourceTool}] ${e.payload.wing}: ${e.payload.content?.substring(0, 200)}`
  );
  
  return {
    content: [{ type: 'text', text: `Synced ${events.value.length} events:\n${lines.join('\n')}` }],
  };
}
```

### Step 7: Integration in Main Omnimind Class (`src/index.ts`)

Add bus initialization to the main Omnimind class:

```typescript
// In Omnimind.create():
const bus = new MemoryBus(store);
const claudeAdapter = new ClaudeAdapter(bus);
await bus.registerAdapter(claudeAdapter);
// Register other adapters similarly

// Add public methods:
async subscribe(wings?: string[], rooms?: string[]): Promise<Result<void>>;
async sync(since?: number, toolId?: string): Promise<Result<MemoryEvent[]>>;
async getConflictReport(): Promise<Result<ConflictResolution[]>>;
```

### Step 8: CLI Commands (`src/cli.ts`)

Add bus commands:

```bash
omnimind bus status              # Show connected tools and subscriptions
omnimind bus sync [tool-id]      # Pull updates from specific tool
omnimind bus conflicts           # List unresolved conflicts
omnimind bus resolve <id>        # Manually resolve a conflict
```

---

## Testing Requirements

Create these test files:

### `tests/bus/ConflictResolver.test.ts`

```typescript
describe('ConflictResolver', () => {
  it('should accept later fact over earlier fact');
  it('should supersede with temporal validity');
  it('should use tool priority for concurrent events');
  it('should flag equal-priority conflicts for review');
  it('should always accept user edits over auto-extracted');
  it('should merge non-conflicting facts about same topic');
});
```

### `tests/bus/MemoryBus.test.ts`

```typescript
describe('MemoryBus', () => {
  it('should route events to all subscribed adapters');
  it('should not route back to source adapter');
  it('should filter by wing subscription');
  it('should filter by event type');
  it('should detect and resolve conflicts on publish');
  it('should increment vector clock on each event');
  it('should sync missed events after reconnection');
  it('should handle adapter disconnection gracefully');
  it('should maintain ordering across vector clocks');
});
```

### `tests/bus/adapters/ClaudeAdapter.test.ts`

```typescript
describe('ClaudeAdapter', () => {
  it('should detect conversation file changes');
  it('should extract decisions from conversation text');
  it('should publish memory events on decision detection');
  it('should write notifications to CLAUDE.md on external events');
  it('should debounce rapid file changes');
});
```

**All tests must:**
- Use in-memory SQLite (like existing tests)
- Mock file system for Claude adapter
- Assert on event routing (spy on adapter methods)
- Verify vector clock progression
- Check conflict resolution outcomes

---

## Performance Requirements

| Metric | Target | Test |
|--------|--------|------|
| Event publish latency | < 10ms | `bus.publish()` p95 |
| Routing to 3 adapters | < 15ms | 3 concurrent `onMemoryEvent()` calls |
| Conflict detection | < 5ms | Compare 2 events |
| Sync 100 missed events | < 50ms | `bus.sync()` with 100 events |
| Memory overhead per adapter | < 5MB | Process memory check |

---

## Error Handling Rules

1. **One adapter crash must not affect others** — wrap each `adapter.onMemoryEvent()` in try/catch
2. **Failed events go to dead-letter queue** — store failed events in `failed_events` SQLite table for retry
3. **Sync conflicts are non-fatal** — log warning, don't throw
4. **Missing adapter on route = skip silently** — adapter may have disconnected between subscribe and route
5. **Circular routing prevention** — track `event.sourceTool` and never route back

---

## Code Style (Follow Existing Project)

- Use `Result<T>` return type (from `src/core/types.ts`) for all fallible operations
- Use `readonly` on all interface properties
- Prefix private methods with `_` or use `#` private fields
- Use `performance.now()` for latency tracking in hot paths
- Log with `[MemoryBus]`, `[ConflictResolver]`, `[ClaudeAdapter]` prefixes
- All async methods must return `Promise<Result<T>>` or `Promise<void>`

---

## File Structure to Create

```
src/bus/
├── types.ts
├── MemoryBus.ts
├── ConflictResolver.ts
└── adapters/
    ├── BaseAdapter.ts
    └── ClaudeAdapter.ts

tests/bus/
├── MemoryBus.test.ts
├── ConflictResolver.test.ts
└── adapters/
    └── ClaudeAdapter.test.ts
```

---

## Success Criteria

Before declaring done, verify:

1. [ ] `npm test` passes with all new tests
2. [ ] `omnimind bus status` shows connected adapters
3. [ ] Simulated Claude conversation file triggers `MemoryEvent` publication
4. [ ] Subscribed adapter receives routed event within 15ms
5. [ ] Conflicting facts get `validTo`/`validFrom` temporal entries
6. [ ] Vector clocks increment monotonically per tool
7. [ ] Sync returns all events a tool missed while disconnected
8. [ ] One adapter failure doesn't crash the bus
9. [ ] No external API calls (verify with network monitoring)
10. [ ] Test coverage for bus/ directory >= 80%

---

## Integration Checklist

After implementing the bus, verify integration with existing code:

- [ ] `MemoryStore` CRUD still works independently
- [ ] `IntentPredictor` records accesses from bus events
- [ ] `AgingPipeline` processes memories created via bus
- [ ] MCP `omnimind_search` includes cross-tool memories
- [ ] MCP `omnimind_status` shows bus statistics
- [ ] CLI `omnimind store` still works (bypasses bus for local storage)

---

## Notes for Implementation

1. **Start simple** — Implement publish/route/subscribe first, then add conflict resolution, then sync, then adapters
2. **Vector clocks** — Use simple incrementing counters per tool. Full CRDT logic can be added later.
3. **Claude file format** — If conversation format is unknown, use a simple text watcher that triggers on any change, then refine parsing
4. **Debouncing** — File watchers must debounce (2s delay) to avoid processing incomplete writes
5. **Subscriptions** — Default subscription should be wing-based: Claude Code subscribes to the project wing it's working in
6. **Temporal fields** — When storing from bus, always set `validFrom = Date.now()`. `validTo` is set only when superseded.
