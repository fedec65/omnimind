import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryBus } from '../../src/bus/MemoryBus.js';
import { MemoryStore } from '../../src/core/MemoryStore.js';
import {
  type MemoryEvent,
  type ToolAdapter,
  type BusSubscription,
  EventType,
  createMemoryEvent,
} from '../../src/bus/types.js';

class TestAdapter implements ToolAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities = ['read', 'write', 'sync', 'notify'] as const;
  receivedEvents: MemoryEvent[] = [];
  connected = false;

  constructor(id: string) {
    this.id = id;
    this.name = id;
  }

  async onConnect(): Promise<void> {
    this.connected = true;
  }

  async onDisconnect(): Promise<void> {
    this.connected = false;
  }

  async onMemoryEvent(event: MemoryEvent): Promise<void> {
    this.receivedEvents.push(event);
  }

  async publishEvent(event: MemoryEvent): Promise<void> {
    // Handled by base in real adapter
  }
}

describe('MemoryBus', () => {
  let tmpDir: string;
  let store: MemoryStore;
  let bus: MemoryBus;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-bus-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    const initResult = await store.init();
    expect(initResult.ok).toBe(true);
    bus = new MemoryBus(store);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should route events to all subscribed adapters', async () => {
    const adapterA = new TestAdapter('tool-a');
    const adapterB = new TestAdapter('tool-b');

    await bus.registerAdapter(adapterA);
    await bus.registerAdapter(adapterB);

    bus.subscribe('tool-a');
    bus.subscribe('tool-b');

    const event = createMemoryEvent('tool-c', EventType.Create, null, {
      content: 'Hello bus',
      wing: 'test',
    });

    const result = await bus.publish(event);
    expect(result.ok).toBe(true);

    // Adapters receive async — wait a tick
    await new Promise((r) => setTimeout(r, 10));

    expect(adapterA.receivedEvents.length).toBe(1);
    expect(adapterB.receivedEvents.length).toBe(1);
    expect(adapterA.receivedEvents[0]!.payload.content).toBe('Hello bus');
  });

  it('should not route back to source adapter', async () => {
    const adapter = new TestAdapter('tool-x');
    await bus.registerAdapter(adapter);
    bus.subscribe('tool-x');

    const event = createMemoryEvent('tool-x', EventType.Create, null, {
      content: 'Self event',
      wing: 'test',
    });

    await bus.publish(event);
    await new Promise((r) => setTimeout(r, 10));

    expect(adapter.receivedEvents.length).toBe(0);
  });

  it('should filter by wing subscription', async () => {
    const adapter = new TestAdapter('sub');
    await bus.registerAdapter(adapter);
    bus.subscribe('sub', { wings: ['alpha'] });

    const match = createMemoryEvent('pub', EventType.Create, null, {
      content: 'Alpha msg',
      wing: 'alpha',
    });

    const noMatch = createMemoryEvent('pub', EventType.Create, null, {
      content: 'Beta msg',
      wing: 'beta',
    });

    await bus.publish(match);
    await bus.publish(noMatch);
    await new Promise((r) => setTimeout(r, 10));

    expect(adapter.receivedEvents.length).toBe(1);
    expect(adapter.receivedEvents[0]!.payload.wing).toBe('alpha');
  });

  it('should filter by event type', async () => {
    const adapter = new TestAdapter('type-filter');
    await bus.registerAdapter(adapter);
    bus.subscribe('type-filter', { eventTypes: [EventType.Create] });

    const createEvent = createMemoryEvent('pub', EventType.Create, null, {
      content: 'Created',
      wing: 'test',
    });

    const updateEvent = createMemoryEvent('pub', EventType.Update, null, {
      content: 'Updated',
      wing: 'test',
    });

    await bus.publish(createEvent);
    await bus.publish(updateEvent);
    await new Promise((r) => setTimeout(r, 10));

    expect(adapter.receivedEvents.length).toBe(1);
    expect(adapter.receivedEvents[0]!.eventType).toBe(EventType.Create);
  });

  it('should increment vector clock on each event', async () => {
    const event1 = createMemoryEvent('tool-a', EventType.Create, null, {
      content: 'First',
      wing: 'test',
    });

    const event2 = createMemoryEvent('tool-a', EventType.Create, null, {
      content: 'Second',
      wing: 'test',
    });

    await bus.publish(event1);
    await bus.publish(event2);

    const clock = bus.getVectorClock();
    expect(clock['tool-a']).toBe(2);
  });

  it('should sync return empty array when no events missed', async () => {
    const result = await bus.sync('tool-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('should handle adapter disconnection gracefully', async () => {
    const adapter = new TestAdapter('fragile');
    await bus.registerAdapter(adapter);
    bus.subscribe('fragile');

    // Simulate adapter throwing on event
    adapter.onMemoryEvent = async () => {
      throw new Error('Boom');
    };

    const event = createMemoryEvent('pub', EventType.Create, null, {
      content: 'Crash test',
      wing: 'test',
    });

    // Should not throw
    const result = await bus.publish(event);
    expect(result.ok).toBe(true);

    // Event should be in dead letter
    await new Promise((r) => setTimeout(r, 10));
    expect(bus.getDeadLetter().length).toBeGreaterThan(0);
  });

  it('should maintain ordering across vector clocks', async () => {
    const eventA = createMemoryEvent('tool-a', EventType.Create, null, {
      content: 'A',
      wing: 'test',
    }, { 'tool-a': 1 });

    const eventB = createMemoryEvent('tool-a', EventType.Create, null, {
      content: 'B',
      wing: 'test',
    }, { 'tool-a': 2 });

    const resultA = await bus.publish(eventA);
    const resultB = await bus.publish(eventB);

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);

    const clock = bus.getVectorClock();
    expect(clock['tool-a']).toBeGreaterThanOrEqual(2);
  });
});
