import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { BackendServer } from '@prisma/client';
import { prism } from '../db/prism';
import { proxyManager } from '../proxy/manager';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';
import { getServerHealth, runHeartbeat, runTargetTest } from '../servers/health';

// ─── Response formatter ───────────────────────────────────────────────────────

const SERVER_ROLES = ['generic', 'authentication', 'resource'] as const;

function isStrictBackendUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (!url.hostname) return false;
    if (url.username || url.password) return false;
    if (url.pathname !== '/' || url.search || url.hash) return false;
    return true;
  } catch {
    return false;
  }
}

const strictBackendUrl = z.string().refine(isStrictBackendUrl, {
  message: 'target_url must be an http/https host or IP only, with an optional port',
});

function fmt(s: BackendServer & Record<string, any>) {
  const health = getServerHealth(s.id, s.heartbeatEnabled ?? false);
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    target_url: s.targetUrl,
    is_https: s.isHttps,
    ssl_verify: s.sslVerify,
    proxy_port: s.proxyPort,
    is_active: s.isActive,
    body_size_limit_kb: s.bodySizeLimitKb,
    server_role: s.serverRole,
    oauth_auth_server_id: s.oauthAuthServerId,
    oauth_token_endpoint: s.oauthTokenEndpoint,
    oauth_validation_endpoint: s.oauthValidationEndpoint,
    oauth_validation_success_path: s.oauthValidationSuccessPath,
    oauth_validation_success_value: s.oauthValidationSuccessValue,
    target_test_method: s.targetTestMethod ?? 'GET',
    target_test_timeout_seconds: s.targetTestTimeoutSeconds ?? 10,
    heartbeat_enabled: s.heartbeatEnabled ?? false,
    heartbeat_url: s.heartbeatUrl ?? null,
    heartbeat_path: s.heartbeatPath ?? null,
    heartbeat_method: s.heartbeatMethod ?? 'GET',
    heartbeat_interval_seconds: s.heartbeatIntervalSeconds ?? 60,
    heartbeat_expected_status: s.heartbeatExpectedStatus ?? 200,
    heartbeat_timeout_seconds: s.heartbeatTimeoutSeconds ?? 10,
    heartbeat_tls_verify: s.heartbeatTlsVerify ?? true,
    created_by: s.createdBy,
    created_at: s.createdAt,
    is_running: proxyManager.isRunning(s.id),
    backend_status: health.backend,
    proxy_status: health.proxy,
    backend_history: health.backendHistory,
    proxy_history: health.proxyHistory,
  };
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const createBody = z.object({
  name: z.string().min(1),
  description: z.string().trim().max(2000).nullable().optional(),
  target_url: strictBackendUrl,
  is_https: z.boolean().default(false),
  ssl_verify: z.boolean().default(true),
  proxy_port: z.number().int().min(1024).max(65535).optional(),
  body_size_limit_kb: z.number().int().positive().nullable().optional(),
  server_role: z.enum(SERVER_ROLES).default('generic'),
  oauth_auth_server_id: z.string().uuid().nullable().optional(),
  oauth_token_endpoint: z.string().startsWith('/').nullable().optional(),
  oauth_validation_endpoint: z.string().startsWith('/').nullable().optional(),
  oauth_validation_success_path: z.string().min(1).nullable().optional(),
  oauth_validation_success_value: z.string().min(1).nullable().optional(),
  target_test_method: z.enum(['GET', 'HEAD']).default('GET'),
  target_test_timeout_seconds: z.number().int().min(1).max(120).default(10),
  heartbeat_enabled: z.boolean().default(false),
  heartbeat_url: strictBackendUrl.nullable().optional(),
  heartbeat_path: z.string().startsWith('/').nullable().optional(),
  heartbeat_method: z.enum(['GET', 'HEAD']).default('GET'),
  heartbeat_interval_seconds: z.number().int().min(10).max(86_400).default(60),
  heartbeat_expected_status: z.number().int().min(100).max(599).default(200),
  heartbeat_timeout_seconds: z.number().int().min(1).max(120).default(10),
  heartbeat_tls_verify: z.boolean().default(true),
});

const updateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  target_url: strictBackendUrl.optional(),
  is_https: z.boolean().optional(),
  ssl_verify: z.boolean().optional(),
  is_active: z.boolean().optional(),
  body_size_limit_kb: z.number().int().positive().nullable().optional(),
  server_role: z.enum(SERVER_ROLES).optional(),
  oauth_auth_server_id: z.string().uuid().nullable().optional(),
  oauth_token_endpoint: z.string().startsWith('/').nullable().optional(),
  oauth_validation_endpoint: z.string().startsWith('/').nullable().optional(),
  oauth_validation_success_path: z.string().min(1).nullable().optional(),
  oauth_validation_success_value: z.string().min(1).nullable().optional(),
  target_test_method: z.enum(['GET', 'HEAD']).optional(),
  target_test_timeout_seconds: z.number().int().min(1).max(120).optional(),
  heartbeat_enabled: z.boolean().optional(),
  heartbeat_url: strictBackendUrl.nullable().optional(),
  heartbeat_path: z.string().startsWith('/').nullable().optional(),
  heartbeat_method: z.enum(['GET', 'HEAD']).optional(),
  heartbeat_interval_seconds: z.number().int().min(10).max(86_400).optional(),
  heartbeat_expected_status: z.number().int().min(100).max(599).optional(),
  heartbeat_timeout_seconds: z.number().int().min(1).max(120).optional(),
  heartbeat_tls_verify: z.boolean().optional(),
});

const targetTestBody = z.object({
  target_url: strictBackendUrl,
  ssl_verify: z.boolean().default(true),
  target_test_method: z.enum(['GET', 'HEAD']).default('GET'),
  target_test_timeout_seconds: z.number().int().min(1).max(120).default(10),
});

const heartbeatTestDraftBody = z.object({
  target_url: strictBackendUrl.optional(),
  server_role: z.enum(SERVER_ROLES).optional(),
  oauth_validation_endpoint: z.string().startsWith('/').nullable().optional(),
  heartbeat_enabled: z.boolean().default(true),
  heartbeat_url: strictBackendUrl.nullable().optional(),
  heartbeat_path: z.string().startsWith('/').nullable().optional(),
  heartbeat_method: z.enum(['GET', 'HEAD']).default('GET'),
  heartbeat_expected_status: z.number().int().min(100).max(599).default(200),
  heartbeat_timeout_seconds: z.number().int().min(1).max(120).default(10),
  heartbeat_tls_verify: z.boolean().default(true),
});

const importSchema = z.object({
  export_version: z.string(),
  system: z.literal('Prism'),
  servers: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().trim().max(2000).nullable().optional(),
      target_url: strictBackendUrl,
      is_https: z.boolean().default(false),
      ssl_verify: z.boolean().default(true),
      proxy_port: z.number().int().optional(),
      body_size_limit_kb: z.number().int().positive().nullable().optional(),
      server_role: z.enum(SERVER_ROLES).default('generic').optional(),
      oauth_auth_server_id: z.string().uuid().nullable().optional(),
      oauth_token_endpoint: z.string().startsWith('/').nullable().optional(),
      oauth_validation_endpoint: z.string().startsWith('/').nullable().optional(),
      oauth_validation_success_path: z.string().min(1).nullable().optional(),
      oauth_validation_success_value: z.string().min(1).nullable().optional(),
      target_test_method: z.enum(['GET', 'HEAD']).optional(),
      target_test_timeout_seconds: z.number().int().min(1).max(120).optional(),
      heartbeat_enabled: z.boolean().optional(),
      heartbeat_url: strictBackendUrl.nullable().optional(),
      heartbeat_path: z.string().startsWith('/').nullable().optional(),
      heartbeat_method: z.enum(['GET', 'HEAD']).optional(),
      heartbeat_interval_seconds: z.number().int().min(10).max(86_400).optional(),
      heartbeat_expected_status: z.number().int().min(100).max(599).optional(),
      heartbeat_timeout_seconds: z.number().int().min(1).max(120).optional(),
      heartbeat_tls_verify: z.boolean().optional(),
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
    'id', 'name', 'description', 'target_url', 'is_https', 'ssl_verify',
    'proxy_port', 'is_active', 'body_size_limit_kb',
    'server_role', 'oauth_auth_server_id', 'oauth_token_endpoint',
    'oauth_validation_endpoint', 'oauth_validation_success_path',
    'oauth_validation_success_value', 'target_test_method',
    'target_test_timeout_seconds', 'heartbeat_enabled', 'heartbeat_url', 'heartbeat_path',
    'heartbeat_method', 'heartbeat_interval_seconds', 'heartbeat_expected_status',
    'heartbeat_timeout_seconds', 'heartbeat_tls_verify', 'created_by', 'created_at',
  ];
  const rows = servers.map((s) =>
    [
      s.id,
      s.name,
      (s as BackendServer & Record<string, any>).description,
      s.targetUrl,
      s.isHttps,
      s.sslVerify,
      s.proxyPort,
      s.isActive,
      s.bodySizeLimitKb,
      (s as BackendServer & Record<string, any>).serverRole,
      (s as BackendServer & Record<string, any>).oauthAuthServerId,
      (s as BackendServer & Record<string, any>).oauthTokenEndpoint,
      (s as BackendServer & Record<string, any>).oauthValidationEndpoint,
      (s as BackendServer & Record<string, any>).oauthValidationSuccessPath,
      (s as BackendServer & Record<string, any>).oauthValidationSuccessValue,
      (s as BackendServer & Record<string, any>).targetTestMethod,
      (s as BackendServer & Record<string, any>).targetTestTimeoutSeconds,
      (s as BackendServer & Record<string, any>).heartbeatEnabled,
      (s as BackendServer & Record<string, any>).heartbeatUrl,
      (s as BackendServer & Record<string, any>).heartbeatPath,
      (s as BackendServer & Record<string, any>).heartbeatMethod,
      (s as BackendServer & Record<string, any>).heartbeatIntervalSeconds,
      (s as BackendServer & Record<string, any>).heartbeatExpectedStatus,
      (s as BackendServer & Record<string, any>).heartbeatTimeoutSeconds,
      (s as BackendServer & Record<string, any>).heartbeatTlsVerify,
      s.createdBy,
      s.createdAt.toISOString(),
    ]
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
      servers: servers.map((server) => {
        const s = server as BackendServer & Record<string, any>;
        return {
          name: s.name,
          description: s.description ?? null,
          target_url: s.targetUrl,
          is_https: s.isHttps,
          ssl_verify: s.sslVerify,
          proxy_port: s.proxyPort,
          is_active: s.isActive,
          body_size_limit_kb: s.bodySizeLimitKb,
          server_role: s.serverRole,
          oauth_auth_server_id: s.oauthAuthServerId,
          oauth_token_endpoint: s.oauthTokenEndpoint,
          oauth_validation_endpoint: s.oauthValidationEndpoint,
          oauth_validation_success_path: s.oauthValidationSuccessPath,
          oauth_validation_success_value: s.oauthValidationSuccessValue,
          target_test_method: s.targetTestMethod ?? 'GET',
          target_test_timeout_seconds: s.targetTestTimeoutSeconds ?? 10,
          heartbeat_enabled: s.heartbeatEnabled ?? false,
          heartbeat_url: s.heartbeatUrl ?? null,
          heartbeat_path: s.heartbeatPath ?? null,
          heartbeat_method: s.heartbeatMethod ?? 'GET',
          heartbeat_interval_seconds: s.heartbeatIntervalSeconds ?? 60,
          heartbeat_expected_status: s.heartbeatExpectedStatus ?? 200,
          heartbeat_timeout_seconds: s.heartbeatTimeoutSeconds ?? 10,
          heartbeat_tls_verify: s.heartbeatTlsVerify ?? true,
        };
      }),
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
    const importData = parsed.data as z.infer<typeof importSchema>;

    for (const s of importData.servers) {
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
          description: s.description ?? null,
          targetUrl: s.target_url,
          isHttps: s.is_https,
          sslVerify: s.ssl_verify,
          proxyPort: port,
          isActive: true,
          bodySizeLimitKb: s.body_size_limit_kb ?? null,
          serverRole: s.server_role ?? 'generic',
          oauthAuthServerId: s.oauth_auth_server_id ?? null,
          oauthTokenEndpoint: s.oauth_token_endpoint ?? null,
          oauthValidationEndpoint: s.oauth_validation_endpoint ?? null,
          oauthValidationSuccessPath: s.oauth_validation_success_path ?? 'active',
          oauthValidationSuccessValue: s.oauth_validation_success_value ?? 'true',
          targetTestMethod: s.target_test_method ?? 'GET',
          targetTestTimeoutSeconds: s.target_test_timeout_seconds ?? 10,
          heartbeatEnabled: s.heartbeat_enabled ?? false,
          heartbeatUrl: s.heartbeat_url ?? null,
          heartbeatPath: s.heartbeat_path ?? null,
          heartbeatMethod: s.heartbeat_method ?? 'GET',
          heartbeatIntervalSeconds: s.heartbeat_interval_seconds ?? 60,
          heartbeatExpectedStatus: s.heartbeat_expected_status ?? 200,
          heartbeatTimeoutSeconds: s.heartbeat_timeout_seconds ?? 10,
          heartbeatTlsVerify: s.heartbeat_tls_verify ?? true,
          createdBy: request.user.sub,
        } as any,
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

    const createData = parsed.data as z.infer<typeof createBody>;
    const {
      name,
      description,
      target_url,
      is_https,
      ssl_verify,
      proxy_port,
      body_size_limit_kb,
      server_role,
      oauth_auth_server_id,
      oauth_token_endpoint,
      oauth_validation_endpoint,
      oauth_validation_success_path,
      oauth_validation_success_value,
      target_test_method,
      target_test_timeout_seconds,
      heartbeat_enabled,
      heartbeat_url,
      heartbeat_path,
      heartbeat_method,
      heartbeat_interval_seconds,
      heartbeat_expected_status,
      heartbeat_timeout_seconds,
      heartbeat_tls_verify,
    } = createData;

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
        description: description ?? null,
        targetUrl: target_url,
        isHttps: is_https,
        sslVerify: ssl_verify,
        proxyPort,
        isActive: true,
        bodySizeLimitKb: body_size_limit_kb ?? null,
        serverRole: server_role,
        oauthAuthServerId: oauth_auth_server_id ?? null,
        oauthTokenEndpoint: oauth_token_endpoint ?? null,
        oauthValidationEndpoint: oauth_validation_endpoint ?? null,
        oauthValidationSuccessPath: oauth_validation_success_path ?? 'active',
        oauthValidationSuccessValue: oauth_validation_success_value ?? 'true',
        targetTestMethod: target_test_method ?? 'GET',
        targetTestTimeoutSeconds: target_test_timeout_seconds ?? 10,
        heartbeatEnabled: heartbeat_enabled ?? false,
        heartbeatUrl: heartbeat_url ?? null,
        heartbeatPath: heartbeat_path ?? null,
        heartbeatMethod: heartbeat_method ?? 'GET',
        heartbeatIntervalSeconds: heartbeat_interval_seconds ?? 60,
        heartbeatExpectedStatus: heartbeat_expected_status ?? 200,
        heartbeatTimeoutSeconds: heartbeat_timeout_seconds ?? 10,
        heartbeatTlsVerify: heartbeat_tls_verify ?? true,
        createdBy: request.user.sub,
      } as any,
    });

    try {
      await proxyManager.start(server);
    } catch (err) {
      await prism.backendServer.update({ where: { id: server.id }, data: { isActive: false } });
      return reply.status(500).send({ error: `Server created but listener failed: ${(err as Error).message}` });
    }

    return reply.status(201).send(fmt(server));
  });

  fastify.post('/admin/servers/test-target', { preHandler: adminOnly }, async (request, reply) => {
    const parsed = targetTestBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const result = await runTargetTest({
      id: 'draft-target-test',
      targetUrl: parsed.data.target_url,
      sslVerify: parsed.data.ssl_verify,
      targetTestMethod: parsed.data.target_test_method,
      targetTestTimeoutSeconds: parsed.data.target_test_timeout_seconds,
    });
    return reply.send(result);
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

    const d = parsed.data as z.infer<typeof updateBody>;
    const updated = await prism.backendServer.update({
      where: { id },
      data: {
        name: d.name,
        description: d.description,
        targetUrl: d.target_url,
        isHttps: d.is_https,
        sslVerify: d.ssl_verify,
        isActive: d.is_active,
        bodySizeLimitKb: d.body_size_limit_kb,
        serverRole: d.server_role,
        oauthAuthServerId: d.oauth_auth_server_id,
        oauthTokenEndpoint: d.oauth_token_endpoint,
        oauthValidationEndpoint: d.oauth_validation_endpoint,
        oauthValidationSuccessPath: d.oauth_validation_success_path,
        oauthValidationSuccessValue: d.oauth_validation_success_value,
        targetTestMethod: d.target_test_method,
        targetTestTimeoutSeconds: d.target_test_timeout_seconds,
        heartbeatEnabled: d.heartbeat_enabled,
        heartbeatUrl: d.heartbeat_url,
        heartbeatPath: d.heartbeat_path,
        heartbeatMethod: d.heartbeat_method,
        heartbeatIntervalSeconds: d.heartbeat_interval_seconds,
        heartbeatExpectedStatus: d.heartbeat_expected_status,
        heartbeatTimeoutSeconds: d.heartbeat_timeout_seconds,
        heartbeatTlsVerify: d.heartbeat_tls_verify,
      } as any,
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

  fastify.post('/admin/servers/:id/test-target', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prism.backendServer.findUnique({ where: { id } });
    if (!server) return reply.status(404).send({ error: 'Server not found' });
    const result = await runTargetTest(server as BackendServer & Record<string, any>);
    return reply.send(result);
  });

  fastify.post('/admin/servers/:id/test-heartbeat', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prism.backendServer.findUnique({ where: { id } });
    if (!server) return reply.status(404).send({ error: 'Server not found' });
    const result = await runHeartbeat(server as BackendServer & Record<string, any>);
    return reply.send(result);
  });

  fastify.post('/admin/servers/:id/test-heartbeat-draft', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prism.backendServer.findUnique({ where: { id } });
    if (!server) return reply.status(404).send({ error: 'Server not found' });

    const parsed = heartbeatTestDraftBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const draft = parsed.data;
    const merged = {
      ...(server as BackendServer & Record<string, any>),
      targetUrl: draft.target_url ?? (server as any).targetUrl,
      serverRole: draft.server_role ?? (server as any).serverRole,
      oauthValidationEndpoint: draft.oauth_validation_endpoint ?? (server as any).oauthValidationEndpoint,
      heartbeatEnabled: draft.heartbeat_enabled,
      heartbeatUrl: draft.heartbeat_url ?? null,
      heartbeatPath: draft.heartbeat_path ?? null,
      heartbeatMethod: draft.heartbeat_method,
      heartbeatExpectedStatus: draft.heartbeat_expected_status,
      heartbeatTimeoutSeconds: draft.heartbeat_timeout_seconds,
      heartbeatTlsVerify: draft.heartbeat_tls_verify,
    };

    const result = await runHeartbeat(merged);
    return reply.send(result);
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
