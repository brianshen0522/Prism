import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { authenticate } from './authenticate';
import { requireRole } from './authorize';
import { signAccessToken } from '../lib/jwt';

function buildApp() {
  const app = Fastify({ logger: false });

  app.get('/admin-only', { preHandler: [authenticate, requireRole('admin')] }, async () => ({ ok: true }));
  app.get('/admin-or-monitor', { preHandler: [authenticate, requireRole('admin', 'monitor')] }, async () => ({ ok: true }));

  return app;
}

function tok(role: 'admin' | 'monitor' | 'oauth2' | 'user') {
  return `Bearer ${signAccessToken({ sub: 1, username: 'u', role })}`;
}

describe('requireRole', () => {
  it('allows admin to access admin-only route', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: { authorization: tok('admin') } });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when monitor accesses admin-only route', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: { authorization: tok('monitor') } });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when user accesses admin-only route', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: { authorization: tok('user') } });
    expect(res.statusCode).toBe(403);
  });

  it('allows admin to access admin-or-monitor route', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-or-monitor', headers: { authorization: tok('admin') } });
    expect(res.statusCode).toBe(200);
  });

  it('allows monitor to access admin-or-monitor route', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-or-monitor', headers: { authorization: tok('monitor') } });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when oauth2 accesses admin-or-monitor route', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-or-monitor', headers: { authorization: tok('oauth2') } });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when user accesses admin-or-monitor route', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-or-monitor', headers: { authorization: tok('user') } });
    expect(res.statusCode).toBe(403);
  });
});
