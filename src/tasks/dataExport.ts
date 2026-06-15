import fs from 'fs';
import { randomUUID } from 'crypto';
import { prism } from '../db/prism';
import { updateTask, exportFilePath, ensureExportDir, cleanupOldTasks } from './manager';

const BATCH_SIZE = 500;

export async function runExport(taskId: string, username: string): Promise<void> {
  try {
    ensureExportDir();
    const fp = exportFilePath(taskId);
    const stream = fs.createWriteStream(fp, 'utf8');

    const w = (s: string): Promise<void> =>
      new Promise((res, rej) => stream.write(s, (e) => (e ? rej(e) : res())));

    await updateTask(taskId, { progress: 2, message: 'Starting export...' });

    await w(
      `{"prism_export_version":"2.0","exported_at":${JSON.stringify(new Date().toISOString())},"exported_by":${JSON.stringify(username)},"data":{`,
    );

    // Settings
    await updateTask(taskId, { progress: 5, message: 'Exporting settings...' });
    const settings = await prism.systemSetting.findMany();
    await w(`"settings":${JSON.stringify(settings)},`);

    // Servers
    await updateTask(taskId, { progress: 10, message: 'Exporting servers...' });
    const servers = await prism.backendServer.findMany({ orderBy: { proxyPort: 'asc' } });
    await w(`"servers":${JSON.stringify(servers)},`);

    // Participant tokens
    await updateTask(taskId, { progress: 15, message: 'Exporting participant tokens...' });
    const tokens = await prism.participantToken.findMany();
    await w(`"participant_tokens":${JSON.stringify(tokens)},`);

    // Connections (batched streaming write)
    await updateTask(taskId, { progress: 20, message: 'Exporting traffic...' });
    const totalConns = await prism.connection.count();
    await w('"connections":[');
    let firstConn = true;
    let offset = 0;
    while (true) {
      const batch = await prism.connection.findMany({
        orderBy: { createdAt: 'asc' },
        skip: offset,
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;
      for (const conn of batch) {
        await w((firstConn ? '' : ',') + JSON.stringify(conn));
        firstConn = false;
      }
      offset += batch.length;
      const prog = 20 + Math.round((offset / Math.max(totalConns, 1)) * 50);
      await updateTask(taskId, {
        progress: Math.min(prog, 70),
        message: `Exporting traffic... (${offset}/${totalConns})`,
      });
      if (batch.length < BATCH_SIZE) break;
    }
    await w('],');

    // OAuth pipelines
    await updateTask(taskId, { progress: 72, message: 'Exporting OAuth pipelines...' });
    let firstPipeline = true;
    await w('"oauth_pipelines":[');
    let pipelineOffset = 0;
    while (true) {
      const batch = await prism.oAuthPipeline.findMany({
        orderBy: { createdAt: 'asc' },
        skip: pipelineOffset,
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;
      for (const p of batch) {
        await w((firstPipeline ? '' : ',') + JSON.stringify(p));
        firstPipeline = false;
      }
      pipelineOffset += batch.length;
      if (batch.length < BATCH_SIZE) break;
    }
    await w('],');

    // Pipeline resource calls
    await updateTask(taskId, { progress: 87, message: 'Exporting pipeline resource calls...' });
    let firstCall = true;
    await w('"oauth_pipeline_resource_calls":[');
    let callOffset = 0;
    while (true) {
      const batch = await prism.oAuthPipelineResourceCall.findMany({
        orderBy: { createdAt: 'asc' },
        skip: callOffset,
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;
      for (const c of batch) {
        await w((firstCall ? '' : ',') + JSON.stringify(c));
        firstCall = false;
      }
      callOffset += batch.length;
      if (batch.length < BATCH_SIZE) break;
    }
    await w(']}}');

    await new Promise<void>((res, rej) => stream.end((e?: Error | null) => (e ? rej(e) : res())));

    const downloadToken = randomUUID();
    await updateTask(taskId, {
      status: 'done',
      progress: 100,
      message: `Export complete. ${totalConns} connections, ${servers.length} servers.`,
      downloadToken,
      completedAt: new Date(),
    });

    await cleanupOldTasks();
  } catch (err) {
    await updateTask(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      completedAt: new Date(),
    }).catch(() => {});
  }
}
