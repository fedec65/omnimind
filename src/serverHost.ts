/**
 * Bind-address resolution for the HTTP API server.
 *
 * Localhost-only by default so the API (and any configured shared-server
 * token) is never exposed on the LAN. Set OMNIMIND_HOST=0.0.0.0 to accept
 * external connections. Lives in its own module because src/server.ts has
 * import-time side effects (listens immediately), which makes it untestable.
 */

export function resolveBindHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.OMNIMIND_HOST || '127.0.0.1';
}
