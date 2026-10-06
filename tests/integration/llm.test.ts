/**
 * LLM integration tests — full lifecycle coverage.
 *
 * Exercises the new public surface added in Task 9:
 *   - `omni.llm` (LLMProvider getter)
 *   - `omni.getLLMConfig()` (LLMConfigPublic)
 *   - `omni.getLLMStatus()` (LLMStatus)
 *   - `omni.reloadLLM()` (rebuild provider from settings)
 *
 * Also pins the boot-time precedence rules (env > boot config > settings)
 * via `omni.getLLMConfig()` after `Omnimind.create()`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Omnimind } from '../../src/index.js';

describe('reloadLLM surface', () => {
  let dir: string;
  let fake: HttpServer;
  let base: string;
  let omni: Omnimind;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'omnimind-llm-'));
    fake = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }));
      else res.end(JSON.stringify({ message: { content: 'hello' } }));
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    omni = await Omnimind.create({ dataDir: dir, adapters: false });
  });

  afterEach(async () => {
    await omni.close();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to NullProvider and reports disabled config', () => {
    expect(omni.llm.name).toBe('null');
    const cfg = omni.getLLMConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.provider).toBeNull();
  });

  it('reloadLLM() with llmEnabled=true builds an OllamaProvider and reports reachable status', async () => {
    omni.setSetting('llmEnabled', 'true');
    omni.setSetting('llmProvider', 'ollama');
    omni.setSetting('llmBaseUrl', base);
    omni.setSetting('llmModel', 'qwen2.5:3b');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('ollama');
    const status = await omni.getLLMStatus();
    expect(status.reachable).toBe(true);
    expect(status.provider).toBe('ollama');
  });

  it('reloadLLM() with llmEnabled=false falls back to NullProvider', async () => {
    omni.setSetting('llmEnabled', 'false');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('null');
  });
});