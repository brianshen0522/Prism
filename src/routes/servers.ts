import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { BackendServer } from '@prisma/client';
import { prism } from '../db/prism';
import { proxyManager } from '../proxy/manager';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';

// ─── Response formatter ───────────────────────────────────────────────────────

function fmt(s: BackendServer) {
  return {
    id: s.id,
    name: s.name,
    target_url: s.targetUrl,
    is_https: s.isHttps,
    ssl_verify: s.sslVerify,
    proxy_port: s.proxyPort,
    is_active: s.isActive,
    body_size_limit_kb: s.bodySizeLimitKb,
    created_by: s.createdBy,
    created_at: s.createdAt,
    is_running: proxyManager.isRunning(s.id),
  };
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const createBody = z.object({
  name: z.string().min(1),
  target_url: z.string().url(),
  is_https: z.boolean().default(false),
  ssl_verify: z.boolean().default(true),
  proxy_port: z.number().int().min(1024).max(65535).optional(),
  body_size_limit_kb: z.number().int().positive().nullable().optional(),
});

const updateBody = z.object({
  name: z.string().min(1).optional(),
  target_url: z.string().url().optional(),
  is_https: z.boolean().optional(),
  ssl_verify: z.boolean().optional(),
  is_active: z.boolean().optional(),
  body_size_limit_kb: z.number().int().positive().nullable().optional(),
});

const importSchema = z.object({
  export_version: z.string(),
  system: z.literal('Prism'),
  servers: z.array(
    z.object({
      name: z.string().min(1),
      target_url: z.string().url(),
      is_https: z.boolean().default(false),
      ssl_verify: z.boolean().default(true),
      proxy_port: z.number().int().optional(),
      body_size_limit_kb: z.number().int().positive().nullable().optional(),
    }),
  ),
});

// ─── CSV serializer ───────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(servers: BackendServer[]): string {
  const headers = [
    'id', 'name', 'target_url', 'is_https', 'ssl_verify',
    'proxy_port', 'is_active', 'body_size_limit_kb', 'created_by', 'created_at',
  ];
  const rows = servers.map((s) =>
    [s.id, s.name, s.targetUrl, s.isHttps, s.sslVerify, s.proxyPort, s.isActive, s.bodySizeLimitKb, s.createdBy, s.createdAt.toISOString()]
      .map(csvCell)
      .join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const serverRoutes: FastifyPluginAsync = async (fastify) => {
  const adminOnly = [authenticate, requireRole('admin')];

  // ── GET /api/servers — all authenticated users ─────────────────────────────

  fastify.get('/servers', { preHandler: authenticate }, async (_req, reply) => {
    const servers = await prism.backendServer.findMany({
      where: { isActive: true },
      orderBy: { proxyPort: 'asc' },
    });
    return reply.send(
      servers.map((s) => ({
        id: s.id,
        name: s.name,
        proxy_port: s.proxyPort,
        is_active: s.isActive,
        is_running: proxyManager.isRunning(s.id),
      })),
    );
  });

  // ── Export routes must be registered before /:id ──────────────────────────

  fastify.get('/admin/servers/export', { preHandler: adminOnly }, async (request, reply) => {
    const servers = await prism.backendServer.findMany({ orderBy: { proxyPort: 'asc' } });
    return reply.header('Content-Disposition', 'attachment; filename="prism-servers.json"').send({
      export_version: '1.0',
      exported_at: new Date().toISOString(),
      exported_by: request.user.username,
      system: 'Prism',
      servers: servers.map((s) => ({
        name: s.name,
        target_url: s.targetUrl,
        is_https: s.isHttps,
        ssl_verify: s.sslVerify,
        proxy_port: s.proxyPort,
        is_active: s.isActive,
        body_size_limit_kb: s.bodySizeLimitKb,
      })),
    });
  });

  fastify.get('/admin/servers/export/csv', { preHandler: adminOnly }, async (_req, reply) => {
    const servers = await prism.backendServer.findMany({ orderBy: { proxyPort: 'asc' } });
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="prism-servers.csv"')
      .send(toCSV(servers));
  });

  // ── POST /api/admin/servers/import ────────────────────────────────────────

  fastify.post('/admin/servers/import', { preHandler: adminOnly }, async (request, reply) => {
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid import format', details: parsed.error.flatten() });
    }

    const warnings: string[] = [];
    const created: ReturnType<typeof fmt>[] = [];

    for (const s of parsed.data.servers) {
      let port = s.proxy_port;

      if (port !== undefined) {
        const conflict = await prism.backendServer.findFirst({ where: { proxyPort: port } });
        if (conflict) {
          const old = port;
          port = await proxyManager.getNextAvailablePort();
          warnings.push(`Port ${old} in use by "${conflict.name}"; reassigned port ${port} to "${s.name}"`);
        }
      } else {
        port = await proxyManager.getNextAvailablePort();
      }

      const server = await prism.backendServer.create({
        data: {
          name: s.name,
          targetUrl: s.target_url,
          isHttps: s.is_https,
          sslVerify: s.ssl_verify,
          proxyPort: port,
          isActive: true,
          bodySizeLimitKb: s.body_size_limit_kb ?? null,
          createdBy: request.user.sub,
        },
      });

      try {
        await proxyManager.start(server);
      } catch (err) {
        await prism.backendServer.update({ where: { id: server.id }, data: { isActive: false } });
        warnings.push(`Server "${s.name}" created but listener failed: ${(err as Error).message}`);
      }

      created.push(fmt(server));
    }

    return reply.status(201).send({ created: created.length, warnings, servers: created });
  });

  // ── GET /api/admin/servers — list all (admin) ─────────────────────────────

  fastify.get('/admin/servers', { preHandler: adminOnly }, async (_req, reply) => {
    const servers = await prism.backendServer.findMany({ orderBy: { proxyPort: 'asc' } });
    return reply.send(servers.map(fmt));
  });

  // ── POST /api/admin/servers — create ──────────────────────────────────────

  fastify.post('/admin/servers', { preHandler: adminOnly }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const { name, target_url, is_https, ssl_verify, proxy_port, body_size_limit_kb } = parsed.data;

    let proxyPort: number;
    if (proxy_port !== undefined) {
      const conflict = await prism.backendServer.findFirst({ where: { proxyPort: proxy_port } });
      if (conflict) {
        return reply.status(409).send({ error: `Port ${proxy_port} is already assigned to "${conflict.name}"` });
      }
      proxyPort = proxy_port;
    } else {
      try {
        proxyPort = await proxyManager.getNextAvailablePort();
      } catch (err) {
        return reply.status(507).send({ error: (err as Error).message });
      }
    }

    const server = await prism.backendServer.create({
      data: {
        name,
        targetUrl: target_url,
        isHttps: is_https,
        sslVerify: ssl_verify,
        proxyPort,
        isActive: true,
        bodySizeLimitKb: body_size_limit_kb ?? null,
        createdBy: request.user.sub,
      },
    });

    try {
      await proxyManager.start(server);
    } catch (err) {
      await prism.backendServer.update({ where: { id: server.id }, data: { isActive: false } });
      return reply.status(500).send({ error: `Server created but listener failed: ${(err as Error).message}` });
    }

    return reply.status(201).send(fmt(server));
  });

  // ── GET /api/admin/servers/:id ────────────────────────────────────────────

  fastify.get('/admin/servers/:id', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prism.backendServer.findUnique({ where: { id } });
    if (!server) return reply.status(404).send({ error: 'Server not found' });
    return reply.send(fmt(server));
  });

  // ── PUT /api/admin/servers/:id — update ───────────────────────────────────

  fastify.put('/admin/servers/:id', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const existing = await prism.backendServer.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Server not found' });

    const d = parsed.data;
    const updated = await prism.backendServer.update({
      where: { id },
      data: {
        name: d.name,
        targetUrl: d.target_url,
        isHttps: d.is_https,
        sslVerify: d.ssl_verify,
        isActive: d.is_active,
        bodySizeLimitKb: d.body_size_limit_kb,
      },
    });

    const proxyConfigChanged =
      d.target_url !== undefined || d.is_https !== undefined || d.ssl_verify !== undefined;

    if (existing.isActive && !updated.isActive) {
      await proxyManager.stop(id);
    } else if (!existing.isActive && updated.isActive) {
      await proxyManager.start(updated);
    } else if (updated.isActive && proxyConfigChanged) {
      await proxyManager.restart(updated);
    }

    return reply.send(fmt(updated));
  });

  // ── DELETE /api/admin/servers/:id — deactivate ────────────────────────────

  fastify.delete('/admin/servers/:id', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prism.backendServer.findUnique({ where: { id } });
    if (!server) return reply.status(404).send({ error: 'Server not found' });

    await proxyManager.stop(id);
    await prism.$transaction([
      prism.connection.deleteMany({ where: { serverId: id } }),
      prism.backendServer.delete({ where: { id } }),
    ]);

    return reply.status(204).send();
  });

  // ── Proxy listener controls ───────────────────────────────────────────────

  fastify.post('/admin/servers/:id/start', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prism.backendServer.findUnique({ where: { id } });
    if (!server) return reply.status(404).send({ error: 'Server not found' });
    if (proxyManager.isRunning(id)) return reply.send(fmt(server));
    try {
      await proxyManager.start(server);
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
    return reply.send(fmt(server));
  });

  fastify.post('/admin/servers/:id/stop', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prism.backendServer.findUnique({ where: { id } });
    if (!server) return reply.status(404).send({ error: 'Server not found' });
    await proxyManager.stop(id);
    return reply.send(fmt(server));
  });

  fastify.post('/admin/servers/:id/restart', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prism.backendServer.findUnique({ where: { id } });
    if (!server) return reply.status(404).send({ error: 'Server not found' });
    try {
      await proxyManager.restart(server);
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
    return reply.send(fmt(server));
  });
};
