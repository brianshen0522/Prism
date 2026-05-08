import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signAccessToken } from '../lib/jwt';

vi.mock('../db/prism', () => ({
  prism: {
    backendServer: {
      findMany: vi.fn(),
    },
    systemSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../db/gazelle', () => ({
  gazelle: {
    gazelleUser: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@fastify/static', () => ({
  default: async () => {},
}));

import { buildApp } from '../app';
import { prism } from '../db/prism';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const adminTok = () => `Bearer ${signAccessToken({ sub: 1, username: 'admin', role: 'admin' })}`;
const userTok = () => `Bearer ${signAccessToken({ sub: 10, username: 'user', role: 'user' })}`;
const oauth2Tok = () => `Bearer ${signAccessToken({ sub: 30, username: 'oauth', role: 'oauth2' })}`;

const MOCK_SETTING = {
  key: 'default_body_size_limit_kb',
  value: '512',
  updatedBy: 1,
  updatedAt: new Date('2024-06-01'),
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prism.backendServer.findMany).mockResolvedValue([]);
  vi.mocked(prism.systemSetting.findUnique).mockResolvedValue(null);
});

// ─── GET /api/settings/traffic-access ─────────────────────────────────────────

describe('GET /api/settings/traffic-access', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/traffic-access' });
    expect(res.statusCode).toBe(401);
  });

  it('defaults user traffic restriction to enabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/traffic-access',
      headers: { authorization: userTok() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ restrict_user_traffic_to_own: true, can_view_all_traffic: false });
  });

  it('also restricts oauth2 traffic access by default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/traffic-access',
      headers: { authorization: oauth2Tok() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ restrict_user_traffic_to_own: true, can_view_all_traffic: false });
  });

  it('returns configured user traffic restriction', async () => {
    vi.mocked(prism.systemSetting.findUnique).mockResolvedValue({ value: 'false' } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/traffic-access',
      headers: { authorization: userTok() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ restrict_user_traffic_to_own: false, can_view_all_traffic: true });
  });
});

// ─── GET /api/admin/settings ──────────────────────────────────────────────────

describe('GET /api/admin/settings', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { authorization: userTok() },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns settings list for admin', async () => {
    vi.mocked(prism.systemSetting.findMany).mockResolvedValue([MOCK_SETTING] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { authorization: adminTok() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ key: 'default_body_size_limit_kb', value: '512' });
    expect(body[0]).toHaveProperty('updated_at');
  });
});

// ─── PUT /api/admin/settings/:key ─────────────────────────────────────────────

describe('PUT /api/admin/settings/:key', () => {
  it('upserts a setting', async () => {
    vi.mocked(prism.systemSetting.upsert).mockResolvedValue(MOCK_SETTING as any);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/default_body_size_limit_kb',
      headers: { authorization: adminTok(), 'content-type': 'application/json' },
      body: JSON.stringify({ value: '512' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: 'default_body_size_limit_kb', value: '512' });
    expect(vi.mocked(prism.systemSetting.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'default_body_size_limit_kb' },
        update: expect.objectContaining({ value: '512', updatedBy: 1 }),
        create: expect.objectContaining({ key: 'default_body_size_limit_kb', value: '512' }),
      }),
    );
  });

  it('returns 400 when value is missing', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/some_key',
      headers: { authorization: adminTok(), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
  });

  it('validates restrict_user_traffic_to_own as a boolean', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/restrict_user_traffic_to_own',
      headers: { authorization: adminTok(), 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'maybe' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/some_key',
      headers: { authorization: userTok(), 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x' }),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── DELETE /api/admin/settings/:key ──────────────────────────────────────────

describe('DELETE /api/admin/settings/:key', () => {
  it('deletes an existing setting', async () => {
    vi.mocked(prism.systemSetting.findUnique).mockResolvedValue(MOCK_SETTING as any);
    vi.mocked(prism.systemSetting.delete).mockResolvedValue(MOCK_SETTING as any);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/settings/default_body_size_limit_kb',
      headers: { authorization: adminTok() },
    });

    expect(res.statusCode).toBe(204);
    expect(vi.mocked(prism.systemSetting.delete)).toHaveBeenCalledWith({
      where: { key: 'default_body_size_limit_kb' },
    });
  });

  it('returns 404 for non-existent setting', async () => {
    vi.mocked(prism.systemSetting.findUnique).mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/settings/missing_key',
      headers: { authorization: adminTok() },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/settings/some_key',
      headers: { authorization: userTok() },
    });
    expect(res.statusCode).toBe(403);
  });
});
