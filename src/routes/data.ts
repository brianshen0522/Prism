import fs from 'fs';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';
import { createTask, getTask, getTaskByDownloadToken, listRecentTasks, exportFilePath } from '../tasks/manager';
import { runExport } from '../tasks/dataExport';
import { runImport, validateExportData } from '../tasks/dataImport';

const adminOnly = [authenticate, requireRole('admin')];

function serializeTask(task: Awaited<ReturnType<typeof getTask>>) {
  if (!task) return null;
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    progress: task.progress,
    message: task.message,
    download_token: task.downloadToken,
    created_by: task.createdBy,
    created_at: task.createdAt,
    completed_at: task.completedAt,
    error: task.error,
  };
}

export async function dataRoutes(fastify: FastifyInstance) {
  // POST /api/admin/data/export — start background export task
  fastify.post('/admin/data/export', { preHandler: adminOnly }, async (req, reply) => {
    const task = await createTask('export', req.user.sub);
    // Fire-and-forget background job
    setImmediate(() => runExport(task.id, req.user.username));
    return reply.status(202).send({ task_id: task.id });
  });

  // GET /api/admin/data/tasks/:id — poll task status
  fastify.get('/admin/data/tasks/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await getTask(id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return reply.send(serializeTask(task));
  });

  // GET /api/admin/data/tasks — list recent tasks
  fastify.get('/admin/data/tasks', { preHandler: adminOnly }, async (_req, reply) => {
    const tasks = await listRecentTasks();
    return reply.send(tasks.map(serializeTask));
  });

  // GET /api/admin/data/download/:token — stream export file (token-auth, no JWT needed)
  fastify.get('/admin/data/download/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const task = await getTaskByDownloadToken(token);
    if (!task || task.status !== 'done' || !task.downloadToken) {
      return reply.status(404).send({ error: 'Download not found or not ready' });
    }
    const fp = exportFilePath(task.id);
    if (!fs.existsSync(fp)) {
      return reply.status(404).send({ error: 'Export file not found on disk' });
    }
    const date = task.createdAt.toISOString().slice(0, 10);
    return reply
      .header('Content-Disposition', `attachment; filename="prism-export-${date}.json"`)
      .header('Content-Type', 'application/json')
      .send(fs.createReadStream(fp));
  });

  // POST /api/admin/data/import — accept export JSON body, start background import task
  fastify.post(
    '/admin/data/import',
    {
      preHandler: adminOnly,
      // Allow large bodies for full dataset imports (up to 512 MB)
      bodyLimit: 512 * 1024 * 1024,
    },
    async (req, reply) => {
      if (!validateExportData(req.body)) {
        return reply.status(400).send({
          error: 'Invalid export format: missing prism_export_version or data fields',
        });
      }
      const task = await createTask('import', req.user.sub);
      setImmediate(() => runImport(task.id, req.body as Parameters<typeof runImport>[1]));
      return reply.status(202).send({ task_id: task.id });
    },
  );
}
