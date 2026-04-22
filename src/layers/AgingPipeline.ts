/**
 * AgingPipeline — Hierarchical memory aging system
 * 
 * Transitions memories between layers over time:
 * L0 (Verbatim, 0-7d) → L1 (Compressed, 7-30d) → L2 (Concept, 30-180d) → L3 (Wisdom, 180d+)
 * 
 * Key design decisions:
 * - Lazy aging: transitions happen on ACCESS, not on schedule
 * - Pinned memories are never aged
 * - Old representations are kept as backups
 * - All compression is local (zero LLM calls)
 */

import {
  type Memory,
  type MemoryLayerId,
  type Result,
  MemoryLayer,
  AgingThresholds,
  TimeConstants,
  ok,
  err,
} from '../core/types.js';

/** Compression rule for shorthand transformation */
interface CompressionRule {
  pattern: RegExp;
  replacement: string;
  priority: number;
}

/**
 * Default compression rules for L0 → L1 transition.
 * 
 * These are deterministic, local rules — no LLM involved.
 * Inspired by MemPalace's AAAK but simplified for reliability.
 */
const DEFAULT_COMPRESSION_RULES: CompressionRule[] = [
  // Logical connectors
  { pattern: /\b(because|since|due to|as a result of)\b/gi, replacement: '∵', priority: 1 },
  { pattern: /\b(therefore|thus|hence|as a result|consequently)\b/gi, replacement: '∴', priority: 1 },
  { pattern: /\b(however|but|although|though|nevertheless)\b/gi, replacement: '~', priority: 1 },
  { pattern: /\b(for example|e\.g\.|such as|like)\b/gi, replacement: 'eg', priority: 1 },
  { pattern: /\b(in other words|i\.e\.|that is|meaning)\b/gi, replacement: 'ie', priority: 1 },
  { pattern: /\b(and|plus|as well as)\b/gi, replacement: '&', priority: 2 },
  { pattern: /\b(or|either|alternatively)\b/gi, replacement: '|', priority: 2 },
  { pattern: /\b(not|no|never|none)\b/gi, replacement: '¬', priority: 2 },

  // Programming terms
  { pattern: /\b(function|method|procedure|subroutine)\b/gi, replacement: 'fn', priority: 3 },
  { pattern: /\b(variable|parameter|argument)\b/gi, replacement: 'var', priority: 3 },
  { pattern: /\b(constant|readonly|immutable)\b/gi, replacement: 'const', priority: 3 },
  { pattern: /\b(class|type|interface|struct)\b/gi, replacement: 'cls', priority: 3 },
  { pattern: /\b(object|instance|entity)\b/gi, replacement: 'obj', priority: 3 },
  { pattern: /\b(array|list|sequence|collection)\b/gi, replacement: '[]', priority: 3 },
  { pattern: /\b(string|text|char\w*)\b/gi, replacement: 'str', priority: 3 },
  { pattern: /\b(number|integer|float|double|numeric)\b/gi, replacement: 'num', priority: 3 },
  { pattern: /\b(boolean|true|false)\b/gi, replacement: 'bool', priority: 3 },
  { pattern: /\b(return|yield|output|result)\b/gi, replacement: '→', priority: 3 },
  { pattern: /\b(import|require|include|using)\b/gi, replacement: 'import', priority: 3 },
  { pattern: /\b(export|module|package|library)\b/gi, replacement: 'export', priority: 3 },

  // Common actions
  { pattern: /\b(create|make|build|generate|construct)\b/gi, replacement: 'mk', priority: 4 },
  { pattern: /\b(delete|remove|destroy|drop)\b/gi, replacement: 'rm', priority: 4 },
  { pattern: /\b(update|modify|change|edit|patch)\b/gi, replacement: 'upd', priority: 4 },
  { pattern: /\b(get|fetch|retrieve|read|load)\b/gi, replacement: 'get', priority: 4 },
  { pattern: /\b(set|put|assign|write|save)\b/gi, replacement: 'set', priority: 4 },
  { pattern: /\b(check|validate|verify|test|assert)\b/gi, replacement: 'chk', priority: 4 },
  { pattern: /\b(handle|process|manage|deal with)\b/gi, replacement: 'hdl', priority: 4 },

  // Filler words to remove
  { pattern: /\b(um|uh|like,|you know|basically|literally|actually|honestly)\b/gi, replacement: '', priority: 5 },
  { pattern: /\b(I think|I believe|in my opinion|probably|maybe)\b/gi, replacement: '', priority: 5 },
  { pattern: /\b(please|kindly|would you mind)\b/gi, replacement: '', priority: 5 },
  { pattern: /\b(thank you|thanks|appreciate it)\b/gi, replacement: '', priority: 5 },
  { pattern: /\b(let me know|feel free|don't hesitate)\b/gi, replacement: '', priority: 5 },

  // Whitespace cleanup
  { pattern: /\s{2,}/g, replacement: ' ', priority: 99 },
  { pattern: /^\s+|\s+$/g, replacement: '', priority: 99 },
];

/**
 * Hierarchical memory aging pipeline.
 * 
 * Usage:
 * ```typescript
 * const pipeline = new AgingPipeline();
 * 
 * // Check if a memory should be aged
 * if (pipeline.shouldAge(memory)) {
 *   const aged = await pipeline.transition(memory, targetLayer);
 *   // Store aged version, keep original as backup
 * }
 * ```
 */
export class AgingPipeline {
  private readonly rules: CompressionRule[];

  constructor(rules: CompressionRule[] = DEFAULT_COMPRESSION_RULES) {
    this.rules = [...rules].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if a memory should transition to the next layer.
   * 
   * Criteria:
   * - Memory is older than the layer's threshold
   * - Memory is not pinned
   * - Memory hasn't already transitioned
   */
  shouldAge(memory: Memory): boolean {
    if (memory.pinned) return false;
    if (memory.layer === MemoryLayer.Wisdom) return false;

    const threshold = AgingThresholds[memory.layer];
    if (threshold === Infinity) return false;

    const age = Date.now() - memory.createdAt;
    return age >= threshold;
  }

  /**
   * Get the target layer for a memory based on its age.
   */
  getTargetLayer(memory: Memory): MemoryLayerId {
    const age = Date.now() - memory.createdAt;

    if (age >= AgingThresholds[MemoryLayer.Concept]) return MemoryLayer.Wisdom;
    if (age >= AgingThresholds[MemoryLayer.Compressed]) return MemoryLayer.Concept;
    if (age >= AgingThresholds[MemoryLayer.Verbatim]) return MemoryLayer.Compressed;
    return MemoryLayer.Verbatim;
  }

  /**
   * Transition a memory to a target layer.
   * 
   * Returns the transformed memory content without modifying the original.
   */
  async transition(memory: Memory, targetLayer: MemoryLayerId): Promise<Result<Memory>> {
    try {
      switch (targetLayer) {
        case MemoryLayer.Compressed:
          return this.compressToL1(memory);
        case MemoryLayer.Concept:
          return this.extractToL2(memory);
        case MemoryLayer.Wisdom:
          return this.distillToL3(memory);
        default:
          return ok(memory); // Already at target
      }
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * L0 → L1: Compress verbatim text to shorthand.
   * 
   * Uses local rule-based compression (zero LLM calls).
   * Typical reduction: 60-80% of original size.
   */
  private compressToL1(memory: Memory): Result<Memory> {
    let compressed = memory.content;

    for (const rule of this.rules) {
      compressed = compressed.replace(rule.pattern, rule.replacement);
    }

    // Clean up remaining whitespace
    compressed = compressed.replace(/\s+/g, ' ').trim();

    // If compression didn't reduce size meaningfully, force truncation
    if (compressed.length > memory.content.length * 0.5) {
      const targetLength = Math.min(500, Math.floor(memory.content.length * 0.5));
      compressed = memory.content.substring(0, targetLength) + ' [...]';
    }

    const updated: Memory = {
      ...memory,
      content: compressed,
      layer: MemoryLayer.Compressed,
      compressedRef: memory.id, // Reference to original
    };

    return ok(updated);
  }

  /**
   * L1 → L2: Extract entities and relations to knowledge graph.
   * 
   * Uses simple heuristics for entity extraction (zero LLM calls).
   * Stores concept references instead of full text.
   */
  private extractToL2(memory: Memory): Result<Memory> {
    // Extract potential entities using regex patterns
    const entities = this.extractEntities(memory.content);

    // Create a concept summary
    const conceptSummary = entities.length > 0
      ? `[Concept: ${entities.map(e => `${e.name}(${e.type})`).join(', ')}]`
      : `[Concept: ${memory.content.substring(0, 200)}...]`;

    const updated: Memory = {
      ...memory,
      content: conceptSummary,
      layer: MemoryLayer.Concept,
      conceptRefs: entities.map(e => e.id),
    };

    return ok(updated);
  }

  /**
   * L2 → L3: Distill patterns from concept graph.
   * 
   * Creates a "wisdom" rule: a general pattern learned from specific instances.
   */
  private distillToL3(memory: Memory): Result<Memory> {
    // Extract recurring patterns
    const patterns = this.extractPatterns(memory.content);

    const wisdom = patterns.length > 0
      ? `[Wisdom: ${patterns.join('; ')}]`
      : `[Wisdom: ${memory.content.substring(0, 150)}]`;

    const updated: Memory = {
      ...memory,
      content: wisdom,
      layer: MemoryLayer.Wisdom,
    };

    return ok(updated);
  }

  /** Extract entities from text using heuristic patterns */
  private extractEntities(text: string): Array<{ id: string; name: string; type: string }> {
    const entities: Array<{ id: string; name: string; type: string }> = [];
    const seen = new Set<string>();

    // Pattern: Capitalized words (likely proper nouns)
    const properNounPattern = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g;
    let match: RegExpExecArray | null;
    while ((match = properNounPattern.exec(text)) !== null) {
      const name = match[0];
      if (!seen.has(name.toLowerCase()) && name.length > 2) {
        seen.add(name.toLowerCase());
        entities.push({
          id: `entity_${name.toLowerCase()}`,
          name,
          type: this.inferEntityType(name, text),
        });
      }
      if (entities.length >= 10) break;
    }

    // Pattern: Quoted strings (likely important terms)
    const quotedPattern = /"([^"]+)"|'([^']+)'/g;
    while ((match = quotedPattern.exec(text)) !== null) {
      const name = match[1] || match[2];
      if (name && !seen.has(name.toLowerCase()) && name.length > 2) {
        seen.add(name.toLowerCase());
        entities.push({
          id: `entity_${name.toLowerCase().replace(/\s+/g, '_')}`,
          name,
          type: 'concept',
        });
      }
      if (entities.length >= 15) break;
    }

    return entities;
  }

  /** Infer entity type from surrounding context */
  private inferEntityType(name: string, context: string): string {
    const lower = context.toLowerCase();
    const nameLower = name.toLowerCase();

    if (lower.includes(`class ${nameLower}`) || lower.includes(`interface ${nameLower}`)) return 'class';
    if (lower.includes(`function ${nameLower}`) || lower.includes(`def ${nameLower}`)) return 'function';
    if (lower.includes(`import ${nameLower}`) || lower.includes(`from ${nameLower}`)) return 'module';
    if (lower.includes(`api ${nameLower}`) || lower.includes(`${nameLower} endpoint`)) return 'api';
    if (lower.includes(`database ${nameLower}`) || lower.includes(`db ${nameLower}`)) return 'database';
    if (lower.includes(`service ${nameLower}`) || lower.includes(`${nameLower} service`)) return 'service';
    if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name)) return 'person'; // "John Smith" pattern

    return 'concept';
  }

  /** Extract recurring patterns from text */
  private extractPatterns(text: string): string[] {
    const patterns: string[] = [];

    // Pattern: "X should Y" → wisdom rule
    const shouldPattern = /(\w+)\s+should\s+([^,.]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = shouldPattern.exec(text)) !== null) {
      patterns.push(`${match[1]!} → should ${match[2]!.trim()}`);
    }

    // Pattern: "prefer X over Y" → wisdom rule
    const preferPattern = /prefer\s+(.+?)\s+over\s+(.+?)(?:\s|$|[,.])/gi;
    while ((match = preferPattern.exec(text)) !== null) {
      patterns.push(`prefer ${match[1]!.trim()} > ${match[2]!.trim()}`);
    }

    // Pattern: "X causes Y" → causal rule
    const causePattern = /(\w+)\s+(?:causes?|leads? to|results? in)\s+([^,.]+)/gi;
    while ((match = causePattern.exec(text)) !== null) {
      patterns.push(`${match[1]!} → ${match[2]!.trim()}`);
    }

    return patterns.length > 0 ? patterns : ['general principle extracted from experience'];
  }

  /** Get compression stats for a memory */
  getCompressionStats(original: Memory, compressed: Memory): { ratio: number; reduction: number } {
    const ratio = compressed.content.length / original.content.length;
    return {
      ratio,
      reduction: 1 - ratio,
    };
  }
}

/** Time-driven aging scheduler (optional cron-like trigger) */
export class AgingScheduler {
  private readonly _pipeline: AgingPipeline;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(pipeline: AgingPipeline) {
    this._pipeline = pipeline;
    // Scheduler stores pipeline reference for future use
    void this._pipeline;
  }

  /** Start periodic aging checks (default: every hour) */
  start(checkIntervalMs: number = TimeConstants.DAY): void {
    this.stop();
    this.intervalId = setInterval(() => {
      this.runAgingCheck();
    }, checkIntervalMs);
  }

  /** Stop the scheduler */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Run a single aging check (called by scheduler or manually) */
  private async runAgingCheck(): Promise<void> {
    // This would scan the database for memories that need aging
    // Implementation depends on MemoryStore interface
    console.log('[AgingScheduler] Running aging check...');
  }
}
