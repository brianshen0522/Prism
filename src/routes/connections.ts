import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prism } from '../db/prism';
import { gazelle } from '../db/gazelle';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';
import { ensureConnectionShareToken } from '../lib/share';
import { canRoleViewAllTraffic } from '../lib/settings';
import type { JwtPayload } from '../lib/jwt';

type SearchCond = { term: string; scopes: string[] };
type FilterField = 'server_id' | 'method' | 'status' | 'res_status_code' | 'user_id' | 'institution_id' | 'text';
type FilterCond = {
  field: FilterField;
  logic?: 'and' | 'or';
  values?: string[];
  term?: string;
  scopes?: string[];
};
type GazelleUserFilterRow = {
  id: number;
  username: string;
  firstname: string | null;
  lastname: string | null;
  roles: { roleId: number }[];
};
type GazelleUserNameRow = {
  id: number;
  username: string;
  firstname: string | null;
  lastname: string | null;
};
type GazelleInstitutionRow = {
  id: number;
  name: string;
  keyword: string | null;
};

const SCOPE_COL: Record<string, string> = {
  url:         'req_url',
  req_headers: 'req_headers::text',
  req_body:    'req_body',
  res_headers: 'res_headers::text',
  res_body:    'res_body',
};
const ALL_SCOPE_KEYS = Object.keys(SCOPE_COL);

const authenticateHook = [authenticate];

async function canViewAllTraffic(role: string): Promise<boolean> {
  return canRoleViewAllTraffic(role);
}

function extractReqHost(reqHeaders: unknown): string | null {
  if (!reqHeaders || typeof reqHeaders !== 'object') return null;
  const h = reqHeaders as Record<string, unknown>;
  const host = (h['host'] ?? h['Host']) as string | undefined;
  if (!host) return null;
  const scheme = (h['x-forwarded-proto'] ?? h['x-forwarded-scheme'] ?? 'http') as string;
  return `${scheme.split(',')[0].trim()}://${host}`;
}

function gazelleDisplayName(user: GazelleUserNameRow): string {
  return [user.firstname, user.lastname].filter(Boolean).join(' ') || user.username;
}

export async function loadUserNameMap(userIds: unknown[]): Promise<Map<number, string>> {
  const ids = [...new Set(
    userIds.filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
  )];
  if (ids.length === 0) return new Map();

  const users = await gazelle.gazelleUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, username: true, firstname: true, lastname: true },
  });

  return new Map((users as GazelleUserNameRow[]).map((user) => [user.id, gazelleDisplayName(user)]));
}

export async function loadInstitutionNameMap(institutionIds: unknown[]): Promise<Map<number, string>> {
  const ids = [...new Set(
    institutionIds.filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
  )];
  if (ids.length === 0) return new Map();

  const institutions = await gazelle.gazelleInstitution.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, keyword: true },
  });

  return new Map((institutions as GazelleInstitutionRow[]).map((i) => [i.id, i.keyword ?? i.name]));
}

function trafficScopeForUser(user: JwtPayload): Prisma.ConnectionWhereInput {
  if (typeof user.institutionId === 'number') {
    return {
      OR: [
        { institutionId: user.institutionId },
        { userId: user.sub },
      ],
    };
  }
  return { userId: user.sub };
}

function canViewConnection(user: JwtPayload, c: { userId: number | null; institutionId?: number | null }) {
  if (typeof user.institutionId === 'number' && c.institutionId === user.institutionId) return true;
  return c.userId === user.sub;
}

function fmtConnection(
  c: Record<string, unknown>,
  serverName?: string,
  userName?: string | null,
  institutionName?: string | null,
) {
  return {
    id: c.id,
    user_id: c.userId,
    user_name: userName ?? null,
    institution_id: c.institutionId ?? null,
    institution_name: institutionName ?? null,
    server_id: c.serverId,
    server_name: serverName ?? null,
    status: c.status,
    req_method: c.reqMethod,
    req_url: c.reqUrl,
    req_host: extractReqHost(c.reqHeaders),
    req_timestamp: c.reqTimestamp,
    req_body_size: c.reqBodySize ?? null,
    res_status_code: c.resStatusCode ?? null,
    res_body_size: c.resBodySize ?? null,
    duration_ms: c.durationMs ?? null,
    participant_token_present: c.participantTokenPresent ?? false,
    participant_token_valid: c.participantTokenValid ?? null,
    participant_token_invalid_reason: c.participantTokenInvalidReason ?? null,
    is_system_heartbeat: c.isSystemHeartbeat ?? false,
    is_path_ignored: (c as any).isPathIgnored ?? false,
  };
}

export function fmtConnectionDetail(
  c: Record<string, unknown>,
  serverName?: string,
  userName?: string | null,
  institutionName?: string | null,
) {
  return {
    ...fmtConnection(c, serverName, userName, institutionName),
    req_headers: c.reqHeaders,
    req_body: c.reqBody ?? null,
    req_body_truncated: c.reqBodyTruncated,
    res_timestamp: c.resTimestamp ?? null,
    res_headers: c.resHeaders ?? null,
    res_body: c.resBody ?? null,
    res_body_truncated: c.resBodyTruncated,
    share_token: (c.shareToken as string | null) ?? null,
  };
}

function parseSearchConditions(sq?: string, search?: string): SearchCond[] {
  if (sq?.trim()) {
    try {
      const parsed = JSON.parse(sq);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (c: unknown): c is SearchCond =>
            typeof c === 'object' && c !== null &&
            typeof (c as SearchCond).term === 'string' &&
            (c as SearchCond).term.trim().length > 0,
        );
      }
    } catch {
      return [];
    }
  }

  if (search?.trim()) return [{ term: search.trim(), scopes: [] }];
  return [];
}

function parseFilterConditions(filters?: string): FilterCond[] {
  if (!filters?.trim()) return [];

  try {
    const parsed = JSON.parse(filters);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (filter: unknown): filter is FilterCond =>
        typeof filter === 'object' &&
        filter !== null &&
        typeof (filter as FilterCond).field === 'string',
    );
  } catch {
    return [];
  }
}

function joinWhereClauses(clauses: { logic: 'and' | 'or'; clause: Prisma.ConnectionWhereInput }[]): Prisma.ConnectionWhereInput {
  if (clauses.length === 0) return {};
  let current = clauses[0].clause;

  for (let i = 1; i < clauses.length; i += 1) {
    const { logic, clause } = clauses[i];
    current = logic === 'or'
      ? { OR: [current, clause] }
      : { AND: [current, clause] };
  }

  return current;
}

async function resolveTextSearchIds(searchConditions: SearchCond[], logic: 'and' | 'or') {
  if (searchConditions.length === 0) return undefined;

  const condSets = await Promise.all(
    searchConditions.map(async (cond) => {
      const term = `%${cond.term.trim()}%`;
      const validScopes = (Array.isArray(cond.scopes) ? cond.scopes as string[] : [])
        .filter((scope) => ALL_SCOPE_KEYS.includes(scope));
      const effectiveScopes = validScopes.length > 0 ? validScopes : ALL_SCOPE_KEYS;
      const clauses = effectiveScopes.map((scope) => `${SCOPE_COL[scope]} ILIKE $1`).join(' OR ');
      const rows = await prism.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM connections WHERE ${clauses}`,
        term,
      );
      return rows.map((row) => row.id);
    }),
  );

  if (logic === 'or') return Array.from(new Set(condSets.flat()));
  if (condSets.length === 1) return condSets[0];

  const sets = condSets.map((ids) => new Set(ids));
  return [...sets[0]].filter((id) => sets.slice(1).every((set) => set.has(id)));
}

export async function connectionRoutes(fastify: FastifyInstance) {
  fastify.post('/admin/connections/clear', { preHandler: [authenticate, requireRole('admin')] }, async (_req, reply) => {
    const [resourceCalls, pipelines, connections] = await prism.$transaction([
      (prism as any).oAuthPipelineResourceCall.deleteMany({}),
      (prism as any).oAuthPipeline.deleteMany({}),
      prism.connection.deleteMany({}),
    ]);

    reply.send({
      deleted_resource_calls: resourceCalls.count,
      deleted_pipelines: pipelines.count,
      deleted_connections: connections.count,
    });
  });

  fastify.get('/connections/filter-options', { preHandler: authenticateHook }, async (req, reply) => {
    const { scope } = req.query as Record<string, string>;
    const canViewAll = await canViewAllTraffic(req.user.role);

    const where: Prisma.ConnectionWhereInput =
      !canViewAll
        ? trafficScopeForUser(req.user)
        : {};

    const rows = await prism.connection.findMany({
      where: {
        AND: [
          where,
          { resStatusCode: { not: null } },
        ],
      },
      select: { resStatusCode: true },
      distinct: ['resStatusCode'],
      orderBy: { resStatusCode: 'asc' },
    });

    reply.send({
      status_codes: rows
        .map((row) => row.resStatusCode)
        .filter((code): code is number => code !== null),
    });
  });

  // GET /api/connections
  fastify.get('/connections', { preHandler: authenticateHook }, async (req, reply) => {
    const {
      page = '1',
      limit = '25',
      server_id,
      status,
      method,
      user_id,
      institution_id,
      from,
      to,
      filters,
      filter_logic,
      sq,
      sq_logic,
      search,
      scope,
      include_system_heartbeat,
      include_path_ignored,
      sort = 'req_timestamp',
      order = 'desc',
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const canViewAll = await canViewAllTraffic(req.user.role);

    const baseAnd: Prisma.ConnectionWhereInput[] = [];
    if (!canViewAll) baseAnd.push(trafficScopeForUser(req.user));
    if (include_system_heartbeat !== 'true') baseAnd.push({ isSystemHeartbeat: false } as any);
    if (include_path_ignored !== 'true') baseAnd.push({ isPathIgnored: false } as any);

    const parsedFilters = parseFilterConditions(filters);
    let filterClauses: { logic: 'and' | 'or'; clause: Prisma.ConnectionWhereInput }[] = [];

    if (parsedFilters.length > 0) {
      const textFilters = parsedFilters.filter((filter) => filter.field === 'text');

      const textIds = await resolveTextSearchIds(
        textFilters
          .filter((filter) => typeof filter.term === 'string' && filter.term.trim().length > 0)
          .map((filter) => ({ term: filter.term!.trim(), scopes: Array.isArray(filter.scopes) ? filter.scopes : [] })),
        filter_logic === 'or' ? 'or' : 'and',
      );

      filterClauses = parsedFilters.reduce<{ logic: 'and' | 'or'; clause: Prisma.ConnectionWhereInput }[]>((clauses, filter, index) => {
        const logic = index === 0 ? 'and' : (filter.logic === 'or' ? 'or' : 'and');

        if (filter.field === 'server_id') {
          const values = Array.isArray(filter.values) ? filter.values.filter(Boolean) : [];
          if (values.length > 0) clauses.push({ logic, clause: { serverId: values.length === 1 ? values[0] : { in: values } } });
          return clauses;
        }

        if (filter.field === 'method') {
          const values = Array.isArray(filter.values)
            ? filter.values.map((value) => value.toUpperCase()).filter(Boolean)
            : [];
          if (values.length > 0) clauses.push({ logic, clause: { reqMethod: values.length === 1 ? values[0] : { in: values } } });
          return clauses;
        }

        if (filter.field === 'status') {
          const values = Array.isArray(filter.values) ? filter.values.filter(Boolean) : [];
          if (values.length > 0) {
            clauses.push({
              logic,
              clause: { status: values.length === 1 ? values[0] as Prisma.EnumConnectionStatusFilter : { in: values as any } },
            });
          }
          return clauses;
        }

        if (filter.field === 'res_status_code') {
          const values = Array.isArray(filter.values)
            ? filter.values.map((value) => parseInt(value, 10)).filter((value) => !Number.isNaN(value))
            : [];
          if (values.length > 0) {
            clauses.push({
              logic,
              clause: { resStatusCode: values.length === 1 ? values[0] : { in: values } },
            });
          }
          return clauses;
        }

        if (filter.field === 'user_id') {
          const values = Array.isArray(filter.values)
            ? filter.values.map((value) => parseInt(value, 10)).filter((value) => !Number.isNaN(value))
            : [];
          if (values.length > 0) clauses.push({ logic, clause: { userId: values.length === 1 ? values[0] : { in: values } } });
          return clauses;
        }

        if (filter.field === 'institution_id') {
          if (!canViewAll) return clauses;
          const values = Array.isArray(filter.values)
            ? filter.values.map((value) => parseInt(value, 10)).filter((value) => !Number.isNaN(value))
            : [];
          if (values.length > 0) clauses.push({
            logic,
            clause: { institutionId: values.length === 1 ? values[0] : { in: values } },
          });
          return clauses;
        }

        return clauses;
      }, []);

      if (textFilters.length > 0 && textIds) {
        const firstTextIndex = parsedFilters.findIndex((filter) => filter.field === 'text');
        const logic = firstTextIndex <= 0 ? 'and' : (parsedFilters[firstTextIndex].logic === 'or' ? 'or' : 'and');
        filterClauses.push({ logic, clause: { id: { in: textIds } } });
      }
    } else {
      const serverIds = server_id ? server_id.split(',').filter(Boolean) : [];
      const statuses  = status    ? status.split(',').filter(Boolean)    : [];
      const methods   = method    ? method.split(',').map((value) => value.toUpperCase()).filter(Boolean) : [];

      if (canViewAll && user_id) {
        const userIds = user_id.split(',').map((value) => parseInt(value, 10)).filter((value) => !Number.isNaN(value));
        if (userIds.length === 1) filterClauses.push({ logic: 'and', clause: { userId: userIds[0] } });
        else if (userIds.length > 1) filterClauses.push({ logic: 'and', clause: { userId: { in: userIds } } });
      }

      if (canViewAll && institution_id) {
        const institutionIds = institution_id.split(',').map((value) => parseInt(value, 10)).filter((value) => !Number.isNaN(value));
        if (institutionIds.length === 1) filterClauses.push({ logic: 'and', clause: { institutionId: institutionIds[0] } });
        else if (institutionIds.length > 1) filterClauses.push({ logic: 'and', clause: { institutionId: { in: institutionIds } } });
      }

      if (serverIds.length === 1) filterClauses.push({ logic: 'and', clause: { serverId: serverIds[0] } });
      else if (serverIds.length > 1) filterClauses.push({ logic: 'and', clause: { serverId: { in: serverIds } } });

      if (statuses.length === 1) filterClauses.push({ logic: 'and', clause: { status: statuses[0] as Prisma.EnumConnectionStatusFilter } });
      else if (statuses.length > 1) filterClauses.push({ logic: 'and', clause: { status: { in: statuses as any } } });

      if (methods.length === 1) filterClauses.push({ logic: 'and', clause: { reqMethod: methods[0] } });
      else if (methods.length > 1) filterClauses.push({ logic: 'and', clause: { reqMethod: { in: methods } } });

      if (from || to) {
        const range: Prisma.DateTimeFilter = {};
        if (from) range.gte = new Date(from);
        if (to) range.lte = new Date(to);
        filterClauses.push({ logic: 'and', clause: { reqTimestamp: range } });
      }

      const searchConditions = parseSearchConditions(sq, search);
      const sqLogicVal = sq_logic === 'or' ? 'or' : 'and';
      const textIds = await resolveTextSearchIds(searchConditions, sqLogicVal);
      if (textIds) filterClauses.push({ logic: 'and', clause: { id: { in: textIds } } });
    }

    let where: Prisma.ConnectionWhereInput = {};
    const filterWhere = filterClauses.length > 0 ? joinWhereClauses(filterClauses) : undefined;

    if (baseAnd.length > 0 && filterWhere) {
      where = { AND: [...baseAnd, filterWhere] };
    } else if (baseAnd.length > 0) {
      where = baseAnd.length === 1 ? baseAnd[0] : { AND: baseAnd };
    } else if (filterWhere) {
      where = filterWhere;
    }

    const SORT_MAP: Record<string, keyof Prisma.ConnectionOrderByWithRelationInput> = {
      req_timestamp: 'reqTimestamp',
      duration_ms:   'durationMs',
      res_status_code: 'resStatusCode',
      req_body_size: 'reqBodySize',
      res_body_size: 'resBodySize',
    };
    const sortField = SORT_MAP[sort] ?? 'reqTimestamp';
    const sortDir   = order === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await Promise.all([
      prism.connection.findMany({
        where,
        orderBy: { [sortField]: sortDir },
        skip,
        take: limitNum,
        include: { server: { select: { name: true } } },
      }),
      prism.connection.count({ where }),
    ]);

    const [userNameMap, institutionNameMap] = await Promise.all([
      loadUserNameMap(rows.map((c) => (c as any).userId)),
      loadInstitutionNameMap(rows.map((c) => (c as any).institutionId)),
    ]);
    const data = rows.map((c) => fmtConnection(
      c as any,
      (c as any).server?.name,
      userNameMap.get((c as any).userId),
      institutionNameMap.get((c as any).institutionId),
    ));
    reply.send({ data, total, page: pageNum, limit: limitNum });
  });

  // GET /api/connections/:id
  fastify.get('/connections/:id', { preHandler: authenticateHook }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const c = await prism.connection.findUnique({
      where: { id },
      include: { server: { select: { name: true } } },
    });

    if (!c) return reply.status(404).send({ error: 'Not found' });

    const canViewAll = await canViewAllTraffic(req.user.role);
    if (!canViewAll && !canViewConnection(req.user, c)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const [shareToken, userNameMap, institutionNameMap] = await Promise.all([
      ensureConnectionShareToken(c.id),
      loadUserNameMap([c.userId]),
      loadInstitutionNameMap([(c as any).institutionId]),
    ]);
    const userName = typeof c.userId === 'number' ? userNameMap.get(c.userId) : undefined;
    const institutionName = typeof (c as any).institutionId === 'number'
      ? institutionNameMap.get((c as any).institutionId)
      : undefined;
    reply.send({
      ...fmtConnectionDetail(c as any, (c as any).server?.name, userName, institutionName),
      share_token: shareToken,
    });
  });

  // GET /api/institutions — privileged dropdown data for institution filters
  // Derives the list from distinct institution IDs seen in Connection records (same approach as OAuth filter-options)
  fastify.get('/institutions', { preHandler: [authenticate, requireRole('admin', 'monitor')] }, async (_req, reply) => {
    const rows = await prism.connection.findMany({
      where: { institutionId: { not: null } },
      select: { institutionId: true },
      distinct: ['institutionId'],
    });
    const ids = Array.from(new Set(rows.map((r) => r.institutionId).filter((id): id is number => id !== null)));
    const institutions = ids.length > 0
      ? await gazelle.gazelleInstitution.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, keyword: true },
        })
      : [];
    const result = (institutions as GazelleInstitutionRow[])
      .sort((a, b) => a.name.localeCompare(b.name));
    reply.send(result);
  });

  // GET /api/users  — privileged: list all Gazelle users for filter dropdown
  fastify.get('/users', { preHandler: authenticateHook }, async (req, reply) => {
    const canAll = await canViewAllTraffic(req.user.role);

    const { institution_id } = req.query as Record<string, string>;

    let institutionIds: number[];
    if (canAll) {
      // Admin/monitor: respect the provided institution_id filter (or show all if omitted)
      institutionIds = institution_id
        ? institution_id.split(',').map((v) => parseInt(v, 10)).filter((v) => !Number.isNaN(v))
        : [];
    } else {
      // Non-privileged: force-scope to the user's own institution
      if (typeof req.user.institutionId !== 'number') {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      institutionIds = [req.user.institutionId];
    }

    const users = await gazelle.gazelleUser.findMany({
      where: {
        activated: true,
        blocked: false,
        ...(institutionIds.length > 0 ? { institutionId: { in: institutionIds } } : {}),
      },
      select: { id: true, username: true, firstname: true, lastname: true, roles: { select: { roleId: true } } },
      orderBy: { username: 'asc' },
    });
    const data = (users as GazelleUserFilterRow[]).map((u) => ({
      id:       u.id,
      username: u.username,
      name:     gazelleDisplayName(u),
      role:     u.roles.some((r) => r.roleId === 1) ? 'admin'
              : u.roles.some((r) => r.roleId === 2) ? 'monitor'
              : u.roles.some((r) => r.roleId === 3) ? 'oauth2'
              : 'user',
    }));
    reply.send(data);
  });
}
