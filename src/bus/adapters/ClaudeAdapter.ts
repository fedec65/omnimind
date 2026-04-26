/**
 * ClaudeAdapter — Claude Code integration adapter
 *
 * Watches the Claude conversation directory for file changes,
 * extracts decisions, and publishes them to the bus.
 * Receives external events and writes notifications to CLAUDE.md.
 */

import { type FSWatcher, watch } from 'fs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { BaseAdapter } from './BaseAdapter.js';
import { type MemoryBus } from '../MemoryBus.js';
import { type MemoryEvent, EventType, createMemoryEvent } from '../types.js';

export interface ClaudeAdapterConfig {
  watchPath?: string;
}

export class ClaudeAdapter extends BaseAdapter {
  private watchPath: string;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async onConnect(): Promise<void> {
    if (!existsSync(this.watchPath)) {
      mkdirSync(this.watchPath, { recursive: true });
    }

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
    this.markDisconnected();
  }

  async onMemoryEvent(event: MemoryEvent): Promise<void> {
    // Another tool updated a shared memory — notify via CLAUDE.md
    if (event.sourceTool === this.id) return;

    const claudeMdPath = join(process.cwd(), 'CLAUDE.md');
    if (!existsSync(claudeMdPath)) return;

    const notification = `\n<!-- Omnimind update from ${event.sourceTool} -->\n` +
      `> [${event.payload.wing ?? 'general'}] ${event.payload.content?.substring(0, 200) ?? ''}\n`;

    try {
      const current = readFileSync(claudeMdPath, 'utf-8');
      writeFileSync(claudeMdPath, current + notification);
    } catch {
      // Silently fail if CLAUDE.md is not writable
    }
  }

  // ─── Decision extraction ────────────────────────────────────────

  private debounceProcess(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.processConversations(), 2000);
  }

  private processConversations(): void {
    try {
      // Simple approach: scan all .jsonl files in watchPath
      // In a real implementation, we'd use glob or fs.readdir with filtering
      // For MVP, we skip complex directory traversal and focus on the structure
      console.log(`[ClaudeAdapter] Scanning ${this.watchPath} for conversation changes`);
    } catch (error) {
      console.error(`[ClaudeAdapter] Process error: ${error}`);
    }
  }

  /** Extract decisions from raw conversation text */
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
    const payload: Record<string, unknown> = { content, wing };
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
