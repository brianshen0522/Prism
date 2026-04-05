import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prism } from '../db/prism';
import { gazelle } from '../db/gazelle';
import { verifyPassword } from '../lib/password';
import { verifyAccessToken } from '../lib/jwt';
import { authenticate } from '../plugins/authenticate';

const DEFAULT_TTL = 5;
export const DEFAULT_HEADER = 'X-Participant-Token';

async function getTtlMinutes(): Promise<number> {
  const s = await prism.systemSetting.findUnique({ where: { key: 'participant_token_ttl_minutes' } });
  const v = parseInt(s?.value ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL;
}

async function getHeaderName(): Promise<string> {
  const s = await prism.systemSetting.findUnique({ where: { key: 'participant_token_header' } });
  return s?.value || DEFAULT_HEADER;
}

async function generateToken(userId: number) {
  const ttl = await getTtlMinutes();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  return prism.participantToken.upsert({
    where: { userId },
    create: { id: crypto.randomUUID(), userId, token, expiresAt },
    update: { token, expiresAt },
  });
}

async function ensureToken(userId: number) {
  const existing = await prism.participantToken.findUnique({ where: { userId } });
  if (existing && existing.expiresAt > new Date()) return existing;
  return generateToken(userId);
}

function fmt(rec: { token: string; expiresAt: Date; createdAt: Date }, headerName: string) {
  return {
    token: rec.token,
    expires_at: rec.expiresAt,
    created_at: rec.createdAt,
    header_name: headerName,
  };
}

const tokenCredentialsBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const tokenValidateCredentialsBody = tokenCredentialsBody.extend({
  token: z.string().min(1).optional(),
});

function formatValidationResult(input: {
  token: string;
  valid: boolean;
  expiresAt: Date | null;
  headerName: string;
  belongsToCurrentUser: boolean;
  reason: 'valid' | 'expired' | 'not_found';
}) {
  return {
    token: input.token,
    valid: input.valid,
    expires_at: input.expiresAt,
    header_name: input.headerName,
    belongs_to_current_user: input.belongsToCurrentUser,
    reason: input.reason,
  };
}

async function authenticateWithCredentials(body: unknown) {
  const parsed = tokenCredentialsBody.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: 'username and password are required',
    };
  }

  const { username, password } = parsed.data;
  const user = await gazelle.gazelleUser.findUnique({
    where: { username },
    include: { roles: true },
  });

  if (!user || !verifyPassword(password, user.password)) {
    return {
      ok: false as const,
      status: 401,
      error: 'Invalid credentials',
    };
  }

  if (user.blocked) {
    return {
      ok: false as const,
      status: 401,
      error: 'Account is blocked',
    };
  }

  if (!user.activated) {
    return {
      ok: false as const,
      status: 401,
      error: 'Account is not activated',
    };
  }

  return {
    ok: true as const,
    user,
  };
}

async function resolveUserIdFromRequest(req: any) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const user = verifyAccessToken(authHeader.slice(7));
      return { ok: true as const, userId: user.sub };
    } catch {
      return { ok: false as const, status: 401, error: 'Invalid or expired access token' };
    }
  }

  const authResult = await authenticateWithCredentials(req.body);
  if (!authResult.ok) {
    return authResult;
  }

  return { ok: true as const, userId: authResult.user.id };
}

export async function tokenRoutes(fastify: FastifyInstance) {
  const getCurrentToken = async (req: any, reply: any) => {
    const [rec, headerName] = await Promise.all([ensureToken(req.user.sub), getHeaderName()]);
    reply.send(fmt(rec, headerName));
  };

  const renewToken = async (req: any, reply: any) => {
    const [rec, headerName] = await Promise.all([generateToken(req.user.sub), getHeaderName()]);
    reply.send(fmt(rec, headerName));
  };

  // GET /api/token — get (or auto-create) the user's participant token
  fastify.get('/token', { preHandler: [authenticate] }, getCurrentToken);
  fastify.get('/token/current', { preHandler: [authenticate] }, getCurrentToken);
  fastify.post('/token/current', async (req, reply) => {
    const authResult = await resolveUserIdFromRequest(req);
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const [rec, headerName] = await Promise.all([
      ensureToken(authResult.userId),
      getHeaderName(),
    ]);
    return reply.send(fmt(rec, headerName));
  });

  // POST /api/token/regen — force regenerate immediately
  fastify.post('/token/regen', { preHandler: [authenticate] }, renewToken);
  fastify.post('/token/renew', async (req, reply) => {
    const authResult = await resolveUserIdFromRequest(req);
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const [rec, headerName] = await Promise.all([
      generateToken(authResult.userId),
      getHeaderName(),
    ]);
    return reply.send(fmt(rec, headerName));
  });

  fastify.post('/token/validate', async (req, reply) => {
    const authHeader = req.headers.authorization;
    const parsed = authHeader?.startsWith('Bearer ')
      ? z.object({ token: z.string().min(1).optional() }).safeParse(req.body ?? {})
      : tokenValidateCredentialsBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'username and password are required, and token must be a non-empty string when provided',
      });
    }

    const authResult = await resolveUserIdFromRequest(req);
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const requestedToken = (parsed.data as { token?: string }).token;
    const [headerName, ownToken] = await Promise.all([
      getHeaderName(),
      prism.participantToken.findUnique({ where: { userId: authResult.userId } }),
    ]);

    const tokenToValidate = requestedToken ?? ownToken?.token ?? null;
    if (!tokenToValidate) {
      return reply.send(formatValidationResult({
        token: '',
        valid: false,
        expiresAt: null,
        headerName,
        belongsToCurrentUser: false,
        reason: 'not_found',
      }));
    }

    const record = await prism.participantToken.findUnique({
      where: { token: tokenToValidate },
    });

    if (!record) {
      return reply.send(formatValidationResult({
        token: tokenToValidate,
        valid: false,
        expiresAt: null,
        headerName,
        belongsToCurrentUser: false,
        reason: 'not_found',
      }));
    }

    const valid = record.expiresAt > new Date();
    return reply.send(formatValidationResult({
      token: tokenToValidate,
      valid,
      expiresAt: record.expiresAt,
      headerName,
      belongsToCurrentUser: record.userId === authResult.userId,
      reason: valid ? 'valid' : 'expired',
    }));
  });
}
