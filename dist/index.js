/**
 * Omnimind — Proactive, cross-tool memory system for LLMs
 *
 * Main entry point and public API.
 *
 * Usage:
 * ```typescript
 * import { Omnimind } from 'omnimind';
 *
 * const omni = await Omnimind.create();
 *
 * // Store a memory
 * await omni.store("User prefers GraphQL over REST", {
 *   wing: "project-alpha",
 *   room: "architecture",
 * });
 *
 * // Search memories
 * const results = await omni.search("GraphQL API decision");
 *
 * // Get predictions
 * const predictions = await omni.predict({
 *   projectPath: "/home/user/projects/alpha",
 *   gitBranch: "feature/auth",
 *   currentFile: "src/api.ts",
 * });
 *
 * // Format for context injection
 * const context = await omni.formatPredictions(predictions);
 * // → "<omnimind_predictions confidence="0.85">...</omnimind_predictions>"
 * ```
 */
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { MemoryStore } from './core/MemoryStore.js';
import { EmbeddingEngine } from './core/EmbeddingEngine.js';
import { SearchEngine } from './core/SearchEngine.js';
import { AgingPipeline } from './layers/AgingPipeline.js';
import { IntentPredictor, buildFingerprint } from './prediction/IntentPredictor.js';
import { MemoryLayer, ok, err, } from './core/types.js';
// ─── Main API ─────────────────────────────────────────────────────
/**
 * Omnimind — Unified memory system API.
 *
 * This is the primary interface for all memory operations.
 * It composes the store, search, prediction, and aging subsystems.
 */
export class Omnimind {
    memoryStore;
    predictor;
    aging;
    constructor(store) {
        this.memoryStore = store;
        this.predictor = new IntentPredictor();
        this.aging = new AgingPipeline();
    }
    /**
     * Create and initialize an Omnimind instance.
     *
     * This sets up the database, downloads models if needed,
     * and prepares all subsystems.
     */
    static async create(config = {}) {
        const dataDir = config.dataDir ?? join(homedir(), '.omnimind');
        const dbPath = join(dataDir, config.dbName ?? 'memory.db');
        // Ensure data directory exists
        mkdirSync(dataDir, { recursive: true });
        // Initialize store
        const store = new MemoryStore({ dbPath, modelPath: config.modelPath });
        const result = await store.init();
        if (!result.ok) {
            throw new Error(`Failed to initialize Omnimind: ${result.error.message}`);
        }
        const omni = new Omnimind(store);
        console.log(`[Omnimind] Initialized at ${dbPath}`);
        return omni;
    }
    // ─── Core Operations ────────────────────────────────────────────
    /** Store a new memory */
    async store(content, meta) {
        const result = await this.memoryStore.store(content, meta);
        if (result.ok) {
            // Update predictor with this access
            // (In real implementation, we'd track the context that led to storage)
        }
        return result;
    }
    /** Search memories with hybrid search */
    async search(query, opts) {
        return this.memoryStore.search(query, opts);
    }
    /** Get a memory by ID */
    async get(id) {
        return this.memoryStore.get(id);
    }
    /** Delete a memory */
    async delete(id) {
        return this.memoryStore.delete(id);
    }
    /** Pin a memory (prevent aging) */
    async pin(id) {
        return this.memoryStore.pin(id);
    }
    /** Unpin a memory (allow aging) */
    async unpin(id) {
        return this.memoryStore.unpin(id);
    }
    // ─── Prediction ─────────────────────────────────────────────────
    /**
     * Predict relevant memories for the current context.
     *
     * Returns predictions sorted by confidence.
     * Only returns predictions with confidence >= 70%.
     */
    async predict(context) {
        const fingerprint = buildFingerprint({
            projectPath: context.projectPath,
            gitBranch: context.gitBranch,
            currentFile: context.currentFile,
            recentTools: context.recentTools,
            recentWings: context.recentWings ?? [],
            recentRooms: context.recentRooms ?? [],
        });
        return this.predictor.predict(fingerprint, async (id) => {
            const result = await this.memoryStore.get(id);
            return result.ok ? result.value : null;
        });
    }
    /**
     * Format predictions as compact XML for context injection.
     *
     * Target size: < 150 tokens.
     * Format: <omnimind_predictions confidence="0.85">...</omnimind_predictions>
     */
    async formatPredictions(predictions) {
        if (predictions.length === 0)
            return '';
        const lines = [];
        let tokenEstimate = 0;
        for (const pred of predictions.slice(0, 3)) {
            if (tokenEstimate > 150)
                break;
            const mem = await this.memoryStore.get(pred.memoryId);
            if (!mem.ok || !mem.value)
                continue;
            const line = `[${mem.value.wing}] ${mem.value.content.substring(0, 200)}`;
            lines.push(line);
            tokenEstimate += line.split(/\s+/).length;
        }
        if (lines.length === 0)
            return '';
        const avgConfidence = predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length;
        return `\n<omnimind_predictions confidence="${avgConfidence.toFixed(2)}">\n${lines.join('\n')}\n</omnimind_predictions>\n`;
    }
    // ─── Aging ──────────────────────────────────────────────────────
    /**
     * Check if a memory should be aged and perform the transition.
     *
     * This is called lazily — typically when a memory is accessed.
     */
    async checkAging(memoryId) {
        const getResult = await this.memoryStore.get(memoryId);
        if (!getResult.ok)
            return err(getResult.error);
        if (!getResult.value)
            return err(new Error(`Memory not found: ${memoryId}`));
        const memory = getResult.value;
        if (!this.aging.shouldAge(memory)) {
            return ok(memory);
        }
        const targetLayer = this.aging.getTargetLayer(memory);
        if (targetLayer === memory.layer) {
            return ok(memory);
        }
        const transition = await this.aging.transition(memory, targetLayer);
        if (!transition.ok)
            return err(transition.error);
        // In a real implementation, we'd update the store with the aged version
        // while keeping the original as a reference
        console.log(`[Omnimind] Aged memory ${memoryId.substring(0, 8)}: L${memory.layer} → L${targetLayer}`);
        return ok(transition.value);
    }
    // ─── Stats ──────────────────────────────────────────────────────
    /** Get system statistics */
    async stats() {
        return this.memoryStore.getStats();
    }
    /** Close all resources */
    close() {
        this.memoryStore.close();
    }
}
// ─── Convenience Exports ──────────────────────────────────────────
export { MemoryLayer, buildFingerprint, EmbeddingEngine, SearchEngine, AgingPipeline, IntentPredictor, };
//# sourceMappingURL=index.js.map