import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prism } from '../db/prism';
import { gazelle } from '../db/gazelle';
import { verifyPassword } from '../lib/password';
import { verifyAccessToken } from '../lib/jwt';
import { authenticate } from '../plugins/authenticate';
import {
  decodeParticipantJwt,
  ensureParticipantToken,
  generateParticipantToken,
  getParticipantHeaderName,
  TokenExpiredError,
  verifyParticipantJwt,
} from '../lib/participant-token';
import { wsManager } from '../ws/manager';

function fmt(
  rec: { token: string; expiresAt: Date; createdAt: Date; institutionId: number | null },
  headerName: string,
) {
  return {
    token: rec.token,
    expires_at: rec.expiresAt,
    created_at: rec.createdAt,
    header_name: headerName,
    institution_id: rec.institutionId,
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
  institutionId: number | null;
  belongsToCurrentOrganization: boolean;
  belongsToCurrentUser: boolean;
  reason: 'valid' | 'expired' | 'revoked' | 'not_found';
}) {
  return {
    token: input.token,
    valid: input.valid,
    expires_at: input.expiresAt,
    header_name: input.headerName,
    institution_id: input.institutionId,
    belongs_to_current_organization: input.belongsToCurrentOrganization,
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
    include: { roles: true, institution: true },
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

function resolveAccessTokenSubject(token: string) {
  const user = verifyAccessToken(token);
  if (typeof user.institutionId !== 'number') {
    throw new Error('Access token is missing institution');
  }
  return {
    userId: user.sub,
    institutionId: user.institutionId,
  };
}

function credentialSubject(user: {
  id: number;
  institutionId: number | null;
}) {
  if (user.institutionId === null) {
    return {
      ok: false as const,
      status: 500,
      error: 'User institution is not configured',
    };
  }
  return {
    ok: true as const,
    userId: user.id,
    institutionId: user.institutionId,
  };
}

async function resolveSubjectFromRequest(req: any) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      return { ok: true as const, ...resolveAccessTokenSubject(authHeader.slice(7)) };
    } catch {
      return { ok: false as const, status: 401, error: 'Invalid or expired access token' };
    }
  }

  const authResult = await authenticateWithCredentials(req.body);
  if (!authResult.ok) {
    return authResult;
  }

  return credentialSubject(authResult.user);
}

function resolveAuthenticatedSubject(req: any) {
  if (typeof req.user.institutionId !== 'number') {
    return {
      ok: false as const,
      status: 401,
      error: 'Access token is missing institution. Please sign in again.',
    };
  }
  return {
    ok: true as const,
    userId: req.user.sub,
    institutionId: req.user.institutionId,
  };
}

function expiresAtFromPayloadExp(exp: number | undefined): Date | null {
  return typeof exp === 'number' ? new Date(exp * 1000) : null;
}

async function validateParticipantTokenForInstitution(
  token: string,
  currentUserId: number,
  currentInstitutionId: number,
  headerName: string,
) {
  try {
    const payload = verifyParticipantJwt(token);
    const record = await prism.participantToken.findUnique({ where: { userId: payload.userId } });
    const belongsToCurrentOrganization = payload.institutionId === currentInstitutionId;
    if (!record || record.token !== token) {
      return formatValidationResult({
        token,
        valid: false,
        expiresAt: expiresAtFromPayloadExp(payload.exp),
        headerName,
        institutionId: payload.institutionId,
        belongsToCurrentOrganization,
        belongsToCurrentUser: payload.userId === currentUserId,
        reason: 'revoked',
      });
    }

    const valid = record.expiresAt > new Date();
    return formatValidationResult({
      token,
      valid,
      expiresAt: record.expiresAt,
      headerName,
      institutionId: payload.institutionId,
      belongsToCurrentOrganization,
      belongsToCurrentUser: payload.userId === currentUserId,
      reason: valid ? 'valid' : 'expired',
    });
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      const payload = decodeParticipantJwt(token);
      const institutionId = payload?.institutionId ?? null;
      return formatValidationResult({
        token,
        valid: false,
        expiresAt: expiresAtFromPayloadExp(payload?.exp),
        headerName,
        institutionId,
        belongsToCurrentOrganization: institutionId === currentInstitutionId,
        belongsToCurrentUser: payload?.userId === currentUserId,
        reason: 'expired',
      });
    }

    return formatValidationResult({
      token,
      valid: false,
      expiresAt: null,
      headerName,
      institutionId: null,
      belongsToCurrentOrganization: false,
      belongsToCurrentUser: false,
      reason: 'not_found',
    });
  }
}

async function regenInstitutionTokens(institutionId: number, triggeredByUserId: number): Promise<void> {
  const others = await prism.participantToken.findMany({
    where: { institutionId, userId: { not: triggeredByUserId } },
    select: { userId: true },
  });
  await Promise.all(others.map((r) => generateParticipantToken(r.userId, institutionId)));
  wsManager.emitInstitutionTokenRegenned(institutionId, triggeredByUserId);
}

export async function tokenRoutes(fastify: FastifyInstance) {
  const getCurrentToken = async (req: any, reply: any) => {
    const subject = resolveAuthenticatedSubject(req);
    if (!subject.ok) {
      return reply.status(subject.status).send({ error: subject.error });
    }
    const [rec, headerName] = await Promise.all([
      ensureParticipantToken(subject.userId, subject.institutionId),
      getParticipantHeaderName(),
    ]);
    reply.send(fmt(rec, headerName));
  };

  const renewToken = async (req: any, reply: any) => {
    const subject = resolveAuthenticatedSubject(req);
    if (!subject.ok) {
      return reply.status(subject.status).send({ error: subject.error });
    }
    const [rec, headerName] = await Promise.all([
      generateParticipantToken(subject.userId, subject.institutionId),
      getParticipantHeaderName(),
    ]);
    await regenInstitutionTokens(subject.institutionId, subject.userId);
    reply.send(fmt(rec, headerName));
  };

  // GET /api/token — get (or auto-create) the user's participant token
  fastify.get('/token', { preHandler: [authenticate] }, getCurrentToken);
  fastify.get('/token/current', { preHandler: [authenticate] }, getCurrentToken);
  fastify.post('/token/current', async (req, reply) => {
    const authResult = await resolveSubjectFromRequest(req);
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const [rec, headerName] = await Promise.all([
      ensureParticipantToken(authResult.userId, authResult.institutionId),
      getParticipantHeaderName(),
    ]);
    return reply.send(fmt(rec, headerName));
  });

  // POST /api/token/regen — force regenerate immediately
  fastify.post('/token/regen', { preHandler: [authenticate] }, renewToken);
  fastify.post('/token/renew', async (req, reply) => {
    const authResult = await resolveSubjectFromRequest(req);
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const [rec, headerName] = await Promise.all([
      generateParticipantToken(authResult.userId, authResult.institutionId),
      getParticipantHeaderName(),
    ]);
    await regenInstitutionTokens(authResult.institutionId, authResult.userId);
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

    const authResult = await resolveSubjectFromRequest(req);
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const requestedToken = (parsed.data as { token?: string }).token;
    const [headerName, ownToken] = await Promise.all([
      getParticipantHeaderName(),
      prism.participantToken.findUnique({ where: { userId: authResult.userId } }),
    ]);

    const tokenToValidate = requestedToken ?? ownToken?.token ?? null;
    if (!tokenToValidate) {
      return reply.send(formatValidationResult({
        token: '',
        valid: false,
        expiresAt: null,
        headerName,
        institutionId: null,
        belongsToCurrentOrganization: false,
        belongsToCurrentUser: false,
        reason: 'not_found',
      }));
    }

    return reply.send(await validateParticipantTokenForInstitution(
      tokenToValidate,
      authResult.userId,
      authResult.institutionId,
      headerName,
    ));
  });
}
