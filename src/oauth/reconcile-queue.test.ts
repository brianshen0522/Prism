import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/prism', () => ({
  prism: { connection: { findUnique: vi.fn() } },
}));
vi.mock('../db/gazelle', () => ({ gazelle: {} }));

import { prism } from '../db/prism';
import { enqueueOAuthReconcile } from './reconcile';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('reconcile queue', () => {
  it('drains one batch at a time', async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    vi.mocked(prism.connection.findUnique).mockImplementation((() => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise((resolve) => {
        release.push(() => { active -= 1; resolve(null); });
      });
    }) as any);

    enqueueOAuthReconcile('first');
    await tick();
    enqueueOAuthReconcile('second');
    await tick();

    expect(release).toHaveLength(1);
    release[0]();
    await tick();
    expect(release).toHaveLength(2);
    release[1]();
    await tick();

    expect(peak).toBe(1);
    expect(prism.connection.findUnique).toHaveBeenCalledTimes(2);

    // The queue is usable again afterwards
    enqueueOAuthReconcile('third');
    await tick();
    expect(release).toHaveLength(3);
    release[2]();
  });
});
