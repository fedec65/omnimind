/**
 * ClaudeDesktopAdapter — Claude Desktop (macOS app) integration adapter
 *
 * Watches Claude Desktop's session metadata directory for JSON files
 * and imports session context (title, cwd, project, model) as memories.
 *
 * Claude Desktop stores session metadata at:
 * ~/Library/Application Support/Claude/claude-code-sessions/
 *   {profile}/{workspace}/local_*.json
 *
 * Each JSON file contains:
 * { sessionId, cliSessionId, cwd, originCwd, worktreePath,
 *   worktreeName, createdAt, lastActivityAt, model, isArchived, title }
 *
 * Note: These files contain session metadata only, not conversation turns.
 */

import { type FSWatcher, watch } from 'fs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, relative, basename } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { BaseAdapter } from './BaseAdapter.js';
import { type MemoryBus } from '../MemoryBus.js';
import { type MemoryEvent, EventType, createMemoryEvent } from '../types.js';

export interface ClaudeDesktopAdapterConfig {
  sessionsPath?: string;
  checkpointPath?: string;
  /** Minimum interval (ms) between processing the same file. Default: 30000. */
  minProcessInterval?: number;
  /** Process all existing session files on connect (one-shot bulk import). Default: false. */
  processExistingOnConnect?: boolean;
}

interface SessionMetadata {
  sessionId: string;
  cliSessionId?: string;
  cwd: string;
  originCwd?: string;
  worktreePath?: string;
  worktreeName?: string;
  createdAt: number;
  lastActivityAt: number;
  model?: string;
  isArchived?: boolean;
  title?: string;
}

interface Checkpoint {
  processedHashes: Record<string, number>;
  version: number;
}

export class ClaudeDesktopAdapter extends BaseAdapter {
  private sessionsPath: string;
  private checkpointPath: string;
  private minProcessInterval: number;
  private processExistingOnConnect: boolean;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private processedHashes = new Map<string, number>();
  private isProcessing = false;
  private activePromise: Promise<void> | null = null;
  private disposed = false;

  constructor(bus: MemoryBus, config: ClaudeDesktopAdapterConfig = {}) {
    super(bus, {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      capabilities: ['read', 'sync'],
    });
    this.sessionsPath =
      config.sessionsPath ??
      join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
    this.checkpointPath =
      config.checkpointPath ??
      join(this.sessionsPath, '.omnimind-claude-desktop-checkpoint.json');
    this.minProcessInterval = config.minProcessInterval ?? 30000;
    this.processExistingOnConnect = config.processExistingOnConnect ?? false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async onConnect(): Promise<void> {
    // Graceful no-op on non-macOS platforms unless an explicit path is provided
    if (process.platform !== 'darwin' && !existsSync(this.sessionsPath)) {
      this.markConnected();
      return;
    }

    if (!existsSync(this.sessionsPath)) {
      mkdirSync(this.sessionsPath, { recursive: true });
    }

    this.loadCheckpoint();

    this.watcher = watch(
      this.sessionsPath,
      { recursive: true },
      (_eventType, filename) => {
        if (
          typeof filename === 'string' &&
          basename(filename).startsWith('local_') &&
          filename.endsWith('.json')
        ) {
          this.debounceProcess();
        }
      },
    );

    this.markConnected();

    if (this.processExistingOnConnect) {
      this.processAllSessions().catch((err) => {
        console.error(`[ClaudeDesktopAdapter] Bulk import failed: ${err}`);
      });
    }
  }

  async onDisconnect(): Promise<void> {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.activePromise) {
      await this.activePromise;
      this.activePromise = null;
    }
    this.saveCheckpoint();
    this.markDisconnected();
  }

  async onMemoryEvent(event: MemoryEvent): Promise<void> {
    // Claude Desktop has no writable notification channel
    if (event.sourceTool === this.id) return;
    // Silently accept external events
  }

  // ─── Auto-save pipeline ─────────────────────────────────────────

  private debounceProcess(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.processSessions(), 2000);
  }

  private async processSessions(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const files = this.findSessionFiles(this.sessionsPath);
      let storedCount = 0;
      let skippedCount = 0;

      for (const filePath of files) {
        if (this.disposed) break;
        const result = await this.processFile(filePath);
        if (result === 'stored') storedCount++;
        else if (result === 'skipped') skippedCount++;
      }

      if (storedCount > 0 || skippedCount > 0) {
        console.log(
          `[ClaudeDesktopAdapter] Processed ${files.length} files: ${storedCount} stored, ${skippedCount} skipped`,
        );
      }
    } catch (error) {
      console.error(`[ClaudeDesktopAdapter] Process error: ${error}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /** One-shot bulk import of all existing session files */
  private async processAllSessions(): Promise<void> {
    console.log(`[ClaudeDesktopAdapter] Starting bulk import from ${this.sessionsPath}...`);
    this.activePromise = this.processSessions();
    await this.activePromise;
    this.activePromise = null;
    console.log(`[ClaudeDesktopAdapter] Bulk import complete.`);
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

      const session = this.parseSession(content);
      if (!session) {
        this.processedHashes.set(hash, now);
        return 'skipped';
      }

      const memoryContent = this.formatSessionContent(session);
      const wing = this.inferWing(session, filePath);
      const room = 'claude-desktop';

      const event = createMemoryEvent(
        this.id,
        EventType.Create,
        null,
        {
          content: memoryContent,
          wing,
          room,
          namespace: this.id,
        },
        {},
        'auto',
      );

      await this.publishEvent(event);

      this.processedHashes.set(hash, now);
      this.saveCheckpoint();
      return 'stored';
    } catch (error) {
      console.error(`[ClaudeDesktopAdapter] Failed to process ${filePath}: ${error}`);
      return 'error';
    }
  }

  private parseSession(content: string): SessionMetadata | null {
    try {
      const data = JSON.parse(content) as SessionMetadata;
      if (!data.sessionId || !data.cwd) return null;
      return data;
    } catch {
      return null;
    }
  }

  private formatSessionContent(session: SessionMetadata): string {
    const parts: string[] = [];
    if (session.title) {
      parts.push(`Claude Desktop session: "${session.title}"`);
    } else {
      parts.push(`Claude Desktop session: ${session.sessionId}`);
    }
    parts.push(`Working directory: ${session.cwd}`);
    if (session.model) {
      parts.push(`Model: ${session.model}`);
    }
    if (session.worktreeName) {
      parts.push(`Project: ${session.worktreeName}`);
    }
    return parts.join('\n');
  }

  private inferWing(session: SessionMetadata, filePath: string): string {
    if (session.worktreeName) return session.worktreeName;
    const cwdBasename = session.cwd.split(/[/\\]/).pop();
    if (cwdBasename) return cwdBasename;
    const rel = relative(this.sessionsPath, filePath);
    const firstPart = rel.split(/[/\\]/)[0];
    return firstPart || 'claude-desktop';
  }

  private findSessionFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          results.push(...this.findSessionFiles(fullPath));
        } else if (
          entry.isFile() &&
          entry.name.startsWith('local_') &&
          entry.name.endsWith('.json')
        ) {
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
      console.error(`[ClaudeDesktopAdapter] Failed to save checkpoint: ${error}`);
    }
  }
}
