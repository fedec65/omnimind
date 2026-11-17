import { describe, it, expect } from 'vitest';
import { memoriesToMarkdown } from '../../src/export/markdown.js';

describe('memoriesToMarkdown', () => {
  it('groups by wing and room, newest first, with dates and pins', () => {
    const md = memoriesToMarkdown([
      { content: 'Prefers offers as PDF.', wing: 'personal', room: 'preferences', createdAt: Date.UTC(2026, 10, 10), pinned: true },
      { content: 'Bosch quote: volumes per source.', wing: 'sales', room: 'bosch', createdAt: Date.UTC(2026, 10, 12) },
      { content: 'Newer preference:\nshort mails.', wing: 'personal', room: 'preferences', createdAt: Date.UTC(2026, 10, 15) },
    ]);
    expect(md).toContain('3 memories.');
    const p = md.indexOf('## personal / preferences');
    const s = md.indexOf('## sales / bosch');
    expect(p).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(p);
    expect(md.indexOf('Newer preference')).toBeLessThan(md.indexOf('Prefers offers'));
    expect(md).toContain('- **2026-11-10** (pinned) Prefers offers as PDF.');
    expect(md).toContain('Newer preference:\n  short mails.');
  });
});
