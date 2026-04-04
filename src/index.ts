// config MUST be imported first — it sets PRISM_DATABASE_URL and GAZELLE_DATABASE_URL
// before any Prisma client is instantiated
import { config } from './config';
import { buildApp } from './app';
import { proxyManager } from './proxy/manager';
import { computeAndEmitDashboardStats, computeAndEmitServerHealth } from './ws/stats';

async function main() {
  const app = await buildApp();

  const statsIntervals: NodeJS.Timeout[] = [];

  const shutdown = async () => {
    app.log.info('Shutting down...');
    for (const t of statsIntervals) clearInterval(t);
    await proxyManager.shutdown();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.app.port, host: '0.0.0.0' });

  await proxyManager.init();
  app.log.info('Proxy manager initialized');

  // Emit dashboard stats every 5 s, server health every 30 s
  statsIntervals.push(setInterval(() => { computeAndEmitDashboardStats().catch(console.error); }, 5_000));
  statsIntervals.push(setInterval(() => { computeAndEmitServerHealth().catch(console.error); }, 30_000));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
