import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/prism', () => ({
  prism: {
    connection: { count: vi.fn() },
    backendServer: { count: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('./manager', () => ({
  wsManager: {
    emitDashboardStats: vi.fn(),
    emitServerHealth: vi.fn(),
  },
}));

import { computeAndEmitDashboardStats, computeAndEmitServerHealth } from './stats';
import { prism } from '../db/prism';
import { wsManager } from './manager';

beforeEach(() => vi.clearAllMocks());

// ─── computeAndEmitDashboardStats ─────────────────────────────────────────────

describe('computeAndEmitDashboardStats', () => {
  it('emits correct stats when there are no errors', async () => {
    vi.mocked(prism.connection.count)
      .mockResolvedValueOnce(500)   // totalRequests
      .mockResolvedValueOnce(20)    // requestsLast5m
      .mockResolvedValueOnce(0);    // errorsLast5m
    vi.mocked(prism.backendServer.count).mockResolvedValue(3);

    await computeAndEmitDashboardStats();

    expect(wsManager.emitDashboardStats).toHaveBeenCalledWith({
      totalRequests: 500,
      activeServers: 3,
      requestsLast5m: 20,
      errorRate: 0,
    });
  });

  it('computes errorRate correctly', async () => {
    vi.mocked(prism.connection.count)
      .mockResolvedValueOnce(1000)  // totalRequests
      .mockResolvedValueOnce(40)    // requestsLast5m
      .mockResolvedValueOnce(8);    // errorsLast5m  → 8/40 = 0.2
    vi.mocked(prism.backendServer.count).mockResolvedValue(2);

    await computeAndEmitDashboardStats();

    expect(wsManager.emitDashboardStats).toHaveBeenCalledWith(
      expect.objectContaining({ errorRate: 0.2 }),
    );
  });

  it('sets errorRate to 0 when requestsLast5m is 0 (avoids division by zero)', async () => {
    vi.mocked(prism.connection.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    vi.mocked(prism.backendServer.count).mockResolvedValue(0);

    await computeAndEmitDashboardStats();

    expect(wsManager.emitDashboardStats).toHaveBeenCalledWith(
      expect.objectContaining({ errorRate: 0 }),
    );
  });

  it('queries with a timestamp filter for the 5-minute window', async () => {
    vi.mocked(prism.connection.count).mockResolvedValue(0);
    vi.mocked(prism.backendServer.count).mockResolvedValue(0);

    const before = Date.now();
    await computeAndEmitDashboardStats();

    // The second and third count() calls should have a `gte` filter
    const calls = vi.mocked(prism.connection.count).mock.calls;
    const windowCall = calls[1][0] as any;
    expect(windowCall.where.reqTimestamp.gte).toBeInstanceOf(Date);
    expect(windowCall.where.reqTimestamp.gte.getTime()).toBeGreaterThanOrEqual(before - 5 * 60 * 1000 - 100);
  });
});

// ─── computeAndEmitServerHealth ───────────────────────────────────────────────

describe('computeAndEmitServerHealth', () => {
  it('emits health for each active server', async () => {
    vi.mocked(prism.backendServer.findMany).mockResolvedValue([
      { id: 'srv-1' },
      { id: 'srv-2' },
    ] as any);
    vi.mocked(prism.connection.count)
      .mockResolvedValueOnce(5)   // srv-1 requests
      .mockResolvedValueOnce(12); // srv-2 requests

    await computeAndEmitServerHealth();

    expect(wsManager.emitServerHealth).toHaveBeenCalledTimes(2);
    expect(wsManager.emitServerHealth).toHaveBeenCalledWith('srv-1', { isRunning: true, requestsLast5m: 5 });
    expect(wsManager.emitServerHealth).toHaveBeenCalledWith('srv-2', { isRunning: true, requestsLast5m: 12 });
  });

  it('emits nothing when there are no active servers', async () => {
    vi.mocked(prism.backendServer.findMany).mockResolvedValue([]);

    await computeAndEmitServerHealth();

    expect(wsManager.emitServerHealth).not.toHaveBeenCalled();
  });

  it('queries connections per server with a 5-minute timestamp filter', async () => {
    vi.mocked(prism.backendServer.findMany).mockResolvedValue([{ id: 'srv-x' }] as any);
    vi.mocked(prism.connection.count).mockResolvedValue(3);

    await computeAndEmitServerHealth();

    const [countArg] = vi.mocked(prism.connection.count).mock.calls[0];
    expect((countArg as any).where.serverId).toBe('srv-x');
    expect((countArg as any).where.reqTimestamp.gte).toBeInstanceOf(Date);
  });
});
