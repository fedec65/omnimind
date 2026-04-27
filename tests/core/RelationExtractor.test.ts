/**
 * RelationExtractor tests
 *
 * Tests heuristic triple extraction from text.
 */

import { describe, it, expect } from 'vitest';
import { extractRelations } from '../../src/core/RelationExtractor.js';
import { type Entity } from '../../src/core/types.js';

describe('RelationExtractor', () => {
  const makeEntity = (name: string, type: string = 'concept'): Entity => ({
    id: `entity_${name.toLowerCase()}`,
    name,
    type: type as Entity['type'],
    description: null,
    firstSeen: 0,
    lastSeen: 0,
    mentionCount: 1,
  });

  it('should extract "uses" relations', () => {
    const entities = [makeEntity('App'), makeEntity('Redis')];
    const relations = extractRelations('The App uses Redis for caching.', entities);

    const uses = relations.find(r => r.predicate === 'uses');
    expect(uses).toBeDefined();
    expect(uses!.subjectId).toBe('entity_app');
    expect(uses!.objectId).toBe('entity_redis');
  });

  it('should extract "is_a" relations', () => {
    const entities = [makeEntity('Redis'), makeEntity('database')];
    const relations = extractRelations('Redis is a database.', entities);

    const isA = relations.find(r => r.predicate === 'is_a');
    expect(isA).toBeDefined();
    expect(isA!.subjectId).toBe('entity_redis');
    expect(isA!.objectId).toBe('entity_database');
  });

  it('should create co-occurrence relations between all entity pairs', () => {
    const entities = [
      makeEntity('Alpha'),
      makeEntity('Beta'),
      makeEntity('Gamma'),
    ];
    const relations = extractRelations('Alpha and Beta and Gamma work together.', entities);

    const coOccurrences = relations.filter(r => r.predicate === 'related_to');
    // 3 entities → C(3,2) = 3 pairs
    expect(coOccurrences.length).toBe(3);
  });

  it('should include sourceMemory when provided', () => {
    const entities = [makeEntity('X'), makeEntity('Y')];
    const relations = extractRelations('X uses Y.', entities, 'mem-123');

    expect(relations.every(r => r.sourceMemory === 'mem-123')).toBe(true);
  });

  it('should return empty array when no entities match', () => {
    const entities = [makeEntity('Foo')];
    const relations = extractRelations('Something completely unrelated.', entities);

    const patterns = relations.filter(r => r.predicate !== 'related_to');
    expect(patterns.length).toBe(0);
  });
});
