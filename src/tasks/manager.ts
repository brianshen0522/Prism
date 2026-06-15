import fs from 'fs';
import path from 'path';
import { prism } from '../db/prism';

export const EXPORT_DIR = '/tmp/prism-exports';

export function ensureExportDir() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

export function exportFilePath(taskId: string) {
  return path.join(EXPORT_DIR, `${taskId}.json`);
}

export async function createTask(type: 'export' | 'import', userId: number) {
  return prism.adminTask.create({
    data: { type, status: 'running', createdBy: userId },
  });
}

export async function updateTask(
  id: string,
  data: {
    progress?: number;
    message?: string;
    status?: string;
    downloadToken?: string;
    error?: string;
    completedAt?: Date;
  },
) {
  return prism.adminTask.update({ where: { id }, data });
}

export async function getTask(id: string) {
  return prism.adminTask.findUnique({ where: { id } });
}

export async function getTaskByDownloadToken(token: string) {
  return prism.adminTask.findUnique({ where: { downloadToken: token } });
}

export async function listRecentTasks() {
  return prism.adminTask.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

export async function cleanupOldTasks() {
  const old = await prism.adminTask.findMany({
    orderBy: { createdAt: 'desc' },
    skip: 20,
  });
  for (const task of old) {
    const fp = exportFilePath(task.id);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await prism.adminTask.delete({ where: { id: task.id } });
  }
}
