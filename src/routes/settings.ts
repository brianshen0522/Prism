import type { FastifyInstance } from 'fastify';
import { prism } from '../db/prism';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';

const adminOnly = [authenticate, requireRole('admin')];

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
