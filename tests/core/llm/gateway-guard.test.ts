/**
 * A company gateway (OMNIMIND_LLM_PROVIDER=openai) is reachable only when the
 * environment that runs omnimind allows it: a setting from the GUI cannot
 * turn summarization into a data flow to another host.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Omnimind } from '../../../src/index.js';

const KEYS = ['OMNIMIND_LLM_ENABLED', 'OMNIMIND_LLM_PROVIDER', 'OMNIMIND_LLM_BASE_URL', 'OMNIMIND_LLM_MODEL', 'OMNIMIND_LLM_API_KEY', 'OMNIMIND_LLM_ALLOW_REMOTE'];

describe('LLM gateway guard', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'omnimind-gw-')); });
  afterEach(() => { for (const k of KEYS) delete process.env[k]; rmSync(dir, { recursive: true, force: true }); });

  const env = (allow: boolean) => {
    process.env.OMNIMIND_LLM_ENABLED = 'true';
    process.env.OMNIMIND_LLM_PROVIDER = 'openai';
    process.env.OMNIMIND_LLM_BASE_URL = 'https://llm.example.com/v1';
    process.env.OMNIMIND_LLM_MODEL = 'MiniMax-M3.1-Flash';
    process.env.OMNIMIND_LLM_API_KEY = 'sk-person';
    if (allow) process.env.OMNIMIND_LLM_ALLOW_REMOTE = 'true';
  };

  it('refuses a remote gateway without OMNIMIND_LLM_ALLOW_REMOTE', async () => {
    env(false);
    const omni = await Omnimind.create({ dataDir: dir, adapters: false });
    expect(omni.llm.name).toBe('null');
    await omni.close();
  });

  it('uses the gateway with the person\'s key when the deployment allows it', async () => {
    env(true);
    const omni = await Omnimind.create({ dataDir: dir, adapters: false });
    expect(omni.llm.name).toBe('openai');
    expect(omni.llm.isConfigured()).toBe(true);
    // The key is never a setting the GUI could read back.
    const s = omni.getSettings();
    expect(JSON.stringify(s.ok ? s.value : {})).not.toContain('sk-person');
    await omni.close();
  });
});
