/**
 * BaseAdapter — Abstract base for all tool adapters
 *
 * Handles common logic: event serialization, reconnection, heartbeat.
 * Concrete adapters extend this and implement the lifecycle hooks.
 */

import {
  type MemoryEvent,
  type ToolAdapter,
  type AdapterConfig,
  createMemoryEvent,
} from '../types.js';
import { type MemoryBus } from '../MemoryBus.js';

export abstract class BaseAdapter implements ToolAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly ('read' | 'write' | 'sync' | 'notify')[];

  protected bus: MemoryBus;
  protected connected = false;
  protected lastSeen = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 30000; // 30s

  constructor(bus: MemoryBus, config: AdapterConfig) {
    this.bus = bus;
    this.id = config.id;
    this.name = config.name;
    this.capabilities = config.capabilities;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  abstract onConnect(): Promise<void>;
  abstract onDisconnect(): Promise<void>;
  abstract onMemoryEvent(event: MemoryEvent): Promise<void>;

  async publishEvent(event: MemoryEvent): Promise<void> {
    // Add our vector clock entry before publishing
    const updatedEvent = createMemoryEvent(
      event.sourceTool,
      event.eventType,
      event.memoryId,
      event.payload,
      { ...event.vectorClock, [this.id]: (event.vectorClock[this.id] || 0) + 1 },
      event.priority,
    );
    await this.bus.publish(updatedEvent);
  }

  // ─── Connection management ──────────────────────────────────────

  protected markConnected(): void {
    this.connected = true;
    this.lastSeen = Date.now();
    this.reconnectAttempts = 0;
    this.startHeartbeat();
    console.log(`[${this.id}] Connected`);
  }

  protected markDisconnected(): void {
    this.connected = false;
    this.stopHeartbeat();
    console.log(`[${this.id}] Disconnected`);
  }

  protected scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;

    console.log(`[${this.id}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.onConnect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  // ─── Heartbeat ──────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.lastSeen = Date.now();
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────

  dispose(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connected) {
      this.onDisconnect().catch(() => {});
    }
  }
}
