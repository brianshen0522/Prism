import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { gazelle } from '../db/gazelle';
import { prism } from '../db/prism';
import { verifyPassword } from '../lib/password';
import { signAccessToken, JwtPayload } from '../lib/jwt';
import { generateParticipantToken } from '../lib/participant-token';
import { createRefreshToken, verifyAndRotateRefreshToken, revokeRefreshToken } from '../lib/tokens';
import { authenticate } from '../plugins/authenticate';

function resolveRole(roleIds: number[]): 'admin' | 'monitor' | 'oauth2' | 'user' {
  if (roleIds.includes(1)) return 'admin';
  if (roleIds.includes(2)) return 'monitor';
  if (roleIds.includes(3)) return 'oauth2';
  return 'user';
}

interface AuthInstitution {
  id: number;
  name: string;
  keyword: string | null;
}

function formatInstitution(user: {
  institutionId: number | null;
  institution: {
    id: number;
    name: string;
    keyword: string | null;
  } | null;
}): AuthInstitution | null {
  if (user.institutionId === null || !user.institution) return null;
  return {
    id: user.institution.id,
    name: user.institution.name,
    keyword: user.institution.keyword,
  };
}

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const refreshBody = z.object({
  refresh_token: z.string().min(1),
});

const logoutBody = z.object({
  refresh_token: z.string().optional(),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/auth/login
  fastify.post('/login', async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'username and password are required' });
    }
    const { username, password } = parsed.data;

    const user = await gazelle.gazelleUser.findUnique({
      where: { username },
      include: { roles: true, institution: true },
    });

    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    if (user.blocked) {
      return reply.status(401).send({ error: 'Account is blocked' });
    }
    if (!user.activated) {
      return reply.status(401).send({ error: 'Account is not activated' });
    }
    if (!verifyPassword(password, user.password)) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const role = resolveRole(user.roles.map((r) => r.roleId));
    const institution = formatInstitution(user);
    if (!institution) {
      request.log.error({ userId: user.id }, 'Authenticated Gazelle user has no institution');
      return reply.status(500).send({ error: 'User institution is not configured' });
    }

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role,
      institutionId: institution.id,
      institutionName: institution.name,
    };
    const accessToken = signAccessToken(payload);
    const refreshToken = await createRefreshToken(user.id);

    return reply.status(200).send({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        role,
      },
      institution,
    });
  });

  // POST /api/auth/refresh
  fastify.post('/refresh', async (request, reply) => {
    const parsed = refreshBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'refresh_token is required' });
    }

    const stored = await verifyAndRotateRefreshToken(parsed.data.refresh_token);
    if (!stored) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    // Re-fetch user for fresh role info
    const user = await gazelle.gazelleUser.findUnique({
      where: { id: stored.userId },
      include: { roles: true, institution: true },
    });

    if (!user || user.blocked || !user.activated) {
      return reply.status(401).send({ error: 'User account unavailable' });
    }

    const role = resolveRole(user.roles.map((r) => r.roleId));
    const institution = formatInstitution(user);
    if (!institution) {
      request.log.error({ userId: user.id }, 'Gazelle user has no institution during refresh');
      return reply.status(500).send({ error: 'User institution is not configured' });
    }

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role,
      institutionId: institution.id,
      institutionName: institution.name,
    };
    const accessToken = signAccessToken(payload);
    const newRefreshToken = await createRefreshToken(user.id);

    const existingToken = await prism.participantToken.findUnique({
      where: { userId: user.id },
      select: { institutionId: true },
    });

    let institutionChanged = false;
    if (existingToken !== null && existingToken.institutionId !== institution.id) {
      await generateParticipantToken(user.id, institution.id);
      institutionChanged = true;
      request.log.info(
        {
          userId: user.id,
          oldInstitutionId: existingToken.institutionId,
          newInstitutionId: institution.id,
        },
        'Institution changed, participant token regenerated',
      );
    }

    return reply.status(200).send({
      access_token: accessToken,
      refresh_token: newRefreshToken,
      institution,
      institution_changed: institutionChanged,
    });
  });

  // POST /api/auth/logout
  fastify.post('/logout', { preHandler: authenticate }, async (request, reply) => {
    const parsed = logoutBody.safeParse(request.body);
    if (parsed.success && parsed.data.refresh_token) {
      await revokeRefreshToken(parsed.data.refresh_token);
    }
    return reply.status(200).send({ message: 'Logged out successfully' });
  });
};
