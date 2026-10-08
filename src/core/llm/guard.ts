/**
 * Loopback guard: refuses any base URL that resolves to a non-loopback host.
 * Run every time the engine rebuilds a provider, so a user editing baseUrl in
 * Settings sees the result via the next status check.
 */
import { type Result, ok, err } from '../types.js';
import type { LLMError } from './errors.js';

export function assertLoopback(url: string): Result<string, LLMError> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return err({ kind: 'config', reason: `invalid URL: ${url}` });
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return err({ kind: 'config', reason: `protocol must be http(s), got ${u.protocol}` });
  }

  const raw = u.hostname.toLowerCase();
  const h = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  const allowed = h === 'localhost' || h === '127.0.0.1' || h === '::1';
  if (!allowed) {
    return err({ kind: 'config', reason: `LLM provider must be loopback, got: ${h}` });
  }

  return ok(u.toString());
}
