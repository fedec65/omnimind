/**
 * mcpSetup — idempotent MCP client registration for Omnimind.
 *
 * Generalizes the `setup-claude-code` script to all supported clients:
 * claude-code, cursor, claude-desktop, kimi. Auto-detects which clients
 * are installed and writes the Omnimind MCP server entry into each
 * client's config file.
 *
 * Design choices (same as setup-claude-code):
 * - Pure functions exported for testability (homedir injectable).
 * - Atomic write via tmp+rename prevents half-written config.
 * - 0o600 file mode matches the project's privacy posture.
 * - Tolerant JSON parsing: a malformed existing config does not block
 *   setup (unrelated top-level keys and other mcpServers entries are
 *   preserved on write).
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type McpClientId = 'claude-code' | 'cursor' | 'claude-desktop' | 'kimi';

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClientConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

export interface McpClient {
  readonly id: McpClientId;
  readonly name: string;
  /** Absolute path of the config file, given a home directory and platform */
  readonly configPath: (home: string, platform: NodeJS.Platform) => string;
  /** Paths whose existence indicates the client is installed */
  readonly detectPaths: (home: string, platform: NodeJS.Platform) => string[];
}

const claudeDesktopDir = (home: string, platform: NodeJS.Platform): string => {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude');
  if (platform === 'win32') return join(home, 'AppData', 'Roaming', 'Claude');
  return join(home, '.config', 'Claude');
};

export const MCP_CLIENTS: readonly McpClient[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    configPath: (home) => join(home, '.claude', 'settings.json'),
    detectPaths: (home) => [join(home, '.claude')],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    configPath: (home) => join(home, '.cursor', 'mcp.json'),
    detectPaths: (home) => [join(home, '.cursor')],
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    configPath: (home, platform) => join(claudeDesktopDir(home, platform), 'claude_desktop_config.json'),
    detectPaths: (home, platform) => [claudeDesktopDir(home, platform)],
  },
  {
    id: 'kimi',
    name: 'Kimi Code',
    configPath: (home) => join(home, '.kimi-code', 'mcp.json'),
    detectPaths: (home) => [join(home, '.kimi-code')],
  },
] as const;

export function getClient(id: McpClientId): McpClient {
  const client = MCP_CLIENTS.find((c) => c.id === id);
  if (!client) throw new Error(`Unknown MCP client: ${id}`);
  return client;
}

/** The MCP server entry Omnimind installs for every client. */
export function buildEntry(): McpServerEntry {
  return { command: 'npx', args: ['-y', 'omnimind-mcp'] };
}

/**
 * Entry that points at an explicit Node binary + server script, with no
 * npm/npx requirement. Used by the desktop app (bundled Node + dist) so
 * DMG users get a working registration without installing the CLI.
 */
export function buildExplicitEntry(nodePath: string, scriptPath: string): McpServerEntry {
  return { command: nodePath, args: [scriptPath] };
}

/**
 * Parse a client config JSON string. Tolerant: returns {} for empty
 * input or malformed JSON so a half-written existing file does not
 * block setup.
 */
export function parseConfig(text: string): ClientConfig {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as ClientConfig;
  } catch {
    return {};
  }
}

/**
 * Merge the omnimind entry into an existing config object.
 * Preserves unrelated top-level keys and other mcpServers entries.
 */
export function mergeMcpServers(existing: ClientConfig, entry: McpServerEntry): ClientConfig {
  const next: ClientConfig = { ...existing };
  next.mcpServers = { ...(existing.mcpServers ?? {}), omnimind: entry };
  return next;
}

/** Clients that appear to be installed under the given home directory */
export function detectClients(
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): McpClient[] {
  return MCP_CLIENTS.filter((client) => {
    if (existsSync(client.configPath(home, platform))) return true;
    return client.detectPaths(home, platform).some((p) => existsSync(p));
  });
}

/** Whether the client's config already contains the Omnimind MCP entry */
export function isClientConfigured(
  client: McpClient,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): boolean {
  const path = client.configPath(home, platform);
  if (!existsSync(path)) return false;
  const config = parseConfig(readFileSync(path, 'utf8'));
  return config.mcpServers?.omnimind !== undefined;
}

export interface ClientStatus {
  readonly id: McpClientId;
  readonly name: string;
  readonly detected: boolean;
  readonly configured: boolean;
  readonly configPath: string;
}

/** Detection + registration status for every supported client */
export function getClientsStatus(
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): ClientStatus[] {
  const detected = new Set(detectClients(home, platform).map((c) => c.id));
  return MCP_CLIENTS.map((client) => ({
    id: client.id,
    name: client.name,
    detected: detected.has(client.id),
    configured: isClientConfigured(client, home, platform),
    configPath: client.configPath(home, platform),
  }));
}

export interface SetupResult {
  readonly client: McpClient;
  readonly path: string;
  readonly dryRun: boolean;
}

export interface SetupOptions {
  /** Explicit clients; when omitted, all detected clients are configured */
  clients?: readonly McpClientId[] | undefined;
  /** Home directory override (tests) */
  home?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  /** Print the would-be writes without touching disk */
  dryRun?: boolean | undefined;
  /** Custom server entry (default: npx-based, see buildExplicitEntry for the app) */
  entry?: McpServerEntry | undefined;
  out?: NodeJS.WritableStream | undefined;
}

/**
 * Write the Omnimind MCP entry into each selected client's config.
 * Returns one result per configured client. Throws when no clients are
 * selected and none can be detected.
 */
export function runSetup(opts: SetupOptions = {}): SetupResult[] {
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  const dryRun = opts.dryRun ?? false;
  const entry = opts.entry ?? buildEntry();
  const out = opts.out ?? process.stdout;

  const selected = opts.clients !== undefined
    ? opts.clients.map(getClient)
    : detectClients(home, platform);

  if (selected.length === 0) {
    throw new Error(
      'No supported MCP clients detected. Use --client <claude-code|cursor|claude-desktop|kimi> to configure one explicitly.',
    );
  }

  const results: SetupResult[] = [];
  for (const client of selected) {
    const path = client.configPath(home, platform);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const merged = mergeMcpServers(parseConfig(existing), entry);
    const serialized = JSON.stringify(merged, null, 2) + '\n';

    if (dryRun) {
      out.write(`[dry-run] Would write to ${path}:\n${serialized}\n`);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      const tmpPath = `${path}.omnimind.tmp`;
      writeFileSync(tmpPath, serialized, { mode: 0o600 });
      renameSync(tmpPath, path);
      chmodSync(path, 0o600);
      out.write(`Registered Omnimind MCP server in ${client.name} (${path})\n`);
    }
    results.push({ client, path, dryRun });
  }
  return results;
}
