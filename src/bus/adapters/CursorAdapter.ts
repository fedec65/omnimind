/**
 * CursorAdapter — Cursor IDE integration adapter
 *
 * Watches a configurable directory for Cursor conversation exports
 * and auto-saves them to the memory store.
 *
 * Supports two formats:
 * 1. `.jsonl` — line-delimited JSON with { role, content } objects
 * 2. `.json` — array of { role, content } messages
 *
 * Cursor does not expose a native local conversation format, so users
 * should configure this adapter to watch a directory where they (or a
 * companion extension) save conversation exports.
 */

import { type FSWatcher, watch } from 'fs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, relative, extname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { BaseAdapter } from './BaseAdapter.js';
import { type MemoryBus } from '../MemoryBus.js';
import { type MemoryEvent, EventType, createMemoryEvent } from '../types.js';

export interface CursorAdapterConfig {
  watchPath?: string;
  checkpointPath?: string;
  minProcessInterval?: number;
}

interface MessageEntry {
  role?: string;
  content?: string;
}

interface Checkpoint {
  processedHashes: Record<string, number>;
  version: number;
}

export class CursorAdapter extends BaseAdapter {
  private watchPath: string;
  private checkpointPath: string;
  private minProcessInterval: number;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private processedHashes = new Map<string, number>();
  private isProcessing = false;

  constructor(bus: MemoryBus, config: CursorAdapterConfig = {}) {
    super(bus, {
      id: 'cursor',
      name: 'Cursor',
      capabilities: ['read', 'write', 'sync', 'notify'],
    });
    this.watchPath = config.watchPath ?? join(homedir(), '.cursor', 'conversations');
    this.checkpointPath = config.checkpointPath ?? join(this.watchPath, '.omnimind-cursor-checkpoint.json');
    this.minProcessInterval = config.minProcessInterval ?? 30000;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async onConnect(): Promise<void> {
    if (!existsSync(this.watchPath)) {
      mkdirSync(this.watchPath, { recursive: true });
    }

    this.loadCheckpoint();

    this.watcher = watch(
      this.watchPath,
      { recursive: true },
      (_eventType, filename) => {
        if (typeof filename === 'string' && (filename.endsWith('.jsonl') || filename.endsWith('.json'))) {
          this.debounceProcess();
        }
      },
    );

    this.markConnected();
  }

  async onDisconnect(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.saveCheckpoint();
    this.markDisconnected();
  }

  async onMemoryEvent(event: MemoryEvent): Promise<void> {
    // Receive external memory updates — could write to a Cursor-accessible file
    if (event.sourceTool === this.id) return;

    // Cursor doesn't have a standard notification mechanism like CLAUDE.md,
    // so we silently accept the event. A companion extension could poll
    // the Omnimind API to receive these.
  }

  // ─── Auto-save pipeline ─────────────────────────────────────────

  private debounceProcess(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.processConversations(), 2000);
  }

  private async processConversations(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const files = this.findSupportedFiles(this.watchPath);
      let storedCount = 0;
      let skippedCount = 0;

      for (const filePath of files) {
        const result = await this.processFile(filePath);
        if (result === 'stored') storedCount++;
        else if (result === 'skipped') skippedCount++;
      }

      if (storedCount > 0 || skippedCount > 0) {
        console.log(
          `[CursorAdapter] Processed ${files.length} files: ${storedCount} stored, ${skippedCount} skipped`,
        );
      }
    } catch (error) {
      console.error(`[CursorAdapter] Process error: ${error}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processFile(filePath: string): Promise<'stored' | 'skipped' | 'error'> {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      const lastProcessed = this.processedHashes.get(hash);
      const now = Date.now();

      if (lastProcessed && now - lastProcessed < this.minProcessInterval) {
        return 'skipped';
      }

      const ext = extname(filePath);
      const turns = ext === '.jsonl' ? this.parseJsonl(content) : this.parseJson(content);

      if (turns.length === 0) {
        this.processedHashes.set(hash, now);
        return 'skipped';
      }

      // Derive wing/room from relative path
      const relPath = relative(this.watchPath, filePath);
      const pathParts = relPath.split(/[/\\]/);
      const wing = pathParts.length > 1 ? pathParts[0]! : 'cursor-conversations';
      const room = pathParts.length > 2 ? pathParts[pathParts.length - 2]! : 'default';

      const result = await this.bus.storeTurns(turns, {
        wing,
        room,
        sourceTool: this.id,
        namespace: this.id,
      });

      if (!result.ok) {
        console.error(`[CursorAdapter] Failed to store turns from ${relPath}: ${result.error.message}`);
        return 'error';
      }

      this.processedHashes.set(hash, now);
      this.saveCheckpoint();
      return 'stored';
    } catch (error) {
      console.error(`[CursorAdapter] Failed to process ${filePath}: ${error}`);
      return 'error';
    }
  }

  private parseJsonl(content: string): string[] {
    const turns: string[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as MessageEntry;
        if (entry.role && entry.content) {
          const role = entry.role.toLowerCase();
          if (role === 'user' || role === 'assistant') {
            turns.push(`${entry.role}: ${entry.content}`);
          }
        }
      } catch {
        // skip malformed line
      }
    }
    return turns;
  }

  private parseJson(content: string): string[] {
    try {
      const data = JSON.parse(content) as unknown;
      if (!Array.isArray(data)) return [];
      const turns: string[] = [];
      for (const entry of data) {
        if (entry && typeof entry === 'object' && 'role' in entry && 'content' in entry) {
          const role = String((entry as MessageEntry).role).toLowerCase();
          if (role === 'user' || role === 'assistant') {
            turns.push(`${(entry as MessageEntry).role}: ${(entry as MessageEntry).content}`);
          }
        }
      }
      return turns;
    } catch {
      return [];
    }
  }

  private findSupportedFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          results.push(...this.findSupportedFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json'))) {
          results.push(fullPath);
        }
      }
    } catch {
      // skip unreadable directories
    }
    return results;
  }

  // ─── Checkpoint ─────────────────────────────────────────────────

  private loadCheckpoint(): void {
    try {
      if (!existsSync(this.checkpointPath)) return;
      const raw = readFileSync(this.checkpointPath, 'utf-8');
      const checkpoint = JSON.parse(raw) as Checkpoint;
      if (checkpoint.processedHashes) {
        for (const [hash, ts] of Object.entries(checkpoint.processedHashes)) {
          this.processedHashes.set(hash, ts);
        }
      }
    } catch {
      this.processedHashes.clear();
    }
  }

  private saveCheckpoint(): void {
    try {
      const checkpoint: Checkpoint = {
        processedHashes: Object.fromEntries(this.processedHashes),
        version: 1,
      };
      writeFileSync(this.checkpointPath, JSON.stringify(checkpoint, null, 2));
    } catch (error) {
      console.error(`[CursorAdapter] Failed to save checkpoint: ${error}`);
    }
  }

  /** Publish a single extracted decision as a MemoryEvent */
  async publishDecision(content: string, wing: string, room?: string): Promise<void> {
    const payload: Record<string, unknown> = { content, wing, namespace: this.id };
    if (room !== undefined) payload.room = room;
    const event = createMemoryEvent(
      this.id,
      EventType.Create,
      null,
      payload as MemoryEvent['payload'],
      {},
      'auto',
    );
    await this.publishEvent(event);
  }
}
