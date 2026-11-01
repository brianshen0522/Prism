import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../db/prism', () => ({
  prism: {
    backendServer: { findMany: vi.fn() },
    connection: { findMany: vi.fn() },
  },
}));

import { prism } from '../db/prism';
import { initializeServerHealth, shutdownServerHealth } from './health';

afterEach(() => {
  shutdownServerHealth();
  vi.useRealTimers();
});

describe('heartbeat ticks', () => {
  it('does not leave a rejection unhandled when the database is unavailable', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    vi.mocked(prism.backendServer.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prism.backendServer.findMany).mockRejectedValue(new Error('pool timeout'));

    try {
      await initializeServerHealth();
      await vi.advanceTimersByTimeAsync(5_000);
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));

      expect(prism.backendServer.findMany).toHaveBeenCalledTimes(2);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
