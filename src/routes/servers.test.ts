import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../db/prism', () => ({
  prism: {
    backendServer: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../proxy/manager', () => ({
  proxyManager: {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
    getNextAvailablePort: vi.fn().mockResolvedValue(7001),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
}));

import { buildApp } from '../app';
import { signAccessToken } from '../lib/jwt';
import { prism } from '../db/prism';
import { proxyManager } from '../proxy/manager';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_SERVER = {
  id: 'server-uuid-1',
  name: 'HAPI FHIR TW',
  targetUrl: 'https://hapi.fhir.tw/',
  isHttps: true,
  sslVerify: true,
  proxyPort: 7001,
  isActive: true,
  bodySizeLimitKb: null,
  createdBy: 1,
  createdAt: new Date('2026-04-02T00:00:00Z'),
};

const MOCK_SERVER_2 = {
  ...MOCK_SERVER,
  id: 'server-uuid-2',
  name: 'FHIR Server B',
  proxyPort: 7002,
};

function adminToken() {
  return `Bearer ${signAccessToken({ sub: 1, username: 'admin', role: 'admin' })}`;
}

function monitorToken() {
  return `Bearer ${signAccessToken({ sub: 2, username: 'monitor', role: 'monitor' })}`;
}

function userToken() {
  return `Bearer ${signAccessToken({ sub: 3, username: 'user', role: 'user' })}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Server routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(proxyManager.start).mockResolvedValue(undefined);
    vi.mocked(proxyManager.stop).mockResolvedValue(undefined);
    vi.mocked(proxyManager.restart).mockResolvedValue(undefined);
    vi.mocked(proxyManager.isRunning).mockReturnValue(true);
    vi.mocked(proxyManager.getNextAvailablePort).mockResolvedValue(7001);
  });

  // ── GET /api/servers ───────────────────────────────────────────────────────

  describe('GET /api/servers', () => {
    it('returns active servers for any authenticated user', async () => {
      vi.mocked(prism.backendServer.findMany).mockResolvedValue([MOCK_SERVER] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/servers',
        headers: { authorization: userToken() },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: 'server-uuid-1', name: 'HAPI FHIR TW', proxy_port: 7001 });
      expect(body[0].target_url).toBeUndefined(); // not exposed to regular users
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/servers' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /api/admin/servers ─────────────────────────────────────────────────

  describe('GET /api/admin/servers', () => {
    it('returns full detail for admin', async () => {
      vi.mocked(prism.backendServer.findMany).mockResolvedValue([MOCK_SERVER, MOCK_SERVER_2] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/servers',
        headers: { authorization: adminToken() },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0]).toMatchObject({
        id: 'server-uuid-1',
        target_url: 'https://hapi.fhir.tw/',
        proxy_port: 7001,
        is_running: true,
      });
    });

    it('returns 403 for monitor', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/servers',
        headers: { authorization: monitorToken() },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for regular user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/servers',
        headers: { authorization: userToken() },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── POST /api/admin/servers ────────────────────────────────────────────────

  describe('POST /api/admin/servers', () => {
    it('creates server with auto-assigned port', async () => {
      vi.mocked(proxyManager.getNextAvailablePort).mockResolvedValue(7001);
      vi.mocked(prism.backendServer.findFirst).mockResolvedValue(null);
      vi.mocked(prism.backendServer.create).mockResolvedValue(MOCK_SERVER as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers',
        headers: { authorization: adminToken() },
        payload: { name: 'FHIR Server A', target_url: 'http://192.168.1.10:8080' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'HAPI FHIR TW', proxy_port: 7001 });
      expect(vi.mocked(proxyManager.start)).toHaveBeenCalledOnce();
    });

    it('creates server with specific port when available', async () => {
      vi.mocked(prism.backendServer.findFirst).mockResolvedValue(null); // port not in use
      vi.mocked(prism.backendServer.create).mockResolvedValue({ ...MOCK_SERVER, proxyPort: 7050 } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers',
        headers: { authorization: adminToken() },
        payload: { name: 'FHIR Server A', target_url: 'http://192.168.1.10:8080', proxy_port: 7050 },
      });

      expect(res.statusCode).toBe(201);
    });

    it('returns 409 when requested port is already in use', async () => {
      vi.mocked(prism.backendServer.findFirst).mockResolvedValue(MOCK_SERVER as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers',
        headers: { authorization: adminToken() },
        payload: { name: 'New Server', target_url: 'http://10.0.0.1:8080', proxy_port: 7001 },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain('7001');
    });

    it('returns 507 when no ports are available', async () => {
      vi.mocked(proxyManager.getNextAvailablePort).mockRejectedValue(
        new Error('No available proxy ports in range 7001–7100'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers',
        headers: { authorization: adminToken() },
        payload: { name: 'New Server', target_url: 'http://10.0.0.1:8080' },
      });

      expect(res.statusCode).toBe(507);
    });

    it('returns 400 for invalid body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers',
        headers: { authorization: adminToken() },
        payload: { name: '' }, // missing target_url, empty name
      });
      expect(res.statusCode).toBe(400);
    });

    it('deactivates server in DB if listener fails to start', async () => {
      vi.mocked(prism.backendServer.findFirst).mockResolvedValue(null);
      vi.mocked(prism.backendServer.create).mockResolvedValue(MOCK_SERVER as any);
      vi.mocked(prism.backendServer.update).mockResolvedValue({ ...MOCK_SERVER, isActive: false } as any);
      vi.mocked(proxyManager.start).mockRejectedValue(new Error('EADDRINUSE'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers',
        headers: { authorization: adminToken() },
        payload: { name: 'FHIR Server A', target_url: 'http://192.168.1.10:8080' },
      });

      expect(res.statusCode).toBe(500);
      expect(vi.mocked(prism.backendServer.update)).toHaveBeenCalledWith({
        where: { id: 'server-uuid-1' },
        data: { isActive: false },
      });
    });
  });

  // ── GET /api/admin/servers/:id ─────────────────────────────────────────────

  describe('GET /api/admin/servers/:id', () => {
    it('returns server detail', async () => {
      vi.mocked(prism.backendServer.findUnique).mockResolvedValue(MOCK_SERVER as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/servers/server-uuid-1',
        headers: { authorization: adminToken() },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: 'server-uuid-1', name: 'HAPI FHIR TW' });
    });

    it('returns 404 when not found', async () => {
      vi.mocked(prism.backendServer.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/servers/nonexistent',
        headers: { authorization: adminToken() },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── PUT /api/admin/servers/:id ─────────────────────────────────────────────

  describe('PUT /api/admin/servers/:id', () => {
    it('updates name without touching listener', async () => {
      vi.mocked(prism.backendServer.findUnique).mockResolvedValue(MOCK_SERVER as any);
      vi.mocked(prism.backendServer.update).mockResolvedValue({ ...MOCK_SERVER, name: 'Updated' } as any);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/servers/server-uuid-1',
        headers: { authorization: adminToken() },
        payload: { name: 'Updated' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Updated');
      expect(vi.mocked(proxyManager.stop)).not.toHaveBeenCalled();
      expect(vi.mocked(proxyManager.start)).not.toHaveBeenCalled();
      expect(vi.mocked(proxyManager.restart)).not.toHaveBeenCalled();
    });

    it('stops listener when deactivating', async () => {
      vi.mocked(prism.backendServer.findUnique).mockResolvedValue(MOCK_SERVER as any);
      vi.mocked(prism.backendServer.update).mockResolvedValue({ ...MOCK_SERVER, isActive: false } as any);

      await app.inject({
        method: 'PUT',
        url: '/api/admin/servers/server-uuid-1',
        headers: { authorization: adminToken() },
        payload: { is_active: false },
      });

      expect(vi.mocked(proxyManager.stop)).toHaveBeenCalledWith('server-uuid-1');
    });

    it('starts listener when reactivating', async () => {
      const inactiveServer = { ...MOCK_SERVER, isActive: false };
      vi.mocked(prism.backendServer.findUnique).mockResolvedValue(inactiveServer as any);
      vi.mocked(prism.backendServer.update).mockResolvedValue(MOCK_SERVER as any);

      await app.inject({
        method: 'PUT',
        url: '/api/admin/servers/server-uuid-1',
        headers: { authorization: adminToken() },
        payload: { is_active: true },
      });

      expect(vi.mocked(proxyManager.start)).toHaveBeenCalled();
    });

    it('restarts listener when target_url changes', async () => {
      vi.mocked(prism.backendServer.findUnique).mockResolvedValue(MOCK_SERVER as any);
      vi.mocked(prism.backendServer.update).mockResolvedValue({
        ...MOCK_SERVER,
        targetUrl: 'http://10.0.0.2:9090',
      } as any);

      await app.inject({
        method: 'PUT',
        url: '/api/admin/servers/server-uuid-1',
        headers: { authorization: adminToken() },
        payload: { target_url: 'http://10.0.0.2:9090' },
      });

      expect(vi.mocked(proxyManager.restart)).toHaveBeenCalled();
    });

    it('returns 404 when server not found', async () => {
      vi.mocked(prism.backendServer.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/servers/nonexistent',
        headers: { authorization: adminToken() },
        payload: { name: 'X' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/admin/servers/:id ──────────────────────────────────────────

  describe('DELETE /api/admin/servers/:id', () => {
    it('stops listener and deletes server', async () => {
      vi.mocked(prism.backendServer.findUnique).mockResolvedValue(MOCK_SERVER as any);
      vi.mocked(prism.backendServer.delete).mockResolvedValue(MOCK_SERVER as any);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/servers/server-uuid-1',
        headers: { authorization: adminToken() },
      });

      expect(res.statusCode).toBe(204);
      expect(vi.mocked(proxyManager.stop)).toHaveBeenCalledWith('server-uuid-1');
      expect(vi.mocked(prism.backendServer.delete)).toHaveBeenCalledWith({
        where: { id: 'server-uuid-1' },
      });
    });

    it('returns 404 when server not found', async () => {
      vi.mocked(prism.backendServer.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/servers/nonexistent',
        headers: { authorization: adminToken() },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/admin/servers/export ─────────────────────────────────────────

  describe('GET /api/admin/servers/export', () => {
    it('returns JSON export with correct envelope', async () => {
      vi.mocked(prism.backendServer.findMany).mockResolvedValue([MOCK_SERVER] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/servers/export',
        headers: { authorization: adminToken() },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.export_version).toBe('1.0');
      expect(body.system).toBe('Prism');
      expect(body.exported_by).toBe('admin');
      expect(body.servers).toHaveLength(1);
      expect(body.servers[0]).toMatchObject({
        export_id: 'server-uuid-1',
        name: 'HAPI FHIR TW',
        target_url: 'https://hapi.fhir.tw/',
        proxy_port: 7001,
      });
      // Runtime IDs should not be exported as top-level `id`
      expect(body.servers[0].id).toBeUndefined();
    });

    it('is not accidentally caught by /:id route', async () => {
      // This would 404 if "export" were treated as an :id param
      vi.mocked(prism.backendServer.findMany).mockResolvedValue([] as any);
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/servers/export',
        headers: { authorization: adminToken() },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── POST /api/admin/servers/import ────────────────────────────────────────

  describe('POST /api/admin/servers/import', () => {
    const validImport = {
      export_version: '1.0',
      system: 'Prism',
      servers: [
        { name: 'FHIR Server A', target_url: 'http://192.168.1.10:8080', proxy_port: 7001 },
        { name: 'FHIR Server B', target_url: 'http://192.168.1.11:8080' },
      ],
    };

    it('imports servers and returns created count', async () => {
      vi.mocked(prism.backendServer.findFirst).mockResolvedValue(null); // no port conflicts
      vi.mocked(prism.backendServer.create)
        .mockResolvedValueOnce(MOCK_SERVER as any)
        .mockResolvedValueOnce(MOCK_SERVER_2 as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers/import',
        headers: { authorization: adminToken() },
        payload: validImport,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.created).toBe(2);
      expect(body.warnings).toHaveLength(0);
      expect(body.servers).toHaveLength(2);
    });

    it('reassigns conflicting port and adds warning', async () => {
      vi.mocked(prism.backendServer.findFirst).mockResolvedValueOnce(MOCK_SERVER as any); // port 7001 in use
      vi.mocked(proxyManager.getNextAvailablePort).mockResolvedValue(7099);
      vi.mocked(prism.backendServer.create).mockResolvedValue(MOCK_SERVER as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers/import',
        headers: { authorization: adminToken() },
        payload: {
          export_version: '1.0',
          system: 'Prism',
          servers: [{ name: 'New Server', target_url: 'http://10.0.0.1:8080', proxy_port: 7001 }],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.warnings).toHaveLength(1);
      expect(body.warnings[0]).toContain('7001');
      expect(body.warnings[0]).toContain('7099');
    });

    it('returns 400 for invalid import format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers/import',
        headers: { authorization: adminToken() },
        payload: { servers: 'not-an-array' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().details.issues).toBeDefined();
    });

    it('returns 400 when system field is not Prism', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers/import',
        headers: { authorization: adminToken() },
        payload: { export_version: '1.0', system: 'OtherTool', servers: [] },
      });

      expect(res.statusCode).toBe(400);
    });

    it('normalizes imported URLs that include a path and returns a warning', async () => {
      vi.mocked(prism.backendServer.findFirst).mockResolvedValue(null);
      vi.mocked(prism.backendServer.create).mockResolvedValue(MOCK_SERVER as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers/import',
        headers: { authorization: adminToken() },
        payload: {
          export_version: '1.0',
          system: 'Prism',
          servers: [
            {
              name: 'Imported Server',
              target_url: 'https://example.org/some/path?x=1',
              heartbeat_url: 'https://public.example.org/health/live',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(vi.mocked(prism.backendServer.create).mock.calls[0][0]).toMatchObject({
        data: expect.objectContaining({
          targetUrl: 'https://example.org/',
          heartbeatUrl: 'https://public.example.org/',
        }),
      });
      expect(res.json().warnings[0]).toContain('normalized');
    });

    it('skips importing an identical server configuration that already exists', async () => {
      vi.mocked(prism.backendServer.findMany).mockResolvedValue([MOCK_SERVER] as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers/import',
        headers: { authorization: adminToken() },
        payload: {
          export_version: '1.0',
          system: 'Prism',
          servers: [
            {
              name: 'HAPI FHIR TW',
              target_url: 'https://hapi.fhir.tw/',
              is_https: true,
              ssl_verify: true,
              is_active: true,
              proxy_port: 7001,
              export_id: 'server-uuid-1',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().created).toBe(0);
      expect(res.json().warnings[0]).toContain('identical server configuration already exists');
      expect(vi.mocked(prism.backendServer.create)).not.toHaveBeenCalled();
    });
  });

  // ── hapi.fhir.tw backend server scenarios ─────────────────────────────────

  describe('hapi.fhir.tw backend server', () => {
    const HAPI_SERVER = {
      id: 'hapi-uuid-1',
      name: 'HAPI FHIR TW',
      targetUrl: 'https://hapi.fhir.tw/',
      isHttps: true,
      sslVerify: true,
      proxyPort: 7001,
      isActive: true,
      bodySizeLimitKb: null,
      createdBy: 1,
      createdAt: new Date('2026-04-02T00:00:00Z'),
    };

    it('creates HAPI FHIR TW server with is_https=true', async () => {
      vi.mocked(prism.backendServer.findFirst).mockResolvedValue(null);
      vi.mocked(prism.backendServer.create).mockResolvedValue(HAPI_SERVER as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers',
        headers: { authorization: adminToken() },
        payload: {
          name: 'HAPI FHIR TW',
          target_url: 'https://hapi.fhir.tw/',
          is_https: true,
          ssl_verify: true,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        name: 'HAPI FHIR TW',
        target_url: 'https://hapi.fhir.tw/',
        is_https: true,
        ssl_verify: true,
      });
    });

    it('creates HAPI FHIR TW with ssl_verify=false for self-signed certs', async () => {
      vi.mocked(prism.backendServer.findFirst).mockResolvedValue(null);
      vi.mocked(prism.backendServer.create).mockResolvedValue({
        ...HAPI_SERVER,
        sslVerify: false,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers',
        headers: { authorization: adminToken() },
        payload: {
          name: 'HAPI FHIR TW',
          target_url: 'https://hapi.fhir.tw/',
          is_https: true,
          ssl_verify: false,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().ssl_verify).toBe(false);
    });

    it('imports HAPI FHIR TW via import endpoint', async () => {
      vi.mocked(prism.backendServer.findFirst).mockResolvedValue(null);
      vi.mocked(prism.backendServer.create).mockResolvedValue(HAPI_SERVER as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/servers/import',
        headers: { authorization: adminToken() },
        payload: {
          export_version: '1.0',
          system: 'Prism',
          servers: [
            {
              name: 'HAPI FHIR TW',
              target_url: 'https://hapi.fhir.tw/',
              is_https: true,
              ssl_verify: true,
              proxy_port: 7001,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().servers[0]).toMatchObject({
        name: 'HAPI FHIR TW',
        target_url: 'https://hapi.fhir.tw/',
      });
    });

    it('appears in the public server list when active', async () => {
      vi.mocked(prism.backendServer.findMany).mockResolvedValue([HAPI_SERVER] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/servers',
        headers: { authorization: userToken() },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()[0]).toMatchObject({ name: 'HAPI FHIR TW', proxy_port: 7001 });
    });

    it('appears in JSON export with correct fields', async () => {
      vi.mocked(prism.backendServer.findMany).mockResolvedValue([HAPI_SERVER] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/servers/export',
        headers: { authorization: adminToken() },
      });

      expect(res.statusCode).toBe(200);
      const exported = res.json().servers[0];
      expect(exported).toMatchObject({
        export_id: 'hapi-uuid-1',
        name: 'HAPI FHIR TW',
        target_url: 'https://hapi.fhir.tw/',
        is_https: true,
        proxy_port: 7001,
      });
    });
  });
});
