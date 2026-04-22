# Omnimind Technical Architecture

## 1. System Architecture

```
                    ┌─────────────────────────────────┐
                    │  MCP Clients (Claude, Cursor...)  │
                    └───────────────┬─────────────────┘
                                    │ MCP Protocol
                    ┌───────────────▼─────────────────┐
                    │      Omnimind MCP Server        │
                    │  ┌───────────────────────────┐  │
                    │  │   Prediction Layer        │  │
                    │  │  - ActivityTracker        │  │
                    │  │  - IntentPredictor        │  │
                    │  │  - ContextInjector        │  │
                    │  └───────────────────────────┘  │
                    │  ┌───────────────────────────┐  │
                    │  │   Cross-Tool Memory Bus   │  │
                    │  │  - MemoryBus              │  │
                    │  │  - ToolAdapters           │  │
                    │  │  - ConflictResolver       │  │
                    │  └───────────────────────────┘  │
                    └───────────────┬─────────────────┘
                                    │ Internal API
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
┌───────▼────────┐    ┌────────────▼────────────┐    ┌──────────▼───────┐
│ GUI (Tauri)    │    │  Neuro-Symbolic Core    │    │ MCP Tools        │
│ - Memory Map   │◄──►│  ┌───────────────────┐  │    │ - search         │
│ - Timeline     │    │  │ L0: Verbatim      │  │    │ - store          │
│ - Concept Graph│    │  │ L1: Compressed    │  │    │ - predict        │
│ - Search       │    │  │ L2: Concept Graph │  │    │ - status         │
└────────────────┘    │  │ L3: Wisdom        │  │    └──────────────────┘
                      │  └───────────────────┘  │
                      │  ┌───────────────────┐  │
                      │  │ EmbeddingEngine   │  │
                      │  │ (ONNX local)      │  │
                      │  └───────────────────┘  │
                      │  ┌───────────────────┐  │
                      │  │ SearchEngine      │  │
                      │  │ (vector + FTS5)   │  │
                      │  └───────────────────┘  │
                      └────────────┬────────────┘
                                   │
                      ┌────────────▼────────────┐
                      │   SQLite Database       │
                      │  ┌───────────────────┐  │
                      │  │ memories (vectors)│  │
                      │  │ entities (graph)  │  │
                      │  │ relations (graph) │  │
                      │  │ activity_log      │  │
                      │  │ predictions       │  │
                      │  └───────────────────┘  │
                      └─────────────────────────┘
```

---

## 2. Database Schema

### 2.1 Memories Table (Vector + Text)
```sql
CREATE TABLE memories (
    id              TEXT PRIMARY KEY,        -- UUID v4
    content         TEXT NOT NULL,           -- Raw verbatim text
    content_hash    TEXT NOT NULL,           -- SHA-256 for dedup
    embedding       F32_BLOB(384),          -- all-MiniLM-L6-v2 = 384 dims
    layer           INTEGER NOT NULL,        -- 0=verbatim, 1=compressed, 2=concept, 3=wisdom
    wing            TEXT,                    -- Top-level category
    room            TEXT,                    -- Sub-category
    source_tool     TEXT,                    -- Which tool created this
    source_id       TEXT,                    -- Original conversation/file ID
    confidence      REAL DEFAULT 1.0,        -- Extraction confidence (0-1)
    
    -- Temporal
    created_at      INTEGER NOT NULL,        -- Unix timestamp (ms)
    accessed_at     INTEGER,                 -- Last accessed
    access_count    INTEGER DEFAULT 0,       -- For LRU and wisdom extraction
    valid_from      INTEGER,                -- When this fact became true
    valid_to        INTEGER,                -- When it stopped being true (NULL=current)
    
    -- Metadata
    pinned          INTEGER DEFAULT 0,       -- 1 = never age
    compressed_ref  TEXT,                    -- Reference to L1 version
    concept_refs    TEXT,                    -- JSON array of L2 entity IDs
    
    -- FTS5 virtual table will shadow this for keyword search
);

-- Vector search index (sqlite-vss)
CREATE VIRTUAL TABLE vss_memories USING vss0(embedding(384));

-- FTS5 for keyword search
CREATE VIRTUAL TABLE memories_fts USING fts5(content, content_rowid=id);
```

### 2.2 Knowledge Graph Tables
```sql
CREATE TABLE entities (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,           -- person, project, concept, file, api, etc.
    description     TEXT,
    first_seen      INTEGER NOT NULL,
    last_seen       INTEGER NOT NULL,
    mention_count   INTEGER DEFAULT 1
);

CREATE TABLE relations (
    id              TEXT PRIMARY KEY,
    subject_id      TEXT NOT NULL REFERENCES entities(id),
    predicate       TEXT NOT NULL,           -- "uses", "created_by", "depends_on", etc.
    object_id       TEXT NOT NULL REFERENCES entities(id),
    valid_from      INTEGER,
    valid_to        INTEGER,
    source_memory   TEXT REFERENCES memories(id),
    confidence      REAL DEFAULT 1.0
);

-- Index for fast graph traversal
CREATE INDEX idx_relations_subject ON relations(subject_id);
CREATE INDEX idx_relations_object ON relations(object_id);
CREATE INDEX idx_relations_predicate ON relations(predicate);
```

### 2.3 Activity Log (For Predictions)
```sql
CREATE TABLE activity_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       INTEGER NOT NULL,
    activity_type   TEXT NOT NULL,           -- file_open, tool_call, memory_access, etc.
    context_hash    TEXT,                    -- Fingerprint of current state
    memory_id       TEXT REFERENCES memories(id), -- Which memory was accessed (if any)
    tool_name       TEXT,                    -- Which tool was used
    project_path    TEXT,                    -- Current working directory
    git_branch      TEXT                     -- Current git branch
);

-- Index for fast pattern queries
CREATE INDEX idx_activity_time ON activity_log(timestamp);
CREATE INDEX idx_activity_context ON activity_log(context_hash);
CREATE INDEX idx_activity_memory ON activity_log(memory_id);
```

### 2.4 Predictions Table
```sql
CREATE TABLE predictions (
    id              TEXT PRIMARY KEY,
    timestamp       INTEGER NOT NULL,
    context_hash    TEXT NOT NULL,
    predicted_memories TEXT NOT NULL,        -- JSON array of memory IDs with scores
    confidence      REAL NOT NULL,
    was_accepted    INTEGER,                -- NULL = pending, 1 = yes, 0 = no
    user_feedback   TEXT                     -- Optional feedback
);
```

---

## 3. Memory Layer System

### 3.1 Layer Definitions

| Layer | Name | Age Trigger | Representation | Search Method | Typical Size |
|-------|------|-------------|----------------|---------------|--------------|
| L0 | Verbatim | 0-7 days | Full text + vector | Vector + FTS5 | 100% |
| L1 | Compressed | 7-30 days | AAAK shorthand + vector | Vector + keyword | ~30% |
| L2 | Concept | 30-180 days | Knowledge graph nodes | Graph traversal | ~5% |
| L3 | Wisdom | 180+ days | Distilled patterns | Pattern matching | ~1% |

### 3.2 Aging Pipeline

```
New Memory
    │
    ▼
┌─────────┐     After 7 days      ┌──────────┐
│   L0    │ ─────────────────────►│    L1    │
│Verbatim │  CompressionEngine    │Compressed│
│ 100%    │  (local heuristic)    │  ~30%    │
└─────────┘                       └────┬─────┘
                                       │
                          After 30 days│
                                       ▼
                              ┌────────────┐
                              │     L2     │
                              │  Concept   │
                              │   ~5%      │
                              └─────┬──────┘
                                    │
                       After 180 days│
                                    ▼
                             ┌──────────┐
                             │    L3    │
                             │  Wisdom  │
                             │   ~1%    │
                             └──────────┘
```

**Lazy Aging:** Transitions happen on ACCESS, not on a schedule. When you query a memory:
1. Check its age
2. If it should have aged, trigger the transition
3. Keep the old representation as backup

### 3.3 Compression Engine (L0 → L1)

Uses a **local rule-based system** (NOT an LLM):

```typescript
interface CompressionRule {
  pattern: RegExp;        // What to match
  template: string;       // How to compress
  priority: number;       // Order of application
}

const DEFAULT_RULES: CompressionRule[] = [
  { pattern: /\b(because|since|due to)\b/gi, template: "∵", priority: 1 },
  { pattern: /\b(therefore|thus|hence)\b/gi, template: "∴", priority: 1 },
  { pattern: /\b(function|method|procedure)\b/gi, template: "fn", priority: 2 },
  // ... 50+ rules for common programming terms
  { pattern: /\{[\s\S]*?\}/g, template: compressJsonLike, priority: 5 },
];
```

Also removes:
- Filler words ("um", "like", "you know")
- Redundant pleasantries
- Duplicate information within the same memory

### 3.4 Concept Extraction (L1 → L2)

Extract entities and relations using **local NER** (ONNX model):

```typescript
// Extract from compressed text
const entities = await nerExtractor.extract(memory.content);
// e.g., [{name: "UserService", type: "class"}, {name: "GraphQL", type: "api"}]

const relations = await relationExtractor.extract(memory.content, entities);
// e.g., [{subject: "UserService", predicate: "uses", object: "GraphQL"}]

// Store in graph tables
await graphStore.addEntities(entities);
await graphStore.addRelations(relations);
```

### 3.5 Wisdom Distillation (L2 → L3)

Pattern recognition over concept graph:

```typescript
// Find frequently co-occurring concepts
const patterns = await graphStore.findFrequentPatterns({
  minSupport: 3,        // Seen at least 3 times
  minConfidence: 0.7,   // Co-occur 70% of the time
  timeWindow: 30 * 24 * 60 * 60 * 1000, // 30 days
});

// Store as "wisdom" rules
for (const pattern of patterns) {
  await wisdomStore.add({
    pattern: pattern.description,
    examples: pattern.sourceMemoryIds,
    confidence: pattern.confidence,
  });
}
```

---

## 4. Search Engine

### 4.1 Query Processing Pipeline

```
User Query
    │
    ├──► Embedding ──► Vector Search (vss_memories) ──┐
    │                                                    ├──► Fusion ──► Rerank ──► Results
    ├──► Tokenize ──► FTS5 Search (memories_fts) ──────┘
    │
    └──► Graph Traversal (if entities detected)
              │
              ▼
         Find entities → Expand via relations → Get connected memories
```

### 4.2 Hybrid Fusion Algorithm

```typescript
function hybridFusion(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  alpha: number = 0.7,  // Weight for vector vs keyword
): SearchResult[] {
  const scores = new Map<string, number>();
  
  // Normalize vector scores (0-1)
  const vMax = Math.max(...vectorResults.map(r => r.score));
  for (const r of vectorResults) {
    scores.set(r.id, (alpha * r.score) / vMax);
  }
  
  // Normalize keyword scores (0-1) and combine
  const kMax = Math.max(...keywordResults.map(r => r.score));
  for (const r of keywordResults) {
    const existing = scores.get(r.id) || 0;
    scores.set(r.id, existing + ((1 - alpha) * r.score) / kMax);
  }
  
  // Sort by combined score
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}
```

### 4.3 Temporal Boosting

Recent memories get a score boost (configurable):

```typescript
function temporalBoost(
  score: number,
  memoryAge: number,     // milliseconds since creation
  halfLife: number = 7 * 24 * 60 * 60 * 1000, // 7 days
): number {
  const decay = Math.exp(-memoryAge / halfLife);
  return score * (0.5 + 0.5 * decay);  // Never goes below 50%
}
```

---

## 5. Prediction System

### 5.1 Activity Fingerprint

```typescript
interface ContextFingerprint {
  // Current state
  projectHash: string;      // Hash of project path
  branchHash: string;       // Hash of git branch
  fileExtension: string;    // .ts, .py, etc.
  timeOfDay: number;        // 0-23 hour
  dayOfWeek: number;        // 0-6
  
  // Recent history (last 5 minutes)
  recentTools: string[];    // Tools used
  recentWings: string[];    // Memory wings accessed
  recentRooms: string[];    // Memory rooms accessed
}

function hashFingerprint(fp: ContextFingerprint): string {
  return sha256(JSON.stringify(fp));
}
```

### 5.2 Prediction Algorithm

```typescript
async function predictRelevantMemories(
  currentContext: ContextFingerprint,
  limit: number = 3,
): Promise<PredictedMemory[]> {
  const hash = hashFingerprint(currentContext);
  
  // 1. Look up similar past contexts
  const similarContexts = await db.query(`
    SELECT memory_id, COUNT(*) as frequency
    FROM activity_log
    WHERE context_hash IN (
      SELECT context_hash FROM activity_log
      WHERE timestamp > ?
      GROUP BY context_hash
      HAVING similarity(context_hash, ?) > 0.8
    )
    GROUP BY memory_id
    ORDER BY frequency DESC
    LIMIT ?
  `, [Date.now() - 30 * 24 * 60 * 60 * 1000, hash, limit * 5]);
  
  // 2. Score by recency + frequency
  const predictions = similarContexts.map(row => ({
    memoryId: row.memory_id,
    confidence: Math.min(0.95, row.frequency / 5),  // Cap at 95%
  })).filter(p => p.confidence >= 0.7);  // Threshold
  
  // 3. Fetch full memories
  return Promise.all(predictions.map(async p => ({
    ...(await memoryStore.get(p.memoryId)),
    predictionConfidence: p.confidence,
  })));
}
```

### 5.3 Context Injection

```typescript
async function injectPredictions(
  currentContext: ContextFingerprint,
): Promise<string> {
  const predictions = await predictRelevantMemories(currentContext);
  
  if (predictions.length === 0) return "";
  
  // Format as compact context block
  const lines = predictions.map(p => 
    `[${p.wing}/${p.room}] ${p.content.substring(0, 200)}`
  );
  
  return `\n<omnimind_predictions confidence="${predictions[0].predictionConfidence}">\n${lines.join('\n')}\n</omnimind_predictions>\n`;
}
```

---

## 6. Cross-Tool Memory Bus

### 6.1 Event Schema

```typescript
interface MemoryEvent {
  id: string;                    // Event UUID
  timestamp: number;
  sourceTool: string;            // "claude-code", "cursor", "chatgpt"
  eventType: 'create' | 'update' | 'delete' | 'access';
  memoryId?: string;             // Affected memory
  payload: {
    content?: string;
    wing?: string;
    room?: string;
    metadata?: Record<string, unknown>;
  };
  vectorClock: Record<string, number>;  // For conflict resolution
}
```

### 6.2 Conflict Resolution Strategy

```typescript
async function resolveConflict(
  localEvent: MemoryEvent,
  remoteEvent: MemoryEvent,
): Promise<MemoryEvent> {
  // Strategy: CRDT-style last-writer-wins with tool preference
  const toolPriority = { 'claude-code': 3, 'cursor': 2, 'chatgpt': 1 };
  
  // Compare vector clocks
  const localWins = compareVectorClocks(localEvent.vectorClock, remoteEvent.vectorClock);
  
  if (localWins === 'concurrent') {
    // Both happened concurrently — use tool priority
    return toolPriority[localEvent.sourceTool] >= toolPriority[remoteEvent.sourceTool]
      ? localEvent : remoteEvent;
  }
  
  return localWins === 'left' ? localEvent : remoteEvent;
}
```

---

## 7. Performance Targets

| Operation | Target | Worst Case | Measurement |
|-----------|--------|------------|-------------|
| Store memory | < 50ms | < 100ms | Embedding + insert |
| Semantic search | < 15ms | < 30ms | Single query |
| Hybrid search | < 20ms | < 40ms | Vector + FTS5 |
| Graph traversal | < 10ms | < 25ms | 2-hop query |
| Prediction | < 5ms | < 15ms | Context match |
| Context injection | < 5ms | < 10ms | Format strings |
| Layer transition | < 100ms | < 500ms | L0→L1 compression |
| Database size | < 1GB | < 5GB | 100K memories |
| RAM usage | < 200MB | < 500MB | Including ONNX |
| Wake-up tokens | < 150 | < 200 | L0+L1 predictions |

---

## 8. Security Architecture

### 8.1 Encryption

```typescript
// Memories encrypted at rest with AES-256-GCM
// Key derived from user's machine fingerprint + optional passphrase

const key = await hkdf(
  sha256(machineId + (passphrase || '')),
  salt,
  'omnimind-v1',
  32,
);

function encryptMemory(plaintext: string): EncryptedBlob {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv, authTag, ciphertext: encrypted };
}
```

### 8.2 Access Control

```typescript
interface AccessPolicy {
  toolId: string;           // Which tool
  permissions: ('read' | 'write' | 'delete' | 'predict')[];
  allowedWings: string[];   // Which memory namespaces
  maxTokensPerRequest: number;
}
```

---

## 9. Testing Strategy

### 9.1 Test Categories

```
tests/
├── unit/                    # Isolated module tests
│   ├── MemoryStore.test.ts
│   ├── SearchEngine.test.ts
│   ├── CompressionEngine.test.ts
│   ├── PredictionEngine.test.ts
│   └── ConflictResolver.test.ts
├── integration/             # Multi-module tests
│   ├── LayerTransition.test.ts
│   ├── EndToEndSearch.test.ts
│   └── CrossToolSync.test.ts
├── benchmarks/              # Performance tests
│   ├── LatencyBenchmark.ts
│   ├── RecallBenchmark.ts   # LongMemEval reproduction
│   └── StorageGrowth.ts
└── fixtures/                # Test data
    ├── sample_memories.json
    └── longmemeval_subset.json
```

### 9.2 Benchmark: LongMemEval Reproduction

```typescript
// tests/benchmarks/RecallBenchmark.ts
import { describe, it, expect } from 'vitest';
import { loadLongMemEval } from './fixtures';
import { MemoryStore } from '../../src/core/MemoryStore';

describe('LongMemEval Benchmark', () => {
  it('should achieve >= 96% R@5', async () => {
    const store = new MemoryStore();
    const dataset = await loadLongMemEval('longmemeval_s_cleaned.json');
    
    // Index all conversations
    for (const conv of dataset.conversations) {
      await store.store(conv.messages.join('\n'), {
        wing: conv.category,
        sourceId: conv.id,
      });
    }
    
    // Evaluate recall
    let correct = 0;
    for (const question of dataset.questions) {
      const results = await store.search(question.text, { limit: 5 });
      if (results.some(r => r.sourceId === question.targetConversationId)) {
        correct++;
      }
    }
    
    const recall = correct / dataset.questions.length;
    console.log(`R@5: ${(recall * 100).toFixed(1)}%`);
    expect(recall).toBeGreaterThanOrEqual(0.96);
  }, 300000); // 5 minute timeout
});
```

---

## 10. API Reference

### 10.1 MemoryStore

```typescript
class MemoryStore {
  // CRUD
  async store(content: string, meta: MemoryMeta): Promise<Memory>;
  async get(id: string): Promise<Memory | null>;
  async update(id: string, updates: Partial<Memory>): Promise<Memory>;
  async delete(id: string): Promise<void>;
  
  // Search
  async search(query: string, opts: SearchOptions): Promise<SearchResult[]>;
  async semanticSearch(embedding: Float32Array, opts: SearchOptions): Promise<SearchResult[]>;
  async keywordSearch(query: string, opts: SearchOptions): Promise<SearchResult[]>;
  async graphQuery(entityName: string, hops: number): Promise<GraphResult[]>;
  
  // Layer management
  async promoteToLayer(id: string, targetLayer: number): Promise<void>;
  async pin(id: string): Promise<void>;
  async unpin(id: string): Promise<void>;
  
  // Stats
  async getStats(): Promise<StoreStats>;
}
```

### 10.2 SearchOptions

```typescript
interface SearchOptions {
  limit?: number;           // Max results (default: 10)
  layer?: number | number[]; // Filter by layer
  wing?: string;            // Filter by wing
  room?: string;            // Filter by room
  timeRange?: [number, number]; // Unix timestamps
  includeExpired?: boolean; // Include invalid facts (default: false)
  boostRecent?: boolean;    // Temporal boosting (default: true)
}
```

### 10.3 Memory

```typescript
interface Memory {
  id: string;
  content: string;
  embedding: Float32Array;
  layer: 0 | 1 | 2 | 3;
  wing: string;
  room: string;
  sourceTool: string;
  sourceId: string;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  validFrom?: number;
  validTo?: number;
  pinned: boolean;
  confidence: number;
}
```
