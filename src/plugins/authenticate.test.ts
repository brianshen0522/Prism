import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { authenticate } from './authenticate';
import { signAccessToken } from '../lib/jwt';

function buildApp() {
  const app = Fastify({ logger: false });
  app.get('/protected', { preHandler: authenticate }, async (req) => ({ sub: req.user.sub }));
  return app;
}

describe('authenticate plugin', () => {
  it('sets request.user from a valid Bearer token', async () => {
    const app = buildApp();
    const token = signAccessToken({ sub: 7, username: 'brian9429', role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sub).toBe(7);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a non-Bearer scheme', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for an invalid JWT', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer invalid.jwt.payload' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const app = buildApp();
    const { default: jwt } = await import('jsonwebtoken');
    const bad = jwt.sign({ sub: 1, username: 'x', role: 'user' }, 'wrong-secret');
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${bad}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
