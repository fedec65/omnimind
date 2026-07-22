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

describe('RelationExtractor — noise dampening', () => {
  const makeEntity = (name: string, type: string = 'concept'): Entity => ({
    id: `entity_${name.toLowerCase()}`,
    name,
    type: type as Entity['type'],
    description: null,
    firstSeen: 0,
    lastSeen: 0,
    mentionCount: 1,
  });

  it('limits co-occurrence to the first 7 entities', () => {
    const entities = Array.from({ length: 12 }, (_, i) => makeEntity(`Ent${i}`));
    const relations = extractRelations('Ent0 Ent1 Ent2 Ent3 Ent4 Ent5 Ent6 Ent7 Ent8 Ent9 Ent10 Ent11', entities);

    const coOccurrences = relations.filter(r => r.predicate === 'related_to');
    // C(7,2) = 21 pairs among the first 7 entities
    expect(coOccurrences.length).toBe(21);
    expect(coOccurrences.every(r => !r.subjectId.includes('ent7') && !r.objectId.includes('ent7'))).toBe(true);
  });

  it('never emits related_to for pairs already linked by a verb relation', () => {
    const entities = [makeEntity('App'), makeEntity('Redis')];
    const relations = extractRelations('The App uses Redis for caching.', entities);

    const coOccurrence = relations.find(r => r.predicate === 'related_to');
    expect(coOccurrence).toBeUndefined();

    const uses = relations.find(r => r.predicate === 'uses');
    expect(uses).toBeDefined();
  });

  it('caps relations at 30 per text', () => {
    const many = Array.from({ length: 15 }, (_, i) => makeEntity(`Item${i}`));
    const relations = extractRelations('Item0 Item1 Item2 Item3 Item4 Item5 Item6', many);
    expect(relations.length).toBeLessThanOrEqual(30);
    expect(relations.length).toBe(21); // C(7,2)
  });
});
