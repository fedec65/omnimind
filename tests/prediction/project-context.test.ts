import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { ActivityTracker } from '../../src/prediction/ActivityTracker.js';

const h = (s: string) => createHash('sha256').update(s).digest('hex').substring(0, 8);

describe('ActivityTracker project context from the agent', () => {
  it('fingerprints the project and branch the agent reported, not the server cwd', () => {
    const predictor = { recordAccess: () => {} } as never;
    const bus = { subscribe: () => () => {}, unsubscribe: () => {} } as never;
    const t = new ActivityTracker(predictor, bus, { watchDir: '/opt/omnimind' });
    expect(t.getCurrentFingerprint().projectHash).toBe(h('/opt/omnimind'));
    t.setProjectContext('/home/coder/repos/bosch-offer', 'feat/pricing');
    const f = t.getCurrentFingerprint();
    expect(f.projectHash).toBe(h('/home/coder/repos/bosch-offer'));
    expect(f.branchHash).toBe(h('feat/pricing'));
  });
});
