/**
 * CLI setup command tests — exercise the validation + unsupported-skip
 * behavior against the `MCP_CLIENTS` registry used by `setupCommand`.
 *
 * Strategy: the command body in src/cli.ts reads the registry via the
 * `supported` flag; asserting on the registry keeps the test independent
 * of `process.exit` and deterministic across platforms.
 */
import { describe, it, expect } from 'vitest';
import { MCP_CLIENTS, type McpClientId } from '../../src/setup/mcpSetup.js';

describe('CLI setup whitelist', () => {
  it('includes all 7 supported client ids', () => {
    const supported = MCP_CLIENTS.filter((c) => c.supported).map((c) => c.id);
    expect(supported).toEqual(
      expect.arrayContaining(['claude-code', 'cursor', 'claude-desktop', 'kimi', 'codex', 'vscode', 'continue']),
    );
  });

  it('keeps all 4 unsupported ids in the registry for honest signaling', () => {
    const unsupported = MCP_CLIENTS.filter((c) => !c.supported).map((c) => c.id);
    expect(unsupported).toEqual(
      expect.arrayContaining(['deepseek', 'zai', 'grok', 'muse']),
    );
  });

  it('unsupported ids are valid McpClientId values but not in the supported list', () => {
    const supportedSet = new Set(MCP_CLIENTS.filter((c) => c.supported).map((c) => c.id));
    for (const id of ['deepseek', 'zai', 'grok', 'muse'] as const) {
      const _check: McpClientId = id;
      expect(supportedSet.has(_check)).toBe(false);
    }
  });
});
