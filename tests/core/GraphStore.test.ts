/**
 * Graph store tests
 *
 * Tests entity upsert, relation insert, and graph search.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/core/MemoryStore.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';

describe('GraphStore', () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-graph-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    const result = await store.init();
    expect(result.ok).toBe(true);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('upsertEntity', () => {
    it('should insert a new entity', () => {
      const result = store.upsertEntity({
        id: 'entity_graphql',
        name: 'GraphQL',
        type: 'api',
        description: 'A query language',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBe('entity_graphql');
      expect(result.value.name).toBe('GraphQL');
      expect(result.value.type).toBe('api');
      expect(result.value.mentionCount).toBe(1);
    });

    it('should increment mention_count on duplicate', () => {
      store.upsertEntity({ id: 'entity_postgres', name: 'PostgreSQL', type: 'database' });
      const result = store.upsertEntity({ id: 'entity_postgres', name: 'PostgreSQL', type: 'database' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mentionCount).toBe(2);
    });
  });

  describe('insertRelation', () => {
    it('should insert a relation between two entities', () => {
      store.upsertEntity({ id: 'entity_a', name: 'A', type: 'concept' });
      store.upsertEntity({ id: 'entity_b', name: 'B', type: 'concept' });

      const result = store.insertRelation({
        subjectId: 'entity_a',
        predicate: 'uses',
        objectId: 'entity_b',
        confidence: 0.9,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.subjectId).toBe('entity_a');
      expect(result.value.predicate).toBe('uses');
      expect(result.value.objectId).toBe('entity_b');
    });
  });

  describe('queryEntities', () => {
    it('should return entities matching a type filter', () => {
      store.upsertEntity({ id: 'e1', name: 'Redis', type: 'database' });
      store.upsertEntity({ id: 'e2', name: 'Node', type: 'service' });
      store.upsertEntity({ id: 'e3', name: 'Mongo', type: 'database' });

      const result = store.queryEntities({ type: 'database' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.length).toBe(2);
      expect(result.value.map(e => e.name)).toContain('Redis');
      expect(result.value.map(e => e.name)).toContain('Mongo');
    });
  });

  describe('getEntityNeighbors', () => {
    it('should return neighbors connected by relations', () => {
      store.upsertEntity({ id: 'e_a', name: 'Alpha', type: 'concept' });
      store.upsertEntity({ id: 'e_b', name: 'Beta', type: 'concept' });
      store.upsertEntity({ id: 'e_c', name: 'Gamma', type: 'concept' });

      store.insertRelation({ subjectId: 'e_a', predicate: 'uses', objectId: 'e_b', confidence: 1 });
      store.insertRelation({ subjectId: 'e_b', predicate: 'uses', objectId: 'e_c', confidence: 1 });

      const result = store.getEntityNeighbors('e_a', 2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const neighborNames = result.value.map(n => n.entity.name);
      expect(neighborNames).toContain('Beta');
      expect(neighborNames).toContain('Gamma');
    });
  });
});
