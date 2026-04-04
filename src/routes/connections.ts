import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prism } from '../db/prism';
import { gazelle } from '../db/gazelle';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';

type SearchCond = { term: string; scopes: string[] };

const SCOPE_COL: Record<string, string> = {
  url:         'req_url',
  req_headers: 'req_headers::text',
  req_body:    'req_body',
  res_headers: 'res_headers::text',
  res_body:    'res_body',
};
const ALL_SCOPE_KEYS = Object.keys(SCOPE_COL);

const authenticateHook = [authenticate];
const privileged = [authenticate, requireRole('admin', 'monitor')];

function fmtConnection(c: Record<string, unknown>, serverName?: string) {
  return {
    id: c.id,
    user_id: c.userId,
    server_id: c.serverId,
    server_name: serverName ?? null,
    status: c.status,
    req_method: c.reqMethod,
    req_url: c.reqUrl,
    req_timestamp: c.reqTimestamp,
    req_body_size: c.reqBodySize ?? null,
    res_status_code: c.resStatusCode ?? null,
    res_body_size: c.resBodySize ?? null,
    duration_ms: c.durationMs ?? null,
  };
}

function fmtConnectionDetail(c: Record<string, unknown>, serverName?: string) {
  return {
    ...fmtConnection(c, serverName),
    req_headers: c.reqHeaders,
    req_body: c.reqBody ?? null,
    req_body_truncated: c.reqBodyTruncated,
    res_timestamp: c.resTimestamp ?? null,
    res_headers: c.resHeaders ?? null,
    res_body: c.resBody ?? null,
    res_body_truncated: c.resBodyTruncated,
  };
}

export async function connectionRoutes(fastify: FastifyInstance) {
  // GET /api/connections
  fastify.get('/connections', { preHandler: authenticateHook }, async (req, reply) => {
    const { page = '1', limit = '25', server_id, status, method, user_id, from, to, sq, sq_logic, search, scope, sort = 'req_timestamp', order = 'desc' } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const isPrivileged = req.user.role === 'admin' || req.user.role === 'monitor';

    // Multi-value filters — comma-separated, e.g. ?method=GET,POST
    const serverIds = server_id ? server_id.split(',').filter(Boolean) : [];
    const statuses  = status    ? status.split(',').filter(Boolean)    : [];
    const methods   = method    ? method.split(',').map(m => m.toUpperCase()).filter(Boolean) : [];

    const AND: Prisma.ConnectionWhereInput[] = [];

    // Non-privileged: restrict to own traffic unless scope=all is explicitly requested
    if (!isPrivileged && scope !== 'all') AND.push({ userId: req.user.sub });
    // Non-privileged cannot filter by arbitrary user_id even in scope=all
    if (isPrivileged && user_id) AND.push({ userId: parseInt(user_id, 10) });

    if (serverIds.length === 1) AND.push({ serverId: serverIds[0] });
    else if (serverIds.length > 1) AND.push({ serverId: { in: serverIds } });

    if (statuses.length === 1) AND.push({ status: statuses[0] as Prisma.EnumConnectionStatusFilter });
    else if (statuses.length > 1) AND.push({ status: { in: statuses as any } });

    if (methods.length === 1) AND.push({ reqMethod: methods[0] });
    else if (methods.length > 1) AND.push({ reqMethod: { in: methods } });

    if (from || to) {
      const range: Prisma.DateTimeFilter = {};
      if (from) range.gte = new Date(from);
      if (to)   range.lte = new Date(to);
      AND.push({ reqTimestamp: range });
    }

    // Multi-condition search: parse `sq` (JSON array) or fall back to legacy `search`
    let searchConditions: SearchCond[] = [];
    if (sq?.trim()) {
      try {
        const parsed = JSON.parse(sq);
        if (Array.isArray(parsed)) {
          searchConditions = parsed.filter(
            (c: unknown): c is SearchCond =>
              typeof c === 'object' && c !== null &&
              typeof (c as SearchCond).term === 'string' &&
              (c as SearchCond).term.trim().length > 0,
          );
        }
      } catch { /* ignore parse errors */ }
    } else if (search?.trim()) {
      searchConditions = [{ term: search.trim(), scopes: [] }];
    }

    const sqLogicVal = sq_logic === 'or' ? 'or' : 'and';

    if (searchConditions.length > 0) {
      const condSets = await Promise.all(
        searchConditions.map(async (cond) => {
          const term = `%${cond.term.trim()}%`;
          const validScopes = (Array.isArray(cond.scopes) ? cond.scopes as string[] : [])
            .filter(s => ALL_SCOPE_KEYS.includes(s));
          const effectiveScopes = validScopes.length > 0 ? validScopes : ALL_SCOPE_KEYS;
          // Column names come from hardcoded SCOPE_COL — only user value ($1) is parameterised
          const clauses = effectiveScopes.map(s => `${SCOPE_COL[s]} ILIKE $1`).join(' OR ');
          const rows = await prism.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM connections WHERE ${clauses}`,
            term,
          );
          return rows.map((r: { id: string }) => r.id);
        }),
      );

      if (sqLogicVal === 'or') {
        const union = new Set(condSets.flat());
        AND.push({ id: { in: [...union] } });
      } else {
        if (condSets.length === 1) {
          AND.push({ id: { in: condSets[0] } });
        } else {
          const sets = condSets.map(s => new Set(s));
          const intersection = [...sets[0]].filter(id => sets.slice(1).every(s => s.has(id)));
          AND.push({ id: { in: intersection } });
        }
      }
    }

    const where: Prisma.ConnectionWhereInput = AND.length ? { AND } : {};

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

    const data = rows.map((c) => fmtConnection(c as any, (c as any).server?.name));
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

    const isPrivileged = req.user.role === 'admin' || req.user.role === 'monitor';
    if (!isPrivileged && c.userId !== req.user.sub) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    reply.send(fmtConnectionDetail(c as any, (c as any).server?.name));
  });

  // GET /api/users  — privileged: list all Gazelle users for filter dropdown
  fastify.get('/users', { preHandler: privileged }, async (_req, reply) => {
    const users = await gazelle.gazelleUser.findMany({
      where: { activated: true, blocked: false },
      select: { id: true, username: true, firstname: true, lastname: true, roles: { select: { roleId: true } } },
      orderBy: { username: 'asc' },
    });
    const data = users.map(u => ({
      id:       u.id,
      username: u.username,
      name:     [u.firstname, u.lastname].filter(Boolean).join(' ') || u.username,
      role:     u.roles.some(r => r.roleId === 1) ? 'admin'
              : u.roles.some(r => r.roleId === 2) ? 'monitor'
              : 'user',
    }));
    reply.send(data);
  });
}
