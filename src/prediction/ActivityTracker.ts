/**
 * ActivityTracker — Automatic context fingerprint builder
 *
 * Watches file changes and bus events to build ContextFingerprint
 * without requiring manual parameter passing.
 *
 * Privacy constraints (AGENTS.md):
 * - Never track file contents — only paths/extensions
 * - Never track external URLs
 * - Never track system processes
 */

import { watch, type FSWatcher, readFileSync } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';
import {
  type ContextFingerprint,
  ok,
  err,
  type Result,
} from '../core/types.js';
import { type MemoryEvent, EventType } from '../bus/types.js';
import { type MemoryBus } from '../bus/MemoryBus.js';
import { type IntentPredictor } from './IntentPredictor.js';

/** Safe file extensions to watch (code and docs only) */
const SAFE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.swift',
  '.md', '.mdx', '.txt', '.json', '.yaml', '.yml',
  '.html', '.css', '.scss', '.sql',
]);

/** Extensions we ignore entirely */
const IGNORED_EXTENSIONS = new Set([
  '.log', '.tmp', '.lock', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.wav', '.zip', '.tar',
  '.gz', '.pdf', '.doc', '.docx',
]);

/** Directories to ignore */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  'out', '.output', '.cache', '.omnimind',
]);

export interface ActivityTrackerConfig {
  /** Directory to watch for file changes (default: process.cwd()) */
  watchDir?: string;
  /** Debounce interval in ms (default: 2000) */
  debounceMs?: number;
  /** Maximum recent tools to track (default: 5) */
  maxRecentTools?: number;
  /** Maximum recent wings to track (default: 3) */
  maxRecentWings?: number;
  /** Maximum recent rooms to track (default: 3) */
  maxRecentRooms?: number;
}

/** Recent activity window */
interface ActivityWindow {
  tools: string[];
  wings: string[];
  rooms: string[];
  files: string[];
}

export class ActivityTracker {
  private readonly predictor: IntentPredictor;
  private readonly bus: MemoryBus;
  private readonly config: Required<ActivityTrackerConfig>;
  private watcher: FSWatcher | null = null;
  private running = false;

  // Sliding window of recent activity
  private window: ActivityWindow = { tools: [], wings: [], rooms: [], files: [] };
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private busUnsubscribe: (() => void) | null = null;

  // Cached git branch
  private cachedGitBranch: string | null = null;
  private gitBranchCacheTime = 0;

  constructor(predictor: IntentPredictor, bus: MemoryBus, config: ActivityTrackerConfig = {}) {
    this.predictor = predictor;
    this.bus = bus;
    this.config = {
      watchDir: config.watchDir ?? process.cwd(),
      debounceMs: config.debounceMs ?? 2000,
      maxRecentTools: config.maxRecentTools ?? 5,
      maxRecentWings: config.maxRecentWings ?? 3,
      maxRecentRooms: config.maxRecentRooms ?? 3,
    };
  }

  /** Start watching file system and bus events */
  start(): Result<void> {
    if (this.running) return ok(undefined);

    try {
      this.running = true;

      // Watch the project directory recursively
      this.watcher = watch(
        this.config.watchDir,
        { recursive: true, persistent: false },
        (eventType, filename) => this.onFileChange(eventType, filename),
      );

      // Subscribe to bus events for access tracking
      this.bus.subscribe('activity-tracker', {
        eventTypes: [EventType.Access, EventType.Create],
      });

      // Monkey-patch bus.publish to intercept events for our tracking
      // (We use a wrapper since there's no direct listener API)
      const originalPublish = this.bus.publish.bind(this.bus);
      const tracker = this;
      this.bus.publish = async function (event: MemoryEvent) {
        tracker.onBusEvent(event);
        return originalPublish(event);
      };

      this.busUnsubscribe = () => {
        this.bus.publish = originalPublish;
      };

      return ok(undefined);
    } catch (error) {
      this.running = false;
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Stop all watchers */
  stop(): void {
    this.running = false;

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.busUnsubscribe) {
      this.busUnsubscribe();
      this.busUnsubscribe = null;
    }

    this.bus.unsubscribe('activity-tracker');
  }

  /**
   * Build a context fingerprint from the current activity window.
   *
   * This is the primary entry point — call this whenever you want
   * to predict what memories the user might need.
   */
  getCurrentFingerprint(): ContextFingerprint {
    const now = new Date();
    const projectPath = this.config.watchDir;

    // Derive file extension from most recent file, if any
    const recentFile = this.window.files[this.window.files.length - 1] ?? '';
    const ext = recentFile ? extname(recentFile).toLowerCase() : '';

    return {
      projectHash: createHash('sha256').update(projectPath).digest('hex').substring(0, 8),
      branchHash: createHash('sha256').update(this.getGitBranch()).digest('hex').substring(0, 8),
      fileExtension: ext.replace('.', ''),
      timeOfDay: now.getHours(),
      dayOfWeek: now.getDay(),
      recentTools: [...this.window.tools],
      recentWings: [...this.window.wings],
      recentRooms: [...this.window.rooms],
    };
  }

  /** Record that a specific memory was accessed in the current context */
  recordMemoryAccess(memoryId: string): void {
    const fingerprint = this.getCurrentFingerprint();
    this.predictor.recordAccess(fingerprint, memoryId);
  }

  /** Get current activity window for debugging */
  getWindow(): Readonly<ActivityWindow> {
    return { ...this.window };
  }

  /** Get tracker stats */
  getStats(): { isRunning: boolean; recentFiles: number; recentTools: number } {
    return {
      isRunning: this.running,
      recentFiles: this.window.files.length,
      recentTools: this.window.tools.length,
    };
  }

  // ─── Private handlers ─────────────────────────────────────────────

  private onFileChange(_eventType: string, filename: string | null): void {
    if (!filename) return;

    // Skip ignored directories
    const parts = filename.split(/[\\/]/);
    for (const part of parts) {
      if (IGNORED_DIRS.has(part)) return;
    }

    // Skip ignored extensions
    const ext = extname(filename).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) return;
    if (!SAFE_EXTENSIONS.has(ext)) return; // Only track safe extensions

    // Debounce — only register the change after debounceMs
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.window.files = this.pushUnique(this.window.files, filename, 10);
    }, this.config.debounceMs);
  }

  private onBusEvent(event: MemoryEvent): void {
    // Track tool usage
    if (event.sourceTool) {
      this.window.tools = this.pushUnique(
        this.window.tools,
        event.sourceTool,
        this.config.maxRecentTools,
      );
    }

    // Track wings and rooms from payload
    if (event.payload.wing) {
      this.window.wings = this.pushUnique(
        this.window.wings,
        event.payload.wing,
        this.config.maxRecentWings,
      );
    }
    if (event.payload.room) {
      this.window.rooms = this.pushUnique(
        this.window.rooms,
        event.payload.room,
        this.config.maxRecentRooms,
      );
    }

    // Record access for prediction learning
    if (event.memoryId && (event.eventType === EventType.Access || event.eventType === EventType.Create)) {
      const fingerprint = this.getCurrentFingerprint();
      this.predictor.recordAccess(fingerprint, event.memoryId);
    }
  }

  private pushUnique(arr: string[], value: string, max: number): string[] {
    const filtered = arr.filter((v) => v !== value);
    filtered.push(value);
    return filtered.slice(-max);
  }

  private getGitBranch(): string {
    // Simple cache — re-check every 60 seconds
    const now = Date.now();
    if (this.cachedGitBranch && now - this.gitBranchCacheTime < 60000) {
      return this.cachedGitBranch;
    }

    try {
      // Try to read .git/HEAD
      const headPath = join(this.config.watchDir, '.git', 'HEAD');
      const head = readFileSync(headPath, 'utf-8').trim();
      const match = head.match(/ref: refs\/heads\/(.*)/);
      this.cachedGitBranch = match?.[1] ?? 'unknown';
    } catch {
      this.cachedGitBranch = 'unknown';
    }

    this.gitBranchCacheTime = now;
    return this.cachedGitBranch;
  }
}
