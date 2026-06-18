/**
 * Omnimind MCP Namespace Isolation
 *
 * Derives a per-client memory namespace from the MCP `clientInfo`
 * (name + version) sent in the initialize handshake. Each Omnimind
 * MCP server instance binds to one namespace; writes default to it,
 * reads filter by it. Two MCP clients running in parallel therefore
 * cannot read each other's memories without an explicit namespace
 * override.
 *
 * The `ag-` prefix (agent) makes derived rows visually distinct in
 * SQLite dumps and avoids collision with user-set namespaces that
 * don't follow the prefix convention.
 */

import { createHash } from 'node:crypto';

const NAMESPACE_PREFIX = 'ag-';
const HASH_HEX_LEN = 16;
const MAX_NAMESPACE_LEN = 64;
const DEFAULT_NAMESPACE = 'default';

export interface ClientInfo {
  name?: string;
  version?: string;
}

export interface DerivedNamespace {
  namespace: string;
  source: 'client' | 'default';
}

/**
 * Pure: derive a stable namespace string from client identity.
 *
 * Returns `default` when clientInfo is missing/empty. Otherwise returns
 * `ag-<first 16 hex chars of SHA-256(name|version|salt)>`. The 64-char
 * cap keeps `IN (?, ?, ...)` clauses in MemoryStore.buildFilter bounded.
 */
export function deriveNamespace(
  clientInfo: ClientInfo | undefined,
  salt?: string,
): DerivedNamespace {
  const name = clientInfo?.name?.trim();
  if (!name) {
    return { namespace: DEFAULT_NAMESPACE, source: 'default' };
  }
  const version = clientInfo?.version ?? '';
  const payload = `${name}|${version}|${salt ?? ''}`;
  const hex = createHash('sha256').update(payload).digest('hex').slice(0, HASH_HEX_LEN);
  const namespace = (`${NAMESPACE_PREFIX}${hex}`).slice(0, MAX_NAMESPACE_LEN);
  return { namespace, source: 'client' };
}

/**
 * Tracks per-instance namespace bindings so a long-lived Omnimind
 * process (HTTP server / MCP-over-HTTP) can route multiple clients
 * to distinct namespaces. The stdio MCP server uses a single entry.
 */
export class NamespaceRegistry {
  private readonly bindings = new Map<string, string>();

  /** Bind an instanceId to the namespace derived from clientInfo. */
  register(instanceId: string, clientInfo: ClientInfo | undefined, salt?: string): string {
    const { namespace } = deriveNamespace(clientInfo, salt);
    this.bindings.set(instanceId, namespace);
    return namespace;
  }

  /** Look up the namespace for a previously registered instance. */
  lookup(instanceId: string): string | undefined {
    return this.bindings.get(instanceId);
  }

  /** Return all registered (instanceId, namespace) pairs. */
  all(): Array<{ instanceId: string; namespace: string }> {
    return Array.from(this.bindings.entries()).map(([instanceId, namespace]) => ({
      instanceId,
      namespace,
    }));
  }

  /** Number of registered bindings (testing / observability). */
  size(): number {
    return this.bindings.size;
  }
}