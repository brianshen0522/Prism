import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { signAccessToken } from '../lib/jwt';

vi.mock('../db/prism', () => ({
  prism: {
    $queryRawUnsafe: vi.fn(),
    systemSetting: {
      findUnique: vi.fn(),
    },
    backendServer: {
      findMany: vi.fn(),
    },
    connection: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../db/gazelle', () => ({
  gazelle: {
    gazelleUser: {
      findMany: vi.fn(),
    },
    gazelleInstitution: {
      findMany: vi.fn(),
    },
  },
}));

// Static file plugin needs a root that exists — stub it out
vi.mock('@fastify/static', () => ({
  default: async () => {},
}));

import { buildApp } from '../app';
import { prism } from '../db/prism';
import { gazelle } from '../db/gazelle';

// ─── Tokens ───────────────────────────────────────────────────────────────────

const adminToken = () => `Bearer ${signAccessToken({ sub: 1, username: 'admin', role: 'admin' })}`;
const monitorToken = () => `Bearer ${signAccessToken({ sub: 2, username: 'mon', role: 'monitor' })}`;
const oauth2Token = (sub = 30) => `Bearer ${signAccessToken({ sub, username: 'oauth', role: 'oauth2' })}`;
const userToken = (sub = 10, institutionId = 456) => `Bearer ${signAccessToken({
  sub,
  username: 'user',
  role: 'user',
  institutionId,
  institutionName: 'Taiwan Hospital',
})}`;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_CONN = {
  id: 'conn-1',
  userId: 10,
  institutionId: 456,
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
  participantTokenPresent: true,
  participantTokenValid: true,
  participantTokenInvalidReason: null,
  shareToken: 'share-conn-1',
  createdAt: new Date('2024-01-01T10:00:00Z'),
  server: { name: 'HAPI FHIR' },
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prism.$queryRawUnsafe).mockResolvedValue([]);
  vi.mocked(prism.systemSetting.findUnique).mockResolvedValue(null);
  vi.mocked(prism.backendServer.findMany).mockResolvedValue([]);
  vi.mocked(prism.connection.count).mockResolvedValue(1);
  vi.mocked(prism.connection.findMany).mockResolvedValue([MOCK_CONN] as any);
  vi.mocked(prism.connection.findUnique).mockResolvedValue(MOCK_CONN as any);
  vi.mocked(gazelle.gazelleUser.findMany).mockResolvedValue([
    { id: 10, username: 'alice', firstname: 'Alice', lastname: 'Chen', roles: [] },
  ] as any);
  vi.mocked(gazelle.gazelleInstitution.findMany).mockResolvedValue([
    { id: 456, name: 'Taiwan Hospital', keyword: 'TWH' },
  ] as any);
});

function findClause(where: any, key: string): any {
  if (!where || typeof where !== 'object') return undefined;
  if (key in where) return where[key];

  if (Array.isArray(where.AND)) {
    for (const item of where.AND) {
      const found = findClause(item, key);
      if (found !== undefined) return found;
    }
  }

  if (Array.isArray(where.OR)) {
    for (const item of where.OR) {
      const found = findClause(item, key);
      if (found !== undefined) return found;
    }
  }

  return undefined;
}

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
      user_name: 'Alice Chen',
      institution_id: 456,
      institution_name: 'Taiwan Hospital',
      participant_token_present: true,
      participant_token_valid: true,
      participant_token_invalid_reason: null,
    });
  });

  it('scopes query to current institution for non-privileged users', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections',
      headers: { authorization: userToken(10) },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'institutionId')).toBe(456);
    expect(findClause((callArg as any).where, 'userId')).toBe(10);
  });

  it('falls back to user scope when token has no institution', async () => {
    const legacyToken = `Bearer ${signAccessToken({ sub: 10, username: 'user', role: 'user' })}`;

    await app.inject({
      method: 'GET',
      url: '/api/connections',
      headers: { authorization: legacyToken },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'userId')).toBe(10);
    expect(findClause((callArg as any).where, 'institutionId')).toBeUndefined();
  });

  it('scopes query to current user for oauth2 users without institution when restriction is enabled', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?scope=all',
      headers: { authorization: oauth2Token(30) },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'userId')).toBe(30);
  });

  it('allows user role to request all traffic when restriction setting is disabled', async () => {
    vi.mocked(prism.systemSetting.findUnique).mockResolvedValue({ value: 'false' } as any);

    await app.inject({
      method: 'GET',
      url: '/api/connections?scope=all',
      headers: { authorization: userToken(10) },
    });

    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'userId')).toBeUndefined();
  });

  it('allows oauth2 role to request all traffic when restriction setting is disabled', async () => {
    vi.mocked(prism.systemSetting.findUnique).mockResolvedValue({ value: 'false' } as any);

    await app.inject({
      method: 'GET',
      url: '/api/connections?scope=all',
      headers: { authorization: oauth2Token(30) },
    });

    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'userId')).toBeUndefined();
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
    expect(findClause((callArg as any).where, 'serverId')).toBe('srv-1');
  });

  it('applies method filter (uppercased)', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?method=get',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'reqMethod')).toBe('GET');
  });

  it('applies status filter', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?status=error',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'status')).toBe('error');
  });

  it('allows admin to filter by user_id', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?user_id=42',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'userId')).toBe(42);
  });

  it('allows admin to filter by institution_id', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?institution_id=456',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'institutionId')).toBe(456);
  });

  it('ignores user_id filter for non-privileged users', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?user_id=99',
      headers: { authorization: userToken(10) },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'institutionId')).toBe(456);
    expect(findClause((callArg as any).where, 'userId')).toBe(10);
  });

  it('applies from/to date range', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/connections?from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z',
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    const range = findClause((callArg as any).where, 'reqTimestamp');
    expect(range).toHaveProperty('gte');
    expect(range).toHaveProperty('lte');
  });

  it('supports unified filters payload and OR logic', async () => {
    await app.inject({
      method: 'GET',
      url: `/api/connections?filters=${encodeURIComponent(JSON.stringify([
        { field: 'method', values: ['get'] },
        { field: 'status', values: ['error'], logic: 'or' },
      ]))}`,
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'OR')).toBeDefined();
    expect(findClause((callArg as any).where, 'reqMethod')).toBe('GET');
    expect(findClause((callArg as any).where, 'status')).toBe('error');
  });

  it('supports response status code filters', async () => {
    await app.inject({
      method: 'GET',
      url: `/api/connections?filters=${encodeURIComponent(JSON.stringify([
        { field: 'res_status_code', values: ['200'] },
      ]))}`,
      headers: { authorization: adminToken() },
    });
    const [callArg] = vi.mocked(prism.connection.findMany).mock.calls[0];
    expect(findClause((callArg as any).where, 'resStatusCode')).toBe(200);
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

describe('GET /api/connections/filter-options', () => {
  it('returns distinct status codes for authenticated users', async () => {
    vi.mocked(prism.connection.findMany).mockResolvedValue([
      { resStatusCode: 200 },
      { resStatusCode: 404 },
    ] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/connections/filter-options',
      headers: { authorization: adminToken() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status_codes: [200, 404] });
  });
});

describe('GET /api/institutions', () => {
  it('returns activated institutions for admin filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/institutions',
      headers: { authorization: adminToken() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 456, name: 'Taiwan Hospital', keyword: 'TWH' },
    ]);
    expect(gazelle.gazelleInstitution.findMany).toHaveBeenCalledWith({
      where: { activated: true },
      select: { id: true, name: true, keyword: true },
      orderBy: { name: 'asc' },
    });
  });

  it('denies regular users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/institutions',
      headers: { authorization: userToken() },
    });

    expect(res.statusCode).toBe(403);
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
    expect(body).toHaveProperty('user_name', 'Alice Chen');
    expect(body).toHaveProperty('institution_name', 'Taiwan Hospital');
    expect(body).toHaveProperty('participant_token_valid', true);
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
      headers: { authorization: userToken(99, 999) }, // different user and institution
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
