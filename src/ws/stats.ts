import { prism } from '../db/prism';
import { wsManager } from './manager';

let _windowCache: { minutes: number; at: number } | null = null;

async function getRequestsWindowMinutes(): Promise<number> {
  if (_windowCache && Date.now() - _windowCache.at < 60_000) return _windowCache.minutes;
  const s = await prism.systemSetting.findUnique({ where: { key: 'dashboard_requests_window_minutes' } });
  const v = parseInt(s?.value ?? '', 10);
  const minutes = Number.isFinite(v) && v > 0 ? v : 5;
  _windowCache = { minutes, at: Date.now() };
  return minutes;
}

export async function computeAndEmitDashboardStats(): Promise<void> {
  const windowMinutes = await getRequestsWindowMinutes();
  const sinceWindow = new Date(Date.now() - windowMinutes * 60 * 1000);

  const [totalRequests, requestsLastWindow, errorCount, activeServers] = await Promise.all([
    prism.connection.count(),
    prism.connection.count({ where: { reqTimestamp: { gte: sinceWindow } } }),
    prism.connection.count({ where: { reqTimestamp: { gte: sinceWindow }, status: 'error' } }),
    prism.backendServer.count({ where: { isActive: true } }),
  ]);

  const errorRate = requestsLastWindow > 0 ? errorCount / requestsLastWindow : 0;

  wsManager.emitDashboardStats({ totalRequests, activeServers, requestsLastWindow, errorRate, windowMinutes });
}

export async function computeAndEmitServerHealth(): Promise<void> {
  const since5m = new Date(Date.now() - 5 * 60 * 1000);

  const servers = await prism.backendServer.findMany({ where: { isActive: true }, select: { id: true } });

  await Promise.all(
    servers.map(async (s) => {
      const requestsLast5m = await prism.connection.count({
        where: { serverId: s.id, reqTimestamp: { gte: since5m } },
      });
      wsManager.emitServerHealth(s.id, { isRunning: true, requestsLast5m });
    }),
  );
}
