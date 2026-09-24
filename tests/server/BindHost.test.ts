/**
 * Bind-address resolution tests for the HTTP API server. The server entry
 * (src/server.ts) has import-time side effects, so the resolution logic
 * lives in a standalone helper and is asserted here without spawning.
 */

import { describe, it, expect } from 'vitest';
import { resolveBindHost } from '../../src/serverHost.js';

describe('resolveBindHost', () => {
  it('defaults to 127.0.0.1 (localhost-only) when OMNIMIND_HOST is unset', () => {
    expect(resolveBindHost({})).toBe('127.0.0.1');
  });

  it('honors an explicit OMNIMIND_HOST override (e.g. LAN binding)', () => {
    expect(resolveBindHost({ OMNIMIND_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveBindHost({ OMNIMIND_HOST: '192.168.1.10' })).toBe('192.168.1.10');
  });

  it('treats empty OMNIMIND_HOST as unset and falls back to localhost', () => {
    expect(resolveBindHost({ OMNIMIND_HOST: '' })).toBe('127.0.0.1');
  });
});
