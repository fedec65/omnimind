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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('reloadLLM() with a non-loopback URL falls back to NullProvider', async () => {
    omni.setSetting('llmEnabled', 'true');
    omni.setSetting('llmProvider', 'ollama');
    omni.setSetting('llmBaseUrl', 'https://api.openai.com/v1');
    omni.setSetting('llmModel', 'gpt-4');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('null');
    const status = await omni.getLLMStatus();
    expect(status.configured).toBe(false);
    expect(status.provider).toBe('null');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('getLLMStatus() reports unreachable for a running provider pointed at a closed port', async () => {
    const closed = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }));
    });
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    omni.setSetting('llmEnabled', 'true');
    omni.setSetting('llmProvider', 'ollama');
    omni.setSetting('llmBaseUrl', `http://127.0.0.1:${closedPort}`);
    omni.setSetting('llmModel', 'qwen2.5:3b');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('ollama');
    const status = await omni.getLLMStatus();
    expect(status.configured).toBe(true);
    expect(status.reachable).toBe(false);
  });

  it('disable + reloadLLM() returns the tool to the not-configured state', async () => {
    omni.setSetting('llmEnabled', 'true');
    omni.setSetting('llmProvider', 'ollama');
    omni.setSetting('llmModel', 'qwen2.5:3b');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('ollama');

    omni.setSetting('llmEnabled', 'false');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('null');
    const status = await omni.getLLMStatus();
    expect(status.configured).toBe(false);
  });

  it('reloadLLM() uses qwen2.5:3b default when Ollama model is unset', async () => {
    omni.setSetting('llmEnabled', 'true');
    omni.setSetting('llmProvider', 'ollama');
    omni.setSetting('llmBaseUrl', base);
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('ollama');
    const cfg = omni.getLLMConfig();
    expect(cfg.model).toBe('qwen2.5:3b');
  });
});

describe('boot-time LLM env vars', () => {
  let dir: string;
  let fake: HttpServer;
  let base: string;
  let omni: Omnimind | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'omnimind-llm-env-'));
    fake = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }));
      else res.end(JSON.stringify({ message: { content: 'hello' } }));
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (omni) await omni.close();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
    delete process.env.OMNIMIND_LLM_ENABLED;
    delete process.env.OMNIMIND_LLM_PROVIDER;
    delete process.env.OMNIMIND_LLM_BASE_URL;
    delete process.env.OMNIMIND_LLM_MODEL;
    delete process.env.OMNIMIND_LLM_TIMEOUT_MS;
  });

  it('enables Ollama from env vars without config.llm', async () => {
    process.env.OMNIMIND_LLM_ENABLED = 'true';
    process.env.OMNIMIND_LLM_PROVIDER = 'ollama';
    process.env.OMNIMIND_LLM_BASE_URL = base;
    process.env.OMNIMIND_LLM_MODEL = 'qwen2.5:3b';
    omni = await Omnimind.create({ dataDir: dir, adapters: false });
    expect(omni.llm.name).toBe('ollama');
    const cfg = omni.getLLMConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe('ollama');
    expect(cfg.model).toBe('qwen2.5:3b');
  });
});