import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { config } from './config';
import { authRoutes } from './routes/auth';
import { serverRoutes } from './routes/servers';
import { connectionRoutes } from './routes/connections';
import { tokenRoutes } from './routes/token';
import { dashboardRoutes } from './routes/dashboard';
import { settingsRoutes } from './routes/settings';
import { oauthRoutes } from './routes/oauth';
import { integrationGuideRoutes } from './routes/integration-guide';
import { setupWebSocket } from './ws/setup';
import { initializeServerHealth, shutdownServerHealth } from './servers/health';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.app.env === 'production' ? 'info' : 'debug',
    },
  });

  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(serverRoutes, { prefix: '/api' });
  await app.register(connectionRoutes, { prefix: '/api' });
  await app.register(tokenRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.register(oauthRoutes, { prefix: '/api' });
  await app.register(integrationGuideRoutes, { prefix: '/api' });

  // Serve the React frontend (production build)
  await app.register(staticFiles, {
    root: path.join(__dirname, 'public'),
    wildcard: false,
  });

  // SPA fallback — serve index.html for all non-API routes
  app.setNotFoundHandler((_req, reply) => {
    reply.sendFile('index.html');
  });

  // WebSocket server attached after routes are registered
  app.addHook('onReady', () => {
    setupWebSocket(app.server);
  });

  app.addHook('onReady', async () => {
    await initializeServerHealth();
  });

  app.addHook('onClose', async () => {
    shutdownServerHealth();
  });

  return app;
}
