import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signAccessToken } from '../lib/jwt';
import crypto from 'crypto';

vi.mock('../db/prism', () => ({
  prism: {
    systemSetting: {
      findUnique: vi.fn(),
    },
    participantToken: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../db/gazelle', () => ({
  gazelle: {
    gazelleUser: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@fastify/static', () => ({
  default: async () => {},
}));

import { buildApp } from '../app';
import { prism } from '../db/prism';
import { gazelle } from '../db/gazelle';

const userTok = () => `Bearer ${signAccessToken({ sub: 10, username: 'user', role: 'user' })}`;
const PASSWORD = 'Shen@9429';
const PASSWORD_HASH = crypto.createHash('md5').update(PASSWORD).digest('hex');
const MOCK_USER = {
  id: 10,
  username: 'user',
  password: PASSWORD_HASH,
  email: 'user@example.com',
  firstname: 'Test',
  lastname: 'User',
  activated: true,
  blocked: false,
  lastLogin: null,
  creationDate: new Date(),
  roles: [],
};

let app: FastifyInstance;
const systemSettingFindUniqueMock = prism.systemSetting.findUnique as unknown as {
  mockImplementation: (fn: any) => void;
};
const participantTokenFindUniqueMock = prism.participantToken.findUnique as unknown as {
  mockImplementation: (fn: any) => void;
  mockResolvedValue: (value: any) => void;
};
const participantTokenUpsertMock = prism.participantToken.upsert as unknown as {
  mockResolvedValue: (value: any) => void;
};
const gazelleUserFindUniqueMock = gazelle.gazelleUser.findUnique as unknown as {
  mockResolvedValue: (value: any) => void;
};

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  gazelleUserFindUniqueMock.mockResolvedValue(MOCK_USER as any);
  systemSettingFindUniqueMock.mockImplementation(({ where }: any) => {
    if (where.key === 'participant_token_ttl_minutes') return { key: where.key, value: '5' } as any;
    if (where.key === 'participant_token_header') return { key: where.key, value: 'X-Participant-Token' } as any;
    return null as any;
  });
});

describe('participant token routes', () => {
  it('returns current token from POST /api/token/current with username and password', async () => {
    const record = {
      id: 'pt-1',
      userId: 10,
      token: 'tok-current',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    participantTokenFindUniqueMock.mockResolvedValue(record as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/token/current',
      payload: { username: 'user', password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token: 'tok-current',
      header_name: 'X-Participant-Token',
    });
  });

  it('renews token from /api/token/renew with username and password', async () => {
    const record = {
      id: 'pt-2',
      userId: 10,
      token: 'tok-renewed',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    participantTokenUpsertMock.mockResolvedValue(record as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/token/renew',
      payload: { username: 'user', password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token: 'tok-renewed',
      header_name: 'X-Participant-Token',
    });
  });

  it('validates the current user token when credentials are provided without a token', async () => {
    const ownToken = {
      id: 'pt-3',
      userId: 10,
      token: 'tok-own',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    participantTokenFindUniqueMock.mockImplementation(({ where }: any) => {
      if (where.userId === 10) return ownToken as any;
      if (where.token === 'tok-own') return ownToken as any;
      return null as any;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/token/validate',
      payload: { username: 'user', password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token: 'tok-own',
      valid: true,
      belongs_to_current_user: true,
      reason: 'valid',
    });
  });

  it('returns expired for an expired token', async () => {
    const expiredToken = {
      id: 'pt-4',
      userId: 10,
      token: 'tok-expired',
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    participantTokenFindUniqueMock.mockImplementation(({ where }: any) => {
      if (where.userId === 10) return null as any;
      if (where.token === 'tok-expired') return expiredToken as any;
      return null as any;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/token/validate',
      payload: { username: 'user', password: PASSWORD, token: 'tok-expired' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token: 'tok-expired',
      valid: false,
      belongs_to_current_user: true,
      reason: 'expired',
    });
  });

  it('returns not_found for an unknown token', async () => {
    participantTokenFindUniqueMock.mockResolvedValue(null as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/token/validate',
      payload: { username: 'user', password: PASSWORD, token: 'missing-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token: 'missing-token',
      valid: false,
      belongs_to_current_user: false,
      reason: 'not_found',
    });
  });

  it('still supports the legacy bearer token endpoint for the UI', async () => {
    const record = {
      id: 'pt-legacy',
      userId: 10,
      token: 'tok-legacy',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    participantTokenFindUniqueMock.mockResolvedValue(record as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/token',
      headers: { authorization: userTok() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token: 'tok-legacy',
      header_name: 'X-Participant-Token',
    });
  });
});
