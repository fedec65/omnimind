/**
 * ChatGPTAdapter — ChatGPT conversation import adapter
 *
 * Watches a directory for ChatGPT JSON export files (official OpenAI
 * export format) and imports them as conversation turns into the memory
 * store.
 *
 * Export format supported:
 * {
 *   "conversations": [
 *     {
 *       "title": "...",
 *       "create_time": 1234567890.0,
 *       "mapping": {
 *         "uuid-1": {
 *           "message": {
 *             "author": { "role": "user" },
 *             "content": { "parts": ["Hello"] }
 *           },
 *           "parent": "uuid-0",
 *           "children": ["uuid-2"]
 *         }
 *       }
 *     }
 *   ]
 * }
 */

import { type FSWatcher, watch } from 'fs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { BaseAdapter } from './BaseAdapter.js';
import { type MemoryBus } from '../MemoryBus.js';
import { type MemoryEvent, EventType, createMemoryEvent } from '../types.js';

export interface ChatGPTAdapterConfig {
  watchPath?: string;
  checkpointPath?: string;
  minProcessInterval?: number;
}

interface ChatGPTMessage {
  id?: string;
  author?: { role?: string };
  content?: { parts?: unknown[]; content_type?: string };
  create_time?: number;
}

interface ChatGPTNode {
  message?: ChatGPTMessage | null;
  parent?: string | null;
  children?: string[];
}

interface ChatGPTConversation {
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, ChatGPTNode>;
}

interface ChatGPTExport {
  conversations?: ChatGPTConversation[];
}

interface Checkpoint {
  processedHashes: Record<string, number>;
  version: number;
}

export class ChatGPTAdapter extends BaseAdapter {
  private watchPath: string;
  private checkpointPath: string;
  private minProcessInterval: number;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private processedHashes = new Map<string, number>();
  private isProcessing = false;

  constructor(bus: MemoryBus, config: ChatGPTAdapterConfig = {}) {
    super(bus, {
      id: 'chatgpt',
      name: 'ChatGPT',
      capabilities: ['read', 'sync', 'notify'],
    });
    this.watchPath = config.watchPath ?? join(homedir(), '.chatgpt', 'exports');
    this.checkpointPath = config.checkpointPath ?? join(this.watchPath, '.omnimind-chatgpt-checkpoint.json');
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
        if (typeof filename === 'string' && filename.endsWith('.json')) {
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
    // ChatGPT has no native local notification mechanism
    if (event.sourceTool === this.id) return;
  }

  // ─── Import pipeline ────────────────────────────────────────────

  private debounceProcess(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.processExports(), 2000);
  }

  private async processExports(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const files = this.findJsonFiles(this.watchPath);
      let storedConversations = 0;
      let skippedCount = 0;

      for (const filePath of files) {
        const result = await this.processFile(filePath);
        if (result === 'stored') storedConversations++;
        else if (result === 'skipped') skippedCount++;
      }

      if (storedConversations > 0 || skippedCount > 0) {
        console.log(
          `[ChatGPTAdapter] Processed ${files.length} files: ${storedConversations} conversations stored, ${skippedCount} skipped`,
        );
      }
    } catch (error) {
      console.error(`[ChatGPTAdapter] Process error: ${error}`);
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

      const exportData = JSON.parse(content) as ChatGPTExport;
      const conversations = exportData.conversations ?? [];
      if (conversations.length === 0) {
        this.processedHashes.set(hash, now);
        return 'skipped';
      }

      // Derive wing from relative path or filename
      const relPath = relative(this.watchPath, filePath);
      const pathParts = relPath.split(/[/\\]/);
      const wing = pathParts.length > 1 ? pathParts[0]! : 'chatgpt-imports';

      let totalTurns = 0;
      for (const conversation of conversations) {
        const turns = this.extractTurns(conversation);
        if (turns.length === 0) continue;

        const room = conversation.title || 'default';
        const result = await this.bus.storeTurns(turns, {
          wing,
          room,
          sourceTool: this.id,
          namespace: this.id,
        });

        if (!result.ok) {
          console.error(`[ChatGPTAdapter] Failed to store conversation "${room}": ${result.error.message}`);
          continue;
        }
        totalTurns += turns.length;
      }

      if (totalTurns === 0) {
        this.processedHashes.set(hash, now);
        return 'skipped';
      }

      this.processedHashes.set(hash, now);
      this.saveCheckpoint();
      return 'stored';
    } catch (error) {
      console.error(`[ChatGPTAdapter] Failed to process ${filePath}: ${error}`);
      return 'error';
    }
  }

  private extractTurns(conversation: ChatGPTConversation): string[] {
    const mapping = conversation.mapping;
    if (!mapping) return [];

    // Build adjacency list and find root nodes
    const roots: string[] = [];
    for (const [id, node] of Object.entries(mapping)) {
      if (!node.parent) {
        roots.push(id);
      }
    }

    const turns: string[] = [];

    // BFS from each root to get chronological order
    for (const rootId of roots) {
      const queue: string[] = [rootId];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);

        const node = mapping[id];
        if (!node) continue;

        const message = node.message;
        if (message && message.author && message.content) {
          const role = message.author.role?.toLowerCase();
          const text = this.extractText(message.content);
          if (text && (role === 'user' || role === 'assistant')) {
            turns.push(`${message.author.role}: ${text}`);
          }
        }

        if (node.children) {
          for (const childId of node.children) {
            if (!visited.has(childId)) {
              queue.push(childId);
            }
          }
        }
      }
    }

    return turns;
  }

  private extractText(content: ChatGPTMessage['content']): string | null {
    if (!content) return null;
    if (Array.isArray(content.parts)) {
      return content.parts.filter((p): p is string => typeof p === 'string').join('');
    }
    if (typeof content === 'string') {
      return content;
    }
    return null;
  }

  private findJsonFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          results.push(...this.findJsonFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          results.push(fullPath);
        }
      }
    } catch {
      // skip unreadable
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
      console.error(`[ChatGPTAdapter] Failed to save checkpoint: ${error}`);
    }
  }

  /** Publish a decision extracted from imported text */
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
