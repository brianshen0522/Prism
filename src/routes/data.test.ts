import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../db/prism', () => ({ prism: { backendServer: { findMany: vi.fn().mockResolvedValue([]) } } }));
vi.mock('../db/gazelle', () => ({ gazelle: {} }));
vi.mock('@fastify/static', () => ({ default: async () => {} }));

import { buildApp } from '../app';
import { signAccessToken } from '../lib/jwt';

describe('POST /api/admin/data/import', () => {
  let app: FastifyInstance;
  const importRequest = (headers: Record<string, string>) => app.inject({
    method: 'POST',
    url: '/api/admin/data/import',
    headers: { 'content-type': 'application/json', ...headers },
    payload: '{ not json',
  });

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects anonymous callers before parsing the body', async () => {
    expect((await importRequest({})).statusCode).toBe(401);
  });

  it('rejects non-admins before parsing the body', async () => {
    const token = signAccessToken({ sub: 1, username: 'u', role: 'user' });
    expect((await importRequest({ authorization: `Bearer ${token}` })).statusCode).toBe(403);
  });

  it('still parses the body for admins', async () => {
    const token = signAccessToken({ sub: 1, username: 'a', role: 'admin' });
    expect((await importRequest({ authorization: `Bearer ${token}` })).statusCode).toBe(400);
  });
});

describe('security headers', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('are set on API responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('CORS preflight', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps allowing the methods the API uses', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: { origin: 'https://client.example.com', 'access-control-request-method': 'PUT' },
    });
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
  });
});
