import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';

// Mock DB modules before any imports that use them
vi.mock('../db/gazelle', () => ({
  gazelle: {
    gazelleUser: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../db/prism', () => ({
  prism: {
    backendServer: {
      findMany: vi.fn(),
    },
    participantToken: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { buildApp } from '../app';
import { gazelle } from '../db/gazelle';
import { prism } from '../db/prism';
import { verifyAccessToken } from '../lib/jwt';
import * as participantToken from '../lib/participant-token';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const PASSWORD = 'Shen@9429';
const PASSWORD_HASH = crypto.createHash('md5').update(PASSWORD).digest('hex');

const MOCK_USER = {
  id: 42,
  username: 'brian9429',
  password: PASSWORD_HASH,
  email: 'brian@example.com',
  firstname: 'Brian',
  lastname: 'Chen',
  institutionId: 456,
  institution: {
    id: 456,
    name: 'Taiwan Hospital',
    keyword: 'TWH',
  },
  activated: true,
  blocked: false,
  lastLogin: null,
  creationDate: new Date(),
  roles: [{ userId: 42, roleId: 1 }], // admin
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStoredRefreshToken(rawToken: string, userId = 42) {
  return {
    id: 'rt-uuid-1234',
    userId,
    token: crypto.createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Auth routes', () => {
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
    vi.mocked(prism.participantToken.findUnique).mockResolvedValue(null);
    vi.mocked(prism.refreshToken.create).mockResolvedValue({} as any);
    vi.mocked(prism.refreshToken.delete).mockResolvedValue({} as any);
    vi.mocked(prism.refreshToken.deleteMany).mockResolvedValue({ count: 0 } as any);
  });

  // ── GET /api/health ─────────────────────────────────────────────────────────

  describe('GET /api/health', () => {
    it('returns 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ok');
    });
  });

  // ── POST /api/auth/login ────────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns 200 with access_token, refresh_token, and user for valid credentials', async () => {
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(MOCK_USER as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'brian9429', password: 'Shen@9429' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(verifyAccessToken(body.access_token)).toMatchObject({
        sub: 42,
        username: 'brian9429',
        role: 'admin',
        institutionId: 456,
        institutionName: 'Taiwan Hospital',
      });
      expect(body.user).toMatchObject({
        id: 42,
        username: 'brian9429',
        email: 'brian@example.com',
        firstname: 'Brian',
        lastname: 'Chen',
        role: 'admin',
      });
      expect(body.institution).toEqual({
        id: 456,
        name: 'Taiwan Hospital',
        keyword: 'TWH',
      });
    });

    it('returns 500 when authenticated user has no institution', async () => {
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(
        { ...MOCK_USER, institutionId: null, institution: null } as any,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'brian9429', password: 'Shen@9429' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toMatch(/institution/i);
    });

    it('returns 401 for wrong password', async () => {
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(MOCK_USER as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'brian9429', password: 'WrongPassword' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/invalid credentials/i);
    });

    it('returns 401 when user does not exist', async () => {
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'nobody', password: 'anything' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when user is blocked', async () => {
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(
        { ...MOCK_USER, blocked: true } as any,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'brian9429', password: 'Shen@9429' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/blocked/i);
    });

    it('returns 401 when user is not activated', async () => {
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(
        { ...MOCK_USER, activated: false } as any,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'brian9429', password: 'Shen@9429' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/not activated/i);
    });

    it('returns 400 when body is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('assigns monitor role for role_id 2', async () => {
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(
        { ...MOCK_USER, roles: [{ userId: 42, roleId: 2 }] } as any,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'brian9429', password: 'Shen@9429' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.role).toBe('monitor');
    });

    it('assigns user role when no role entry exists', async () => {
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(
        { ...MOCK_USER, roles: [] } as any,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'brian9429', password: 'Shen@9429' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.role).toBe('user');
    });
  });

  // ── POST /api/auth/refresh ──────────────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('returns 200 with new access_token and refresh_token', async () => {
      const rawToken = crypto.randomBytes(64).toString('hex');

      vi.mocked(prism.refreshToken.findFirst).mockResolvedValue(
        makeStoredRefreshToken(rawToken) as any,
      );
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(MOCK_USER as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refresh_token: rawToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.access_token).toBeDefined();
      expect(body.refresh_token).toBeDefined();
      expect(body.institution).toEqual({
        id: 456,
        name: 'Taiwan Hospital',
        keyword: 'TWH',
      });
      expect(body.institution_changed).toBe(false);
      // Rotated — new token must differ from the original
      expect(body.refresh_token).not.toBe(rawToken);
    });

    it('regenerates participant token when the institution has changed', async () => {
      const rawToken = crypto.randomBytes(64).toString('hex');
      const generateSpy = vi
        .spyOn(participantToken, 'generateParticipantToken')
        .mockResolvedValue({} as any);

      vi.mocked(prism.refreshToken.findFirst).mockResolvedValue(
        makeStoredRefreshToken(rawToken) as any,
      );
      vi.mocked(prism.participantToken.findUnique).mockResolvedValue({
        institutionId: 123,
      } as any);
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(
        { ...MOCK_USER, institution: { ...MOCK_USER.institution, id: 456 } } as any,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refresh_token: rawToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().institution_changed).toBe(true);
      expect(generateSpy).toHaveBeenCalledWith(42, 456);
    });

    it('deletes the old refresh token on use (rotation)', async () => {
      const rawToken = crypto.randomBytes(64).toString('hex');

      vi.mocked(prism.refreshToken.findFirst).mockResolvedValue(
        makeStoredRefreshToken(rawToken) as any,
      );
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(MOCK_USER as any);

      await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refresh_token: rawToken },
      });

      expect(vi.mocked(prism.refreshToken.delete)).toHaveBeenCalledWith({
        where: { id: 'rt-uuid-1234' },
      });
    });

    it('returns 401 for an invalid refresh token', async () => {
      vi.mocked(prism.refreshToken.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refresh_token: 'invalid-token' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when refresh_token field is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /api/auth/logout ───────────────────────────────────────────────────

  describe('POST /api/auth/logout', () => {
    async function loginAndGetTokens() {
      vi.mocked(gazelle.gazelleUser.findUnique).mockResolvedValue(MOCK_USER as any);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'brian9429', password: 'Shen@9429' },
      });
      return res.json() as { access_token: string; refresh_token: string };
    }

    it('returns 200 with valid access token and revokes refresh token', async () => {
      const { access_token, refresh_token } = await loginAndGetTokens();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: `Bearer ${access_token}` },
        payload: { refresh_token },
      });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(prism.refreshToken.deleteMany)).toHaveBeenCalled();
    });

    it('returns 200 with valid token even without a refresh_token body', async () => {
      const { access_token } = await loginAndGetTokens();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: `Bearer ${access_token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 401 without Authorization header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        payload: {},
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 with a tampered token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: 'Bearer tampered.jwt.token' },
        payload: {},
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
