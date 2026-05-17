import type { FastifyPluginAsync } from 'fastify';
import { gazelle } from '../db/gazelle';
import { prism } from '../db/prism';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';

type GazelleRoleRow = { roleId: number };
type GazelleInstitutionRow = {
  id: number;
  name: string;
  keyword: string | null;
  activated: boolean | null;
};
type GazelleUserRow = {
  id: number;
  username: string;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  institutionId: number | null;
  activated: boolean | null;
  blocked: boolean | null;
  lastLogin: Date | null;
  creationDate: Date | null;
  institution: GazelleInstitutionRow | null;
  roles: GazelleRoleRow[];
};
type ParticipantTokenRow = {
  userId: number;
  institutionId: number | null;
  expiresAt: Date;
};
type ConnectionStatsRow = {
  userId: number | null;
  _count: { _all: number };
  _max: { reqTimestamp: Date | null };
};

function resolveRole(roleIds: number[]): 'admin' | 'monitor' | 'oauth2' | 'user' {
  if (roleIds.includes(1)) return 'admin';
  if (roleIds.includes(2)) return 'monitor';
  if (roleIds.includes(3)) return 'oauth2';
  return 'user';
}

function formatName(user: Pick<GazelleUserRow, 'firstname' | 'lastname' | 'username'>) {
  return [user.firstname, user.lastname].filter(Boolean).join(' ') || user.username;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export const adminUsersRoutes: FastifyPluginAsync = async (fastify) => {
  const adminOnly = [authenticate, requireRole('admin')];

  fastify.get('/admin/users', { preHandler: adminOnly }, async (_request, reply) => {
    const users = await gazelle.gazelleUser.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        firstname: true,
        lastname: true,
        institutionId: true,
        activated: true,
        blocked: true,
        lastLogin: true,
        creationDate: true,
        institution: {
          select: {
            id: true,
            name: true,
            keyword: true,
            activated: true,
          },
        },
        roles: {
          select: {
            roleId: true,
          },
        },
      },
      orderBy: { username: 'asc' },
    });

    const userIds = users.map((user) => user.id);
    const [tokens, connectionStats] = await Promise.all([
      userIds.length > 0
        ? prism.participantToken.findMany({
            where: { userId: { in: userIds } },
            select: {
              userId: true,
              institutionId: true,
              expiresAt: true,
            },
          })
        : Promise.resolve([] as ParticipantTokenRow[]),
      userIds.length > 0
        ? prism.connection.groupBy({
            by: ['userId'],
            where: { userId: { in: userIds } },
            _count: { _all: true },
            _max: { reqTimestamp: true },
          })
        : Promise.resolve([] as ConnectionStatsRow[]),
    ]);

    const tokenByUserId = new Map((tokens as ParticipantTokenRow[]).map((token) => [token.userId, token]));
    const statsByUserId = new Map((connectionStats as ConnectionStatsRow[])
      .filter((row) => row.userId !== null)
      .map((row) => [row.userId as number, row]));
    const now = new Date();

    reply.send((users as GazelleUserRow[]).map((user) => {
      const token = tokenByUserId.get(user.id);
      const stats = statsByUserId.get(user.id);
      const institutionMismatch = token
        ? token.institutionId !== null && user.institutionId !== null && token.institutionId !== user.institutionId
        : false;
      const tokenValid = token ? token.expiresAt > now && !institutionMismatch : false;

      return {
        id: user.id,
        username: user.username,
        firstname: user.firstname,
        lastname: user.lastname,
        name: formatName(user),
        email: user.email,
        role: resolveRole(user.roles.map((role) => role.roleId)),
        activated: user.activated,
        blocked: user.blocked,
        last_login: toIso(user.lastLogin),
        creation_date: toIso(user.creationDate),
        institution: user.institution
          ? {
              id: user.institution.id,
              name: user.institution.name,
              keyword: user.institution.keyword,
              activated: user.institution.activated,
            }
          : null,
        participant_token: {
          exists: Boolean(token),
          valid: tokenValid,
          expires_at: toIso(token?.expiresAt ?? null),
          institution_id: token?.institutionId ?? null,
          institution_mismatch: institutionMismatch,
        },
        connection_count: stats?._count._all ?? 0,
        last_connection_at: toIso(stats?._max.reqTimestamp ?? null),
      };
    }));
  });
};
