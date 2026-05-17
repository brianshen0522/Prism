import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signAccessToken } from '../lib/jwt';

vi.mock('../db/prism', () => ({
  prism: {
    backendServer: {
      findMany: vi.fn(),
    },
    participantToken: {
      findMany: vi.fn(),
    },
    connection: {
      groupBy: vi.fn(),
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
import { gazelle } from '../db/gazelle';
import { prism } from '../db/prism';

const adminToken = () =>
  `Bearer ${signAccessToken({ sub: 1, username: 'admin', role: 'admin', institutionId: 1, institutionName: 'Admin Org' })}`;
const userToken = () =>
  `Bearer ${signAccessToken({ sub: 2, username: 'user', role: 'user', institutionId: 2, institutionName: 'User Org' })}`;

const USERS = [
  {
    id: 12,
    username: 'alice',
    email: 'alice@example.com',
    firstname: 'Alice',
    lastname: 'Wang',
    institutionId: 100,
    activated: true,
    blocked: false,
    lastLogin: new Date('2026-05-01T10:00:00Z'),
    creationDate: new Date('2025-12-31T00:00:00Z'),
    institution: {
      id: 100,
      name: 'Taipei General Hospital',
      keyword: 'TGH',
      activated: true,
    },
    roles: [{ roleId: 1 }],
  },
  {
    id: 18,
    username: 'bob',
    email: null,
    firstname: null,
    lastname: null,
    institutionId: 200,
    activated: false,
    blocked: true,
    lastLogin: null,
    creationDate: new Date('2024-01-01T00:00:00Z'),
    institution: {
      id: 200,
      name: 'County Clinic',
      keyword: null,
      activated: false,
    },
    roles: [{ roleId: 2 }],
  },
];

describe('Admin users routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prism.backendServer.findMany).mockResolvedValue([]);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: userToken() },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns enriched users for admin', async () => {
    vi.mocked(gazelle.gazelleUser.findMany).mockResolvedValue(USERS as any);
    vi.mocked(prism.participantToken.findMany).mockResolvedValue([
      {
        userId: 12,
        institutionId: 100,
        expiresAt: new Date('2026-05-20T00:00:00Z'),
      },
      {
        userId: 18,
        institutionId: 999,
        expiresAt: new Date('2026-05-01T00:00:00Z'),
      },
    ] as any);
    vi.mocked(prism.connection.groupBy).mockResolvedValue([
      {
        userId: 12,
        _count: { _all: 4 },
        _max: { reqTimestamp: new Date('2026-05-03T15:30:00Z') },
      },
      {
        userId: 18,
        _count: { _all: 0 },
        _max: { reqTimestamp: null },
      },
    ] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: adminToken() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      id: 12,
      username: 'alice',
      role: 'admin',
      activated: true,
      blocked: false,
      last_login: '2026-05-01T10:00:00.000Z',
      creation_date: '2025-12-31T00:00:00.000Z',
      institution: {
        id: 100,
        name: 'Taipei General Hospital',
        keyword: 'TGH',
        activated: true,
      },
      participant_token: {
        exists: true,
        valid: true,
        expires_at: '2026-05-20T00:00:00.000Z',
        institution_id: 100,
        institution_mismatch: false,
      },
      connection_count: 4,
      last_connection_at: '2026-05-03T15:30:00.000Z',
    });
    expect(body[1]).toMatchObject({
      id: 18,
      username: 'bob',
      role: 'monitor',
      activated: false,
      blocked: true,
      participant_token: {
        exists: true,
        valid: false,
        institution_id: 999,
        institution_mismatch: true,
      },
      connection_count: 0,
      last_connection_at: null,
    });
  });
});
