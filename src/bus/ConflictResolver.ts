/**
 * ConflictResolver — Temporal conflict resolution for cross-tool memory events
 *
 * Strategy: Temporal Validity with Tool Priority
 *
 * When two tools report conflicting facts:
 * 1. If timestamps differ: later wins, earlier gets valid_to set
 * 2. If concurrent (vector clock): use tool priority as tiebreaker
 * 3. Always preserve both facts with validity windows
 */

import {
  type MemoryEvent,
  type ConflictResolution,
  ToolPriority,
  PriorityOrder,
} from './types.js';
import { type Result, ok, err } from '../core/types.js';

/** Vector clock comparison result */
type ClockComparison = 'before' | 'after' | 'concurrent' | 'equal';

export class ConflictResolver {
  private conflictsResolved = 0;

  /**
   * Check if two events conflict and resolve them.
   *
   * Returns `null` if there is no conflict (different memories, both acceptable).
   */
  resolve(eventA: MemoryEvent, eventB: MemoryEvent): Result<ConflictResolution | null> {
    try {
      // Different memories = no conflict
      if (eventA.memoryId !== eventB.memoryId) {
        return ok(null);
      }

      // Same event = no conflict
      if (eventA.id === eventB.id) {
        return ok(null);
      }

      const comparison = this.compareVectorClocks(eventA.vectorClock, eventB.vectorClock);

      // Case 1: One is clearly before the other (causal ordering)
      if (comparison === 'before') {
        return ok(this.supersede(eventB, eventA, 'Later event supersedes earlier'));
      }
      if (comparison === 'after') {
        return ok(this.supersede(eventA, eventB, 'Later event supersedes earlier'));
      }

      // Case 2: Different temporal validity windows = both valid (evolution)
      const validFromA = eventA.payload.validFrom ?? eventA.timestamp;
      const validFromB = eventB.payload.validFrom ?? eventB.timestamp;
      if (Math.abs(validFromA - validFromB) > 1000) {
        return ok(this.mergeTemporal(eventA, eventB));
      }

      // Case 3: Concurrent events — tool priority tiebreaker
      if (comparison === 'concurrent') {
        return ok(this.resolveByPriority(eventA, eventB));
      }

      // Case 4: Equal clocks (same tool, same generation) — check priority, then timestamp
      if (comparison === 'equal') {
        const priorityA = this.getEffectivePriority(eventA);
        const priorityB = this.getEffectivePriority(eventB);
        if (priorityA !== priorityB) {
          const winner = priorityA > priorityB ? eventA : eventB;
          const loser = priorityA > priorityB ? eventB : eventA;
          return ok(this.supersede(winner, loser, `Priority tiebreaker: ${winner.sourceTool} > ${loser.sourceTool}`));
        }
        const winner = eventA.timestamp >= eventB.timestamp ? eventA : eventB;
        const loser = eventA.timestamp >= eventB.timestamp ? eventB : eventA;
        return ok(this.supersede(winner, loser, 'Same origin — later timestamp wins'));
      }

      return ok(null);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Number of conflicts resolved since instantiation */
  getStats(): { conflictsResolved: number } {
    return { conflictsResolved: this.conflictsResolved };
  }

  // ─── Private resolution helpers ─────────────────────────────────

  private supersede(
    winner: MemoryEvent,
    loser: MemoryEvent,
    explanation: string,
  ): ConflictResolution {
    this.conflictsResolved++;
    return {
      resolution: 'accepted',
      winningEvent: winner,
      losingEvent: loser,
      action: 'supersede',
      explanation,
    };
  }

  private mergeTemporal(eventA: MemoryEvent, eventB: MemoryEvent): ConflictResolution {
    this.conflictsResolved++;
    // The later-valid event wins; earlier is preserved with validTo
    const winner =
      (eventA.payload.validFrom ?? eventA.timestamp) >=
      (eventB.payload.validFrom ?? eventB.timestamp)
        ? eventA
        : eventB;
    const loser = winner === eventA ? eventB : eventA;

    return {
      resolution: 'merged',
      winningEvent: winner,
      losingEvent: loser,
      action: 'supersede',
      explanation: 'Temporal evolution — different validity periods',
    };
  }

  private resolveByPriority(eventA: MemoryEvent, eventB: MemoryEvent): ConflictResolution {
    this.conflictsResolved++;

    // User edits always win over auto-extracted
    const priorityA = this.getEffectivePriority(eventA);
    const priorityB = this.getEffectivePriority(eventB);

    if (priorityA !== priorityB) {
      const winner = priorityA > priorityB ? eventA : eventB;
      const loser = winner === eventA ? eventB : eventA;
      return {
        resolution: 'accepted',
        winningEvent: winner,
        losingEvent: loser,
        action: 'replace',
        explanation: `Tool priority: ${winner.sourceTool} (${priorityA > priorityB ? priorityA : priorityB}) > ${loser.sourceTool} (${priorityA > priorityB ? priorityB : priorityA})`,
      };
    }

    // Same priority = flag for manual review
    return {
      resolution: 'manual_review',
      winningEvent: eventA,
      losingEvent: eventB,
      action: 'branch',
      explanation: `Equal priority (${priorityA}) — concurrent edit from ${eventA.sourceTool} and ${eventB.sourceTool} requires manual review`,
    };
  }

  /** Effective priority combines tool priority and event priority */
  private getEffectivePriority(event: MemoryEvent): number {
    const toolPrio = ToolPriority[event.sourceTool] ?? ToolPriority.generic ?? 10;
    const eventPrio = PriorityOrder[event.priority] ?? 0;
    return toolPrio + eventPrio;
  }

  // ─── Vector clock comparison ────────────────────────────────────

  /**
   * Compare two vector clocks.
   *
   * - `before`  : A happened before B (A's clock ≤ B's clock, at least one <)
   * - `after`   : A happened after B (A's clock ≥ B's clock, at least one >)
   * - `equal`   : Same clock values
   * - `concurrent`: Neither dominates (incomparable)
   */
  private compareVectorClocks(
    clockA: Record<string, number>,
    clockB: Record<string, number>,
  ): ClockComparison {
    const keys = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);

    let aGreater = false;
    let bGreater = false;

    for (const key of keys) {
      const valA = clockA[key] ?? 0;
      const valB = clockB[key] ?? 0;

      if (valA > valB) aGreater = true;
      if (valB > valA) bGreater = true;
    }

    if (aGreater && bGreater) return 'concurrent';
    if (aGreater) return 'after';
    if (bGreater) return 'before';
    return 'equal';
  }
}
