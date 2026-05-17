import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signAccessToken } from '../lib/jwt';
import { generateParticipantJwt } from '../lib/participant-token';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

vi.mock('../db/prism', () => ({
  prism: {
    backendServer: {
      findMany: vi.fn(),
    },
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

const INSTITUTION_ID = 456;
const INSTITUTION_NAME = 'Taiwan Hospital';
const userTok = () => `Bearer ${signAccessToken({
  sub: 10,
  username: 'user',
  role: 'user',
  institutionId: INSTITUTION_ID,
  institutionName: INSTITUTION_NAME,
})}`;
const PASSWORD = 'Shen@9429';
const PASSWORD_HASH = crypto.createHash('md5').update(PASSWORD).digest('hex');
const MOCK_USER = {
  id: 10,
  username: 'user',
  password: PASSWORD_HASH,
  email: 'user@example.com',
  firstname: 'Test',
  lastname: 'User',
  institutionId: INSTITUTION_ID,
  institution: {
    id: INSTITUTION_ID,
    name: INSTITUTION_NAME,
    keyword: 'TWH',
  },
  activated: true,
  blocked: false,
  lastLogin: null,
  creationDate: new Date(),
  roles: [],
};

function participantJwt(userId = 10, institutionId = INSTITUTION_ID) {
  return generateParticipantJwt(userId, institutionId, 5).token;
}

function expiredParticipantJwt(userId = 10, institutionId = INSTITUTION_ID) {
  return jwt.sign(
    { userId, institutionId },
    process.env.PARTICIPANT_TOKEN_SECRET!,
    { expiresIn: -1 },
  );
}

let app: FastifyInstance;
const backendServerFindManyMock = prism.backendServer.findMany as unknown as {
  mockResolvedValue: (value: any) => void;
};
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
  backendServerFindManyMock.mockResolvedValue([]);
  gazelleUserFindUniqueMock.mockResolvedValue(MOCK_USER as any);
  systemSettingFindUniqueMock.mockImplementation(({ where }: any) => {
    if (where.key === 'participant_token_ttl_minutes') return { key: where.key, value: '5' } as any;
    if (where.key === 'participant_token_header') return { key: where.key, value: 'X-Participant-Token' } as any;
    return null as any;
  });
});

describe('participant token routes', () => {
  it('returns current token from POST /api/token/current with username and password', async () => {
    const token = participantJwt();
    const record = {
      id: 'pt-1',
      userId: 10,
      institutionId: INSTITUTION_ID,
      token,
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
      token,
      header_name: 'X-Participant-Token',
      institution_id: INSTITUTION_ID,
    });
  });

  it('renews token from /api/token/renew with username and password', async () => {
    const token = participantJwt();
    const record = {
      id: 'pt-2',
      userId: 10,
      institutionId: INSTITUTION_ID,
      token,
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
      token,
      header_name: 'X-Participant-Token',
      institution_id: INSTITUTION_ID,
    });
    expect(prism.participantToken.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: 10, institutionId: INSTITUTION_ID }),
      update: expect.objectContaining({ institutionId: INSTITUTION_ID }),
    }));
  });

  it('validates the current user token when credentials are provided without a token', async () => {
    const token = participantJwt();
    const ownToken = {
      id: 'pt-3',
      userId: 10,
      institutionId: INSTITUTION_ID,
      token,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    participantTokenFindUniqueMock.mockImplementation(({ where }: any) => {
      if (where.userId === 10) return ownToken as any;
      return null as any;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/token/validate',
      payload: { username: 'user', password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token,
      valid: true,
      belongs_to_current_organization: true,
      belongs_to_current_user: true,
      reason: 'valid',
    });
  });

  it('distinguishes same-institution tokens from the current user token', async () => {
    const token = participantJwt(20, INSTITUTION_ID);
    participantTokenFindUniqueMock.mockImplementation(({ where }: any) => {
      if (where.userId === 20) {
        return {
          id: 'pt-other-member',
          userId: 20,
          institutionId: INSTITUTION_ID,
          token,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        } as any;
      }
      return null as any;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/token/validate',
      payload: { username: 'user', password: PASSWORD, token },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token,
      valid: true,
      belongs_to_current_organization: true,
      belongs_to_current_user: false,
      reason: 'valid',
    });
  });

  it('returns expired for an expired token', async () => {
    const token = expiredParticipantJwt();
    participantTokenFindUniqueMock.mockResolvedValue(null as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/token/validate',
      payload: { username: 'user', password: PASSWORD, token },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token,
      valid: false,
      belongs_to_current_organization: true,
      reason: 'expired',
    });
  });

  it('returns revoked for a valid JWT that is no longer the stored token', async () => {
    const oldToken = jwt.sign(
      { userId: 10, institutionId: INSTITUTION_ID, jti: 'old-token' },
      process.env.PARTICIPANT_TOKEN_SECRET!,
      { expiresIn: 300 },
    );
    const currentToken = jwt.sign(
      { userId: 10, institutionId: INSTITUTION_ID, jti: 'current-token' },
      process.env.PARTICIPANT_TOKEN_SECRET!,
      { expiresIn: 300 },
    );
    participantTokenFindUniqueMock.mockResolvedValue({
      id: 'pt-current',
      userId: 10,
      institutionId: INSTITUTION_ID,
      token: currentToken,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/token/validate',
      payload: { username: 'user', password: PASSWORD, token: oldToken },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      token: oldToken,
      valid: false,
      belongs_to_current_organization: true,
      reason: 'revoked',
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
      belongs_to_current_organization: false,
      reason: 'not_found',
    });
  });

  it('still supports the legacy bearer token endpoint for the UI', async () => {
    const token = participantJwt();
    const record = {
      id: 'pt-legacy',
      userId: 10,
      institutionId: INSTITUTION_ID,
      token,
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
      token,
      header_name: 'X-Participant-Token',
      institution_id: INSTITUTION_ID,
    });
  });
});
