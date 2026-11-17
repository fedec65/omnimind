/**
 * OMNIMIND_NAMESPACE (sandsiv harness): one agent, one namespace across agent
 * updates. The derived namespace includes the client's version, so without a
 * pin every update starts empty. Memories in earlier derived namespaces move in.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '../../src/core/MemoryStore.js';
import { NamespaceRegistry, deriveNamespace } from '../../src/mcp/namespace.js';

describe('pinned namespace', () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'omnimind-pin-'));
    store = new MemoryStore({ dbPath: join(dir, 'm.db') });
    await store.init();
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('the derived namespace changes with the client version (the problem)', () => {
    const a = deriveNamespace({ name: 'dsh', version: '0.2.1-rc.5' }).namespace;
    const b = deriveNamespace({ name: 'dsh', version: '0.2.2' }).namespace;
    expect(a).not.toBe(b);
  });

  it('bind() pins any instance to the given namespace', () => {
    const r = new NamespaceRegistry();
    expect(r.bind('i1', 'agent')).toBe('agent');
    expect(r.lookup('i1')).toBe('agent');
  });

  it('reassignNamespaces moves derived ag- namespaces in and keeps the others', async () => {
    const old1 = deriveNamespace({ name: 'dsh', version: '0.2.1-rc.5' }).namespace;
    const a = await store.store('Prefers offers as PDF.', { wing: 'personal', namespace: old1 });
    const b = await store.store('Likes short mails.', { wing: 'personal', namespace: 'ag-0123456789abcdef' });
    const c = await store.store('Project notes kept apart.', { wing: 'work', namespace: 'projects' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('store failed');
    const moved = store.reassignNamespaces('ag-', 'agent');
    expect(moved.ok && moved.value).toBe(2);
    const ns = async (id: string) => { const r = await store.get(id); return r.ok ? r.value?.namespace : undefined; };
    expect(await ns(a.value.id)).toBe('agent');
    expect(await ns(b.value.id)).toBe('agent');
    expect(await ns(c.value.id)).toBe('projects');
    // Idempotent.
    const again = store.reassignNamespaces('ag-', 'agent');
    expect(again.ok && again.value).toBe(0);
  });

  it('LIKE wildcards in the prefix are literal', async () => {
    await store.store('x', { wing: 'w', namespace: 'agX' });
    const moved = store.reassignNamespaces('ag_', 'agent');
    expect(moved.ok && moved.value).toBe(0);
  });
});
