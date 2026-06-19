import { describe, it, expect } from 'vitest';
import { deriveNamespace, NamespaceRegistry } from '../../src/mcp/namespace.js';

describe('deriveNamespace', () => {
  it('returns ag-prefixed 19-char string for known clientInfo', () => {
    const { namespace, source } = deriveNamespace({ name: 'claude-code', version: '1.0.0' });
    expect(namespace.startsWith('ag-')).toBe(true);
    expect(namespace.length).toBe(3 + 16); // 'ag-' + 16 hex chars
    expect(source).toBe('client');
  });

  it('is deterministic across calls with identical input', () => {
    const a = deriveNamespace({ name: 'cursor', version: '0.42.0' });
    const b = deriveNamespace({ name: 'cursor', version: '0.42.0' });
    expect(a.namespace).toBe(b.namespace);
  });

  it('produces distinct namespaces for different versions', () => {
    const a = deriveNamespace({ name: 'chatgpt', version: '1.0.0' });
    const b = deriveNamespace({ name: 'chatgpt', version: '2.0.0' });
    expect(a.namespace).not.toBe(b.namespace);
  });

  it('falls back to default when clientInfo is undefined', () => {
    const { namespace, source } = deriveNamespace(undefined);
    expect(namespace).toBe('default');
    expect(source).toBe('default');
  });

  it('falls back to default when clientInfo.name is empty', () => {
    const { namespace, source } = deriveNamespace({ name: '', version: '1.0.0' });
    expect(namespace).toBe('default');
    expect(source).toBe('default');
  });

  it('falls back to default when clientInfo.name is whitespace only', () => {
    const { namespace } = deriveNamespace({ name: '   ', version: '1.0.0' });
    expect(namespace).toBe('default');
  });

  it('caps namespace length at 64 chars even for very long names', () => {
    const { namespace } = deriveNamespace({ name: 'a'.repeat(200), version: '1.0.0' });
    expect(namespace.length).toBeLessThanOrEqual(64);
  });

  it('treats missing version as empty string', () => {
    const a = deriveNamespace({ name: 'foo' });
    const b = deriveNamespace({ name: 'foo', version: '' });
    expect(a.namespace).toBe(b.namespace);
  });

  it('produces different namespaces when salt differs', () => {
    const a = deriveNamespace({ name: 'x', version: '1' }, 'salt-a');
    const b = deriveNamespace({ name: 'x', version: '1' }, 'salt-b');
    expect(a.namespace).not.toBe(b.namespace);
  });
});

describe('NamespaceRegistry', () => {
  it('register stores the derived namespace for an instanceId', () => {
    const reg = new NamespaceRegistry();
    const ns = reg.register('inst-1', { name: 'claude-code', version: '1.0.0' });
    expect(reg.lookup('inst-1')).toBe(ns);
    expect(ns.startsWith('ag-')).toBe(true);
  });

  it('lookup returns undefined for unknown instanceId', () => {
    const reg = new NamespaceRegistry();
    expect(reg.lookup('missing')).toBeUndefined();
  });

  it('all() returns the registered (instanceId, namespace) pairs', () => {
    const reg = new NamespaceRegistry();
    reg.register('a', { name: 'client-a', version: '1' });
    reg.register('b', { name: 'client-b', version: '1' });
    const entries = reg.all();
    expect(entries).toHaveLength(2);
    const ids = entries.map((e) => e.instanceId).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('register with undefined clientInfo stores default', () => {
    const reg = new NamespaceRegistry();
    const ns = reg.register('inst', undefined);
    expect(ns).toBe('default');
    expect(reg.lookup('inst')).toBe('default');
  });

  it('register overwrites a previous binding for the same instanceId', () => {
    const reg = new NamespaceRegistry();
    const first = reg.register('inst', { name: 'client-a' });
    const second = reg.register('inst', { name: 'client-b' });
    expect(first).not.toBe(second);
    expect(reg.lookup('inst')).toBe(second);
  });

  it('size() reports the number of registered bindings', () => {
    const reg = new NamespaceRegistry();
    expect(reg.size()).toBe(0);
    reg.register('a', { name: 'x' });
    reg.register('b', { name: 'y' });
    expect(reg.size()).toBe(2);
  });
});