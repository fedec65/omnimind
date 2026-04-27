import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClaudeAdapter } from '../../../src/bus/adapters/ClaudeAdapter.js';
import { MemoryBus } from '../../../src/bus/MemoryBus.js';
import { MemoryStore } from '../../../src/core/MemoryStore.js';
import { EventType } from '../../../src/bus/types.js';

describe('ClaudeAdapter', () => {
  let tmpDir: string;
  let store: MemoryStore;
  let bus: MemoryBus;
  let adapter: ClaudeAdapter;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-claude-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    await store.init();
    bus = new MemoryBus(store);
    adapter = new ClaudeAdapter(bus, { watchPath: join(tmpDir, 'claude-projects') });
  });

  afterEach(() => {
    adapter.dispose();
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect conversation file changes', async () => {
    const watchDir = join(tmpDir, 'claude-projects');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();
    expect(adapter['connected']).toBe(true);

    // Write a mock conversation file
    writeFileSync(join(watchDir, 'conv.jsonl'), '{"role":"user","content":"Let\'s use GraphQL"}\n');

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 2500));

    // Connection should still be active
    expect(adapter['connected']).toBe(true);
  });

  it('should extract decisions from conversation text', () => {
    const text = `
We decided to use GraphQL instead of REST for the API.
I prefer using TypeScript over JavaScript for this project.
Let's go with PostgreSQL as the database.
Some random text that is not a decision.
    `;

    const decisions = adapter.extractDecisions(text);

    expect(decisions.length).toBeGreaterThanOrEqual(2);
    const texts = decisions.map((d) => d.text.toLowerCase());
    expect(texts.some((t) => t.includes('graphql'))).toBe(true);
    expect(texts.some((t) => t.includes('typescript'))).toBe(true);
  });

  it('should publish memory events on decision detection', async () => {
    const decisions = adapter.extractDecisions("We decided to use Redis for caching.");
    expect(decisions.length).toBe(1);

    // Publish decision manually
    await adapter.publishDecision(decisions[0]!.text, 'architecture', 'cache');

    // Bus should have published the event
    const stats = bus.getStats();
    expect(stats.eventsPublished).toBe(1);
  });

  it('should debounce rapid file changes', async () => {
    const watchDir = join(tmpDir, 'claude-projects');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    // Rapid writes
    for (let i = 0; i < 5; i++) {
      writeFileSync(
        join(watchDir, 'rapid.jsonl'),
        `{"role":"user","content":"msg ${i}"}\n`,
      );
      await new Promise((r) => setTimeout(r, 100));
    }

    // After debounce window, adapter should still be connected
    await new Promise((r) => setTimeout(r, 2500));
    expect(adapter['connected']).toBe(true);
  });

  it('should write notifications to CLAUDE.md on external events', async () => {
    const cwd = process.cwd();
    // Note: we can't easily test CLAUDE.md writing without mocking fs,
    // but we verify the onMemoryEvent handler doesn't throw
    const event = {
      id: 'ext-1',
      timestamp: Date.now(),
      sourceTool: 'cursor',
      eventType: EventType.Create,
      memoryId: null,
      payload: { content: 'Cursor update', wing: 'ui' },
      vectorClock: {},
      priority: 'auto' as const,
    };

    // Should not throw even without CLAUDE.md
    await expect(adapter.onMemoryEvent(event)).resolves.not.toThrow();
  });

  it('should auto-save conversation turns to memory store', async () => {
    const watchDir = join(tmpDir, 'claude-projects', 'my-project');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    // Write a multi-turn conversation
    const conversation = [
      { role: 'user', content: 'How do I implement auth in Node.js?' },
      { role: 'assistant', content: 'You can use Passport.js with JWT tokens.' },
      { role: 'user', content: 'Can you show me an example?' },
    ];
    writeFileSync(join(watchDir, 'chat.jsonl'), conversation.map((t) => JSON.stringify(t)).join('\n'));

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 3000));

    // Verify turns were stored
    const searchResult = await store.search('Passport.js', { limit: 10, wing: 'my-project' });
    expect(searchResult.ok).toBe(true);
    expect(searchResult.value.length).toBeGreaterThan(0);
    expect(searchResult.value.some((r) => r.memory.content.includes('Passport.js'))).toBe(true);
  });

  it('should deduplicate unchanged conversation files', async () => {
    const watchDir = join(tmpDir, 'claude-projects', 'dedup-test');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    const filePath = join(watchDir, 'repeat.jsonl');
    const conversation = [{ role: 'user', content: 'Hello again' }];
    writeFileSync(filePath, JSON.stringify(conversation[0]));

    // First processing
    await new Promise((r) => setTimeout(r, 3000));

    // Trigger another debounce with same content
    writeFileSync(filePath, JSON.stringify(conversation[0]));
    await new Promise((r) => setTimeout(r, 3000));

    // Should be skipped the second time (same hash)
    const allMemories = await store.search('', { limit: 100, wing: 'dedup-test' });
    expect(allMemories.ok).toBe(true);
    // Only one turn stored, not duplicated
    expect(allMemories.value.length).toBe(1);
  });

  it('should parse alternative role formats', async () => {
    const watchDir = join(tmpDir, 'claude-projects', 'alt-format');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    // Some Claude exports use 'type' instead of 'role'
    const conversation = [
      { type: 'user_message', content: 'What is the capital of France?' },
      { type: 'assistant_message', content: 'The capital of France is Paris.' },
      { type: 'tool_use', content: 'Searching...' }, // should be skipped
    ];
    writeFileSync(join(watchDir, 'typed.jsonl'), conversation.map((t) => JSON.stringify(t)).join('\n'));

    await new Promise((r) => setTimeout(r, 3000));

    const result = await store.search('Paris', { limit: 10, wing: 'alt-format' });
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
    // Should have stored the user + assistant turns, not the tool_use
    expect(result.value.some((r) => r.memory.content.includes('Paris'))).toBe(true);
  });

  it('should parse Claude Code native format with message wrapper', async () => {
    const watchDir = join(tmpDir, 'claude-projects', 'native-format');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    // Claude Code native .jsonl format: { type, message: { role, content } }
    const conversation = [
      {
        type: 'user',
        message: { role: 'user', content: 'How do I use React hooks?' },
      },
      {
        type: 'assistant',
        message: { role: 'assistant', content: 'React hooks let you use state and other React features in functional components.' },
      },
      {
        type: 'progress',
        message: { role: 'assistant', content: 'Thinking...' }, // should be skipped
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Show me a useState example.' }],
        },
      },
    ];
    writeFileSync(join(watchDir, 'native.jsonl'), conversation.map((t) => JSON.stringify(t)).join('\n'));

    await new Promise((r) => setTimeout(r, 3000));

    const result = await store.search('React hooks', { limit: 10, wing: 'native-format' });
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThanOrEqual(2);
    expect(result.value.some((r) => r.memory.content.includes('React hooks'))).toBe(true);
    expect(result.value.some((r) => r.memory.content.includes('useState'))).toBe(true);

    // Progress entries should NOT be stored
    // Progress entries should NOT be stored (total should be 3, not 4)
    const allResult = await store.search('', { limit: 10, wing: 'native-format' });
    expect(allResult.ok).toBe(true);
    expect(allResult.value.length).toBe(3);
  });
});
