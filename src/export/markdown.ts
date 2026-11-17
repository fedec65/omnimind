// ─── A readable export of the whole memory ──────────────────────────────────
/** The whole memory as Markdown, grouped by wing and room, newest first. */
export function memoriesToMarkdown(memories: ReadonlyArray<Record<string, unknown>>): string {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const m of memories) {
    const key = `${String(m.wing ?? 'general')} / ${String(m.room ?? 'default')}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const when = (m: Record<string, unknown>) => Number(m.createdAt ?? 0);
  const lines = [`# My memory`, '', `Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, ${memories.length} memories.`, ''];
  for (const key of [...groups.keys()].sort()) {
    lines.push(`## ${key}`, '');
    for (const m of groups.get(key)!.sort((a, b) => when(b) - when(a))) {
      const date = when(m) > 0 ? new Date(when(m)).toISOString().slice(0, 10) : '';
      const text = String(m.content ?? '').replace(/\r?\n/g, '\n  ');
      lines.push(`- ${date ? `**${date}** ` : ''}${m.pinned ? '(pinned) ' : ''}${text}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
