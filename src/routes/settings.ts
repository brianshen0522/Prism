import type { FastifyInstance } from 'fastify';
import { prism } from '../db/prism';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';

const adminOnly = [authenticate, requireRole('admin')];

function validateKnownSetting(key: string, value: string): string | null {
  const trimmed = value.trim();

  switch (key) {
    case 'participant_token_header':
      if (!trimmed) return 'participant_token_header cannot be empty';
      if (!/^[A-Za-z0-9-]+$/.test(trimmed)) {
        return 'participant_token_header must contain only letters, numbers, and hyphens';
      }
      if (trimmed.length > 128) return 'participant_token_header must be 128 characters or fewer';
      return null;

    case 'participant_token_ttl_minutes': {
      const n = Number(trimmed);
      if (!Number.isInteger(n)) return 'participant_token_ttl_minutes must be an integer';
      if (n < 1 || n > 1440) return 'participant_token_ttl_minutes must be between 1 and 1440';
      return null;
    }

    case 'default_body_size_limit_kb': {
      const n = Number(trimmed);
      if (!Number.isInteger(n)) return 'default_body_size_limit_kb must be an integer';
      if (n < 0 || n > 1048576) return 'default_body_size_limit_kb must be between 0 and 1048576';
      return null;
    }

    case 'proxy_request_timeout_ms': {
      const n = Number(trimmed);
      if (!Number.isInteger(n)) return 'proxy_request_timeout_ms must be an integer';
      if (n < 1000 || n > 300000) return 'proxy_request_timeout_ms must be between 1000 and 300000';
      return null;
    }

    case 'dashboard_requests_window_minutes': {
      const n = Number(trimmed);
      if (!Number.isInteger(n)) return 'dashboard_requests_window_minutes must be an integer';
      if (n < 1 || n > 1440) return 'dashboard_requests_window_minutes must be between 1 and 1440';
      return null;
    }

    case 'dashboard_chart_hours': {
      const n = Number(trimmed);
      if (!Number.isInteger(n)) return 'dashboard_chart_hours must be an integer';
      if (n < 1 || n > 168) return 'dashboard_chart_hours must be between 1 and 168';
      return null;
    }

    case 'dashboard_chart_bucket_minutes': {
      const n = Number(trimmed);
      if (!Number.isInteger(n)) return 'dashboard_chart_bucket_minutes must be an integer';
      if (n < 1 || n > 1440) return 'dashboard_chart_bucket_minutes must be between 1 and 1440';
      return null;
    }

    case 'connectathon_name':
      if (!trimmed) return 'connectathon_name cannot be empty';
      if (trimmed.length > 120) return 'connectathon_name must be 120 characters or fewer';
      return null;

    default:
      return null;
  }
}

export async function settingsRoutes(fastify: FastifyInstance) {
  // GET /api/admin/settings
  fastify.get('/admin/settings', { preHandler: adminOnly }, async (_req, reply) => {
    const rows = await prism.systemSetting.findMany({ orderBy: { key: 'asc' } });
    reply.send(rows.map((r) => ({ key: r.key, value: r.value, updated_at: r.updatedAt })));
  });

  // PUT /api/admin/settings/:key — upsert a setting
  fastify.put('/admin/settings/:key', { preHandler: adminOnly }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const { value } = req.body as { value?: string };

    if (typeof value !== 'string') {
      return reply.status(400).send({ error: 'value must be a string' });
    }

    const validationError = validateKnownSetting(key, value);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const row = await prism.systemSetting.upsert({
      where: { key },
      update: { value, updatedBy: req.user.sub },
      create: { key, value, updatedBy: req.user.sub },
    });

    reply.send({ key: row.key, value: row.value, updated_at: row.updatedAt });
  });

  // DELETE /api/admin/settings/:key
  fastify.delete('/admin/settings/:key', { preHandler: adminOnly }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const existing = await prism.systemSetting.findUnique({ where: { key } });
    if (!existing) return reply.status(404).send({ error: 'Setting not found' });
    await prism.systemSetting.delete({ where: { key } });
    reply.status(204).send();
  });
}
