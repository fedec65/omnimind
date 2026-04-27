/**
 * ClaudeAdapter — Claude Code integration adapter
 *
 * Watches the Claude conversation directory for file changes,
 * auto-saves conversation turns to the memory store,
 * extracts decisions, and publishes them to the bus.
 * Receives external events and writes notifications to CLAUDE.md.
 */

import { type FSWatcher, watch } from 'fs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { BaseAdapter } from './BaseAdapter.js';
import { type MemoryBus } from '../MemoryBus.js';
import { type MemoryEvent, EventType, createMemoryEvent } from '../types.js';

export interface ClaudeAdapterConfig {
  watchPath?: string;
  checkpointPath?: string;
  /** Minimum interval (ms) between processing the same file. Default: 30000. */
  minProcessInterval?: number;
  /** Process all existing .jsonl files on connect (one-shot bulk import). Default: false. */
  processExistingOnConnect?: boolean;
}

interface ConversationEntry {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  type?: string; // e.g. 'user', 'assistant', 'progress'
  message?: {
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

interface Checkpoint {
  processedHashes: Record<string, number>; // hash -> timestamp
  version: number;
}

export class ClaudeAdapter extends BaseAdapter {
  private watchPath: string;
  private checkpointPath: string;
  private minProcessInterval: number;
  private processExistingOnConnect: boolean;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private processedHashes = new Map<string, number>();
  private isProcessing = false;

  private readonly decisionPatterns = [
    /(?:we decided|let's use|we'll use|going with|chosen|selected)\s+(.{10,200})/gi,
    /(?:i prefer|let's go with|best option is|approach will be)\s+(.{10,200})/gi,
    /(?:agreed|consensus|decided|conclusion)\s*:\s*(.{10,300})/gi,
  ];

  constructor(bus: MemoryBus, config: ClaudeAdapterConfig = {}) {
    super(bus, {
      id: 'claude-code',
      name: 'Claude Code',
      capabilities: ['read', 'write', 'sync', 'notify'],
    });
    this.watchPath = config.watchPath ?? join(homedir(), '.claude', 'projects');
    this.checkpointPath = config.checkpointPath ?? join(this.watchPath, '.omnimind-claude-checkpoint.json');
    this.minProcessInterval = config.minProcessInterval ?? 30000;
    this.processExistingOnConnect = config.processExistingOnConnect ?? false;
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
        if (typeof filename === 'string' && filename.endsWith('.jsonl')) {
          this.debounceProcess();
        }
      },
    );

    this.markConnected();

    // Bulk import existing files on first connect
    if (this.processExistingOnConnect) {
      this.processAllFiles().catch((err) => {
        console.error(`[ClaudeAdapter] Bulk import failed: ${err}`);
      });
    }
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
    // Another tool updated a shared memory — notify via CLAUDE.md
    if (event.sourceTool === this.id) return;

    const claudeMdPath = join(process.cwd(), 'CLAUDE.md');
    if (!existsSync(claudeMdPath)) return;

    const notification = '\n<!-- Omnimind update from ' + event.sourceTool + ' -->\n' +
      '> [' + (event.payload.wing ?? 'general') + '] ' + (event.payload.content?.substring(0, 200) ?? '') + '\n';

    try {
      const current = readFileSync(claudeMdPath, 'utf-8');
      writeFileSync(claudeMdPath, current + notification);
    } catch {
      // Silently fail if CLAUDE.md is not writable
    }
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
      const files = this.findJsonlFiles(this.watchPath);
      let storedCount = 0;
      let skippedCount = 0;

      for (const filePath of files) {
        const result = await this.processFile(filePath);
        if (result === 'stored') storedCount++;
        else if (result === 'skipped') skippedCount++;
      }

      if (storedCount > 0 || skippedCount > 0) {
        console.log(
          `[ClaudeAdapter] Processed ${files.length} files: ${storedCount} stored, ${skippedCount} skipped`,
        );
      }
    } catch (error) {
      console.error(`[ClaudeAdapter] Process error: ${error}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /** One-shot bulk import of all existing .jsonl files */
  private async processAllFiles(): Promise<void> {
    console.log(`[ClaudeAdapter] Starting bulk import from ${this.watchPath}...`);
    await this.processConversations();
    console.log(`[ClaudeAdapter] Bulk import complete.`);
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

      const turns = this.parseTurns(content);
      if (turns.length === 0) {
        this.processedHashes.set(hash, now);
        return 'skipped';
      }

      // Derive wing/room from relative path
      const relPath = relative(this.watchPath, filePath);
      const pathParts = relPath.split(/[/\\]/);
      const wing = pathParts.length > 1 ? pathParts[0]! : 'claude-conversations';
      const room = pathParts.length > 2 ? pathParts[pathParts.length - 2]! : 'default';

      const result = await this.bus.storeTurns(turns, {
        wing,
        room,
        sourceTool: this.id,
        namespace: this.id,
      });

      if (!result.ok) {
        console.error(`[ClaudeAdapter] Failed to store turns from ${relPath}: ${result.error.message}`);
        return 'error';
      }

      // Also extract and publish decisions from the full text
      const decisions = this.extractDecisions(content);
      for (const decision of decisions) {
        await this.publishDecision(decision.text, wing, room);
      }

      this.processedHashes.set(hash, now);
      this.saveCheckpoint();
      return 'stored';
    } catch (error) {
      console.error(`[ClaudeAdapter] Failed to process ${filePath}: ${error}`);
      return 'error';
    }
  }

  private parseTurns(content: string): string[] {
    const turns: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as ConversationEntry;

        // Claude Code native format: { type, message: { role, content } }
        const role = entry.message?.role ?? entry.role ?? this.inferRoleFromType(entry.type);
        const rawContent = entry.message?.content ?? entry.content;

        if (!role || !rawContent) continue;

        const text = this.extractContentText(rawContent);
        if (!text) continue;

        // Skip non-dialogue entries (progress, tool_use, etc.)
        const entryType = entry.type?.toLowerCase() ?? '';
        if (entryType === 'progress') continue;

        // Skip system/tool messages — only store user/assistant dialogue
        const normalizedRole = role.toLowerCase();
        if (normalizedRole !== 'user' && normalizedRole !== 'assistant') continue;

        turns.push(`${role}: ${text}`);
      } catch {
        // Malformed JSON line — skip
      }
    }

    return turns;
  }

  private extractContentText(raw: string | Array<{ type?: string; text?: string }>): string | null {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      return raw
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('');
    }
    return null;
  }

  private inferRoleFromType(type?: string): string | undefined {
    if (!type) return undefined;
    const t = type.toLowerCase();
    if (t === 'user' || t.includes('user')) return 'user';
    if (t === 'assistant' || t.includes('assistant')) return 'assistant';
    return undefined;
  }

  private findJsonlFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip hidden directories and checkpoint file
          if (entry.name.startsWith('.')) continue;
          results.push(...this.findJsonlFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory not readable — skip
    }
    return results;
  }

  // ─── Checkpoint / deduplication ─────────────────────────────────

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
      // Corrupt checkpoint — start fresh
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
      console.error(`[ClaudeAdapter] Failed to save checkpoint: ${error}`);
    }
  }

  // ─── Decision extraction ────────────────────────────────────────

  extractDecisions(text: string): Array<{ text: string; confidence: number }> {
    const decisions: Array<{ text: string; confidence: number }> = [];

    for (const pattern of this.decisionPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const decisionText = match[1]?.trim();
        if (decisionText && decisionText.length >= 10) {
          decisions.push({ text: decisionText, confidence: 0.8 });
        }
      }
    }

    return decisions;
  }

  /** Publish a decision as a MemoryEvent */
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
