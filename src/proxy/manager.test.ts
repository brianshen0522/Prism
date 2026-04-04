import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

vi.mock('../db/prism', () => ({
  prism: {
    backendServer: {
      findMany: vi.fn(),
    },
  },
}));

// Import after mocking so config side-effects have already run via vitest env
import { ProxyManager } from './manager';
import { prism } from '../db/prism';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeServer(overrides: Partial<{ id: string; proxyPort: number; targetUrl: string; name: string; isActive: boolean; isHttps: boolean; sslVerify: boolean; bodySizeLimitKb: null; createdBy: number; createdAt: Date }> = {}) {
  return {
    id: 'srv-test-1',
    name: 'Test Server',
    targetUrl: 'http://127.0.0.1:9999',
    isHttps: false,
    sslVerify: true,
    proxyPort: 0,      // 0 → OS picks a free port
    isActive: true,
    bodySizeLimitKb: null,
    createdBy: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

// ─── start / stop / isRunning ─────────────────────────────────────────────────

describe('ProxyManager lifecycle', () => {
  it('starts a listener and marks it as running', async () => {
    const mgr = new ProxyManager();
    const server = makeServer();
    await mgr.start(server as any);

    expect(mgr.isRunning(server.id)).toBe(true);
    await mgr.stop(server.id);
  });

  it('stop removes the listener', async () => {
    const mgr = new ProxyManager();
    const server = makeServer();
    await mgr.start(server as any);
    await mgr.stop(server.id);

    expect(mgr.isRunning(server.id)).toBe(false);
  });

  it('calling start twice for the same id is a no-op', async () => {
    const mgr = new ProxyManager();
    const server = makeServer();
    await mgr.start(server as any);
    await mgr.start(server as any); // should not throw

    expect(mgr.isRunning(server.id)).toBe(true);
    await mgr.stop(server.id);
  });

  it('stop on a non-running server is a no-op', async () => {
    const mgr = new ProxyManager();
    await expect(mgr.stop('nonexistent')).resolves.toBeUndefined();
  });

  it('isRunning returns false for unknown id', () => {
    const mgr = new ProxyManager();
    expect(mgr.isRunning('unknown')).toBe(false);
  });

  it('restart starts a fresh listener', async () => {
    const mgr = new ProxyManager();
    const server = makeServer();
    await mgr.start(server as any);
    await mgr.restart(server as any);

    expect(mgr.isRunning(server.id)).toBe(true);
    await mgr.stop(server.id);
  });
});

// ─── shutdown ─────────────────────────────────────────────────────────────────

describe('ProxyManager.shutdown', () => {
  it('stops all running listeners', async () => {
    const mgr = new ProxyManager();
    const s1 = makeServer({ id: 'a' });
    const s2 = makeServer({ id: 'b' });
    await mgr.start(s1 as any);
    await mgr.start(s2 as any);

    await mgr.shutdown();

    expect(mgr.isRunning('a')).toBe(false);
    expect(mgr.isRunning('b')).toBe(false);
  });
});

// ─── getNextAvailablePort ─────────────────────────────────────────────────────

describe('ProxyManager.getNextAvailablePort', () => {
  it('returns the first port in range when none are used', async () => {
    vi.mocked(prism.backendServer.findMany).mockResolvedValue([]);
    const mgr = new ProxyManager();
    const port = await mgr.getNextAvailablePort();
    expect(port).toBe(7001); // portStart from config defaults
  });

  it('skips ports that are already in the DB', async () => {
    vi.mocked(prism.backendServer.findMany).mockResolvedValue([
      { proxyPort: 7001 },
      { proxyPort: 7002 },
    ] as any);
    const mgr = new ProxyManager();
    const port = await mgr.getNextAvailablePort();
    expect(port).toBe(7003);
  });

  it('throws when every port in the range is occupied', async () => {
    // Fill 7001–7100 (100 ports)
    const rows = Array.from({ length: 100 }, (_, i) => ({ proxyPort: 7001 + i }));
    vi.mocked(prism.backendServer.findMany).mockResolvedValue(rows as any);
    const mgr = new ProxyManager();
    await expect(mgr.getNextAvailablePort()).rejects.toThrow();
  });
});

// ─── init ─────────────────────────────────────────────────────────────────────

describe('ProxyManager.init', () => {
  it('starts listeners for all active servers', async () => {
    const s1 = makeServer({ id: 'init-a', proxyPort: 0 });
    const s2 = makeServer({ id: 'init-b', proxyPort: 0 });
    vi.mocked(prism.backendServer.findMany).mockResolvedValue([s1, s2] as any);

    const mgr = new ProxyManager();
    await mgr.init();

    expect(mgr.isRunning('init-a')).toBe(true);
    expect(mgr.isRunning('init-b')).toBe(true);
    await mgr.shutdown();
  });

  it('continues if one server fails to start', async () => {
    const good = makeServer({ id: 'good' });
    // port 1 is privileged — will fail to bind
    const bad  = makeServer({ id: 'bad', proxyPort: 1 });
    vi.mocked(prism.backendServer.findMany).mockResolvedValue([bad, good] as any);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mgr = new ProxyManager();
    await mgr.init(); // must not throw
    errSpy.mockRestore();

    expect(mgr.isRunning('good')).toBe(true);
    expect(mgr.isRunning('bad')).toBe(false);
    await mgr.shutdown();
  });
});
