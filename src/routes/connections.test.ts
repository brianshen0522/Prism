import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { signAccessToken } from '../lib/jwt';

vi.mock('../db/prism', () => ({
  prism: {
    connection: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// Static file plugin needs a root that exists — stub it out
vi.mock('@fastify/static', () => ({
  default: async () => {},
}));

import { buildApp } from '../app';
import { prism } from '../db/prism';

// ─── Tokens ───────────────────────────────────────────────────────────────────

const adminToken = () => `Bearer ${signAccessToken({ sub: 1, username: 'admin', role: 'admin' })}`;
const monitorToken = () => `Bearer ${signAccessToken({ sub: 2, username: 'mon', role: 'monitor' })}`;
const userToken = (sub = 10) => `Bearer ${signAccessToken({ sub, username: 'user', role: 'user' })}`;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_CONN = {
  id: 'conn-1',
  userId: 10,
  serverId: 'srv-1',
  status: 'completed',
  reqId: 'req-1',
  reqTimestamp: new Date('2024-01-01T10:00:00Z'),
  reqMethod: 'GET',
  reqUrl: '/fhir/Patient',
  reqHeaders: { accept: 'application/json' },
  reqBody: null,
  reqBodyTruncated: false,
  resId: 'res-1',
  resTimestamp: new Date('2024-01-01T10:00:00.200Z'),
  resStatusCode: 200,
  resHeaders: { 'content-type': 'application/json' },
  resBody: '{"resourceType":"Bundle"}',
  resBodyTruncated: false,
  durationMs: 200,
  createdAt: new Date('2024-01-01T10:00:00Z'),
  server: { name: 'HAPI FHIR' },
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prism.connection.count).mockResolvedValue(1);
  vi.mocked(prism.connection.findMany).mockResolvedValue([MOCK_CONN] as any);
  vi.mocked(prism.connection.findUnique).mockResolvedValue(MOCK_CONN as any);
});

// ─── GET /api/connections ─────────────────────────────────────────────────────

describe('GET /api/connections', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/connections' });
    expect(res.statusCode).toBe(401);
  });

  it('returns paginated list for authenticated user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/connections',
      headers: { authorization: userToken() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total', 1);
    expect(body).toHaveProperty('page', 1);
    expect(body.data[0]).toMatchObject({
      id: 'conn-1',
      req_method: 'GET',
      req_url: '/fhir/Patient',
      server_name: 'HAPI FHIR',
    });
  });

  it('scopes query to current user for non-privileged users', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections',
      headers: { authorization: userToken(10) },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect((callArg as any).where.userId).toBe(10);
  });

  it('does not scope query for admin', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect((callArg as any).where).not.toHaveProperty('userId');
  });

  it('applies server_id filter', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?server_id=srv-1',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect((callArg as any).where.serverId).toBe('srv-1');
  });

  it('applies method filter (uppercased)', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?method=get',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect((callArg as any).where.reqMethod).toBe('GET');
  });

  it('applies status filter', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?status=error',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect((callArg as any).where.status).toBe('error');
  });

  it('allows admin to filter by user_id', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?user_id=42',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect((callArg as any).where.userId).toBe(42);
  });

  it('ignores user_id filter for non-privileged users', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?user_id=99',
      headers: { authorization: userToken(10) },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    // user always filtered to their own id, not the supplied user_id
    expect((callArg as any).where.userId).toBe(10);
  });

  it('applies from/to date range', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect((callArg as any).where.reqTimestamp).toHaveProperty('gte');
    expect((callArg as any).where.reqTimestamp).toHaveProperty('lte');
  });

  it('honours page and limit', async () => {
    vi.mocked(prism.connection.count).mockResolvedValue(200);
    await app.inject({
      method: 'GET',
      url: '/api/connections?page=3&limit=10',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect((callArg as any).skip).toBe(20);
    expect((callArg as any).take).toBe(10);
  });
});

// ─── GET /api/connections/:id ─────────────────────────────────────────────────

describe('GET /api/connections/:id', () => {
  it('returns full detail for the owner', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/connections/conn-1',
      headers: { authorization: userToken(10) }, // userId 10 matches MOCK_CONN.userId
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('req_headers');
    expect(body).toHaveProperty('res_body');
    expect(body).toHaveProperty('res_status_code', 200);
  });

  it('allows admin to view any connection', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/connections/conn-1',
      headers: { authorization: adminToken() },
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows monitor to view any connection', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/connections/conn-1',
      headers: { authorization: monitorToken() },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when a different user requests another user connection', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/connections/conn-1',
      headers: { authorization: userToken(99) }, // different user
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when connection not found', async () => {
    vi.mocked(prism.connection.findUnique).mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/api/connections/nonexistent',
      headers: { authorization: adminToken() },
    });
    expect(res.statusCode).toBe(404);
  });
});
