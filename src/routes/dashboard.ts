import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prism } from '../db/prism';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';

const privileged = [authenticate, requireRole('admin', 'monitor', 'oauth2')];

async function getRequestsWindowMinutes(): Promise<number> {
  const s = await prism.systemSetting.findUnique({ where: { key: 'dashboard_requests_window_minutes' } });
  const v = parseInt(s?.value ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
}

async function getChartHours(): Promise<number> {
  const s = await prism.systemSetting.findUnique({ where: { key: 'dashboard_chart_hours' } });
  const v = parseInt(s?.value ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 24;
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/dashboard/stats — summary counts
  fastify.get('/dashboard/stats', { preHandler: privileged }, async (_req, reply) => {
    const windowMinutes = await getRequestsWindowMinutes();
    const sinceWindow = new Date(Date.now() - windowMinutes * 60 * 1000);

    const [totalRequests, requestsLastWindow, errorsLastWindow, activeServers] = await Promise.all([
      prism.connection.count(),
      prism.connection.count({ where: { reqTimestamp: { gte: sinceWindow } } }),
      prism.connection.count({ where: { reqTimestamp: { gte: sinceWindow }, status: 'error' } }),
      prism.backendServer.count({ where: { isActive: true } }),
    ]);

    const errorRate = requestsLastWindow > 0 ? errorsLastWindow / requestsLastWindow : 0;

    reply.send({ totalRequests, requestsLastWindow, errorRate, activeServers, windowMinutes });
  });

  // GET /api/dashboard/chart — request counts for the configured window
  fastify.get('/dashboard/chart', { preHandler: privileged }, async (_req, reply) => {
    type Row = { bucket: Date; count: bigint; errors: bigint };

    const hours = await getChartHours();

    // Use finer granularity for short windows so the chart isn't a single bar
    const bucketTrunc = hours <= 4 ? '10 minutes' : hours <= 24 ? 'hour' : '4 hours';

    const rows = await prism.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        date_trunc(${bucketTrunc}, req_timestamp) AS bucket,
        COUNT(*)::bigint                          AS count,
        COUNT(*) FILTER (WHERE status = 'error')::bigint AS errors
      FROM connections
      WHERE req_timestamp >= NOW() - ${hours} * INTERVAL '1 hour'
      GROUP BY bucket
      ORDER BY bucket
    `);

    reply.send({
      hours,
      data: rows.map((r) => ({
        hour: r.bucket.toISOString(),
        count: Number(r.count),
        errors: Number(r.errors),
      })),
    });
  });

  // GET /api/dashboard/servers — lightweight list for filter dropdowns (all authenticated users)
  fastify.get('/dashboard/servers', { preHandler: [authenticate] }, async (_req, reply) => {
    const servers = await prism.backendServer.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, proxyPort: true, isActive: true },
    });
    reply.send(servers.map((s) => ({
      id: s.id,
      name: s.name,
      proxy_port: s.proxyPort,
      is_active: s.isActive,
    })));
  });
}
