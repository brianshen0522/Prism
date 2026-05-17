import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import zlib from 'zlib';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';
import type { BackendServer } from '@prisma/client';

vi.mock('../db/prism', () => ({
  prism: {
    connection: {
      create: vi.fn(),
      update: vi.fn(),
    },
    participantToken: {
      findUnique: vi.fn(),
    },
    systemSetting: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../ws/manager', () => ({
  wsManager: {
    emitConnectionNew: vi.fn(),
    emitConnectionCompleted: vi.fn(),
    emitConnectionError: vi.fn(),
  },
}));

vi.mock('../oauth/reconcile', () => ({
  enqueueOAuthReconcile: vi.fn(),
}));

import { handleRequest, applyBodyLimit, identifyUser } from './pipeline';
import { signAccessToken } from '../lib/jwt';
import { generateParticipantJwt } from '../lib/participant-token';
import { prism } from '../db/prism';

const INSTITUTION_ID = 456;
const INSTITUTION_NAME = 'Taiwan Hospital';

function participantJwt(userId = 99, institutionId = INSTITUTION_ID) {
  return generateParticipantJwt(userId, institutionId, 5).token;
}

function expiredParticipantJwt(userId = 99, institutionId = INSTITUTION_ID) {
  return jwt.sign(
    { userId, institutionId },
    process.env.PARTICIPANT_TOKEN_SECRET!,
    { expiresIn: -1 },
  );
}

// ─── Shared mock server (acts as the proxy target) ────────────────────────────

const MOCK_CONNECTION = { id: 'conn-uuid-1' };

let targetServer: http.Server;
let targetPort: number;
let proxyServer: http.Server;
let proxyPort: number;
let testBackendServer: BackendServer & Record<string, any>;

// Track what the target server received for assertions
let lastTargetRequest: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string } | null = null;

beforeAll(async () => {
  // Start a real HTTP server to act as the proxy target
  targetServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk.toString()));
    req.on('end', () => {
      lastTargetRequest = { method: req.method!, url: req.url!, headers: req.headers, body };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url, method: req.method, echo: body || undefined }));
    });
  });

  await new Promise<void>((resolve) => targetServer.listen(0, '127.0.0.1', resolve));
  targetPort = (targetServer.address() as AddressInfo).port;

  testBackendServer = {
    id: 'test-server-id',
    name: 'Test FHIR Server',
    targetUrl: `http://127.0.0.1:${targetPort}`,
    isHttps: false,
    sslVerify: true,
    proxyPort: 0,
    isActive: true,
    bodySizeLimitKb: null,
    serverRole: 'generic',
    oauthAuthServerId: null,
    oauthTokenEndpoint: null,
    oauthValidationEndpoint: null,
    oauthValidationSuccessPath: 'active',
    oauthValidationSuccessValue: 'true',
    createdBy: 1,
    createdAt: new Date(),
  } as BackendServer & Record<string, any>;

  // Start a proxy server that calls handleRequest
  proxyServer = http.createServer((req, res) => {
    handleRequest(testBackendServer, req, res).catch((err) => {
      if (!res.headersSent) { res.writeHead(500); res.end(err.message); }
    });
  });

  await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  proxyPort = (proxyServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
  await new Promise<void>((resolve) => targetServer.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  lastTargetRequest = null;
  vi.mocked(prism.connection.create).mockResolvedValue(MOCK_CONNECTION as any);
  vi.mocked(prism.connection.update).mockResolvedValue({} as any);
  vi.mocked(prism.participantToken.findUnique).mockResolvedValue(null);
  vi.mocked(prism.systemSetting.findUnique).mockResolvedValue(null);
});

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function request(opts: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: proxyPort, path: opts.path ?? '/', method: opts.method ?? 'GET', headers: opts.headers ?? {} },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ─── applyBodyLimit ───────────────────────────────────────────────────────────

describe('applyBodyLimit', () => {
  it('returns null for empty buffer', () => {
    const result = applyBodyLimit(Buffer.alloc(0), null, 'application/json');
    expect(result).toEqual({ body: null, truncated: false });
  });

  it('stores full body when limit is null (unlimited)', () => {
    const buf = Buffer.from('{"foo":"bar"}');
    const result = applyBodyLimit(buf, null, 'application/json');
    expect(result).toEqual({ body: '{"foo":"bar"}', truncated: false });
  });

  it('stores full body when under the limit', () => {
    const buf = Buffer.from('hello');
    const result = applyBodyLimit(buf, 10, 'text/plain'); // 10 KB limit, body is 5 bytes
    expect(result).toEqual({ body: 'hello', truncated: false });
  });

  it('truncates body when over the limit', () => {
    const buf = Buffer.from('a'.repeat(3000)); // 3000 bytes
    const result = applyBodyLimit(buf, 1, 'text/plain'); // 1 KB = 1024 bytes
    expect(result.truncated).toBe(true);
    expect(result.body).toHaveLength(1024);
  });

  it('does not store multipart binary content', () => {
    const buf = Buffer.from('--boundary\r\nContent-Disposition: form-data\r\n\r\ndata');
    const result = applyBodyLimit(buf, null, 'multipart/form-data; boundary=boundary');
    expect(result.body).toBe('[multipart/form-data — binary content not stored]');
    expect(result.truncated).toBe(false);
  });

  it('does not store image binary content', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff]); // JPEG magic bytes
    const result = applyBodyLimit(buf, null, 'image/jpeg');
    expect(result.body).toContain('[binary:');
    expect(result.truncated).toBe(false);
  });

  it('strips null bytes from stored body', () => {
    const buf = Buffer.from('hello\0world\0');
    const result = applyBodyLimit(buf, null, 'text/plain');
    expect(result.body).toBe('helloworld');
    expect(result.body).not.toContain('\0');
  });

  it('strips null bytes from truncated body', () => {
    // 1100 bytes with null bytes scattered throughout
    const buf = Buffer.from('a'.repeat(500) + '\0'.repeat(100) + 'b'.repeat(500));
    const result = applyBodyLimit(buf, 1, 'text/plain'); // 1 KB limit
    expect(result.truncated).toBe(true);
    expect(result.body).not.toContain('\0');
  });
});

// ─── identifyUser ─────────────────────────────────────────────────────────────

describe('identifyUser', () => {
  it('returns user_id from a valid JWT', async () => {
    const token = signAccessToken({
      sub: 42,
      username: 'brian9429',
      role: 'admin',
      institutionId: INSTITUTION_ID,
      institutionName: INSTITUTION_NAME,
    });
    const result = await identifyUser({ authorization: `Bearer ${token}` });
    expect(result.userId).toBe(42);
    expect(result.institutionId).toBe(INSTITUTION_ID);
    expect(result.username).toBe('brian9429');
    expect(result.participantTokenValid).toBeNull();
    expect(result.participantTokenInvalidReason).toBeNull();
  });

  it('returns null for an invalid JWT', async () => {
    const result = await identifyUser({ authorization: 'Bearer invalid.jwt.token' });
    expect(result.userId).toBeNull();
    expect(result.institutionId).toBeNull();
    expect(result.username).toBeNull();
    expect(result.participantTokenValid).toBeNull();
    expect(result.participantTokenInvalidReason).toBeNull();
  });

  it('returns null for a missing Authorization header', async () => {
    const result = await identifyUser({});
    expect(result.userId).toBeNull();
    expect(result.institutionId).toBeNull();
    expect(result.username).toBeNull();
    expect(result.participantTokenValid).toBeNull();
    expect(result.participantTokenInvalidReason).toBeNull();
  });

  it('returns user and institution from a valid participant token', async () => {
    const token = participantJwt();
    vi.mocked(prism.participantToken.findUnique).mockResolvedValue({
      id: 'pt-uuid-1',
      userId: 99,
      institutionId: INSTITUTION_ID,
      token,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    } as any);

    const result = await identifyUser({ 'x-participant-token': token });
    expect(result.userId).toBe(99);
    expect(result.institutionId).toBe(INSTITUTION_ID);
    expect(result.username).toBeNull();
    expect(result.participantTokenValid).toBe(true);
    expect(result.participantTokenInvalidReason).toBeNull();
    expect(prism.participantToken.findUnique).toHaveBeenCalledWith({ where: { userId: 99 } });
  });

  it('marks a signed but replaced participant token as revoked', async () => {
    const token = participantJwt();
    vi.mocked(prism.participantToken.findUnique).mockResolvedValue({
      id: 'pt-uuid-1',
      userId: 99,
      institutionId: INSTITUTION_ID,
      token: 'current-token',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    } as any);

    const result = await identifyUser({ 'x-participant-token': token });
    expect(result.userId).toBe(99);
    expect(result.institutionId).toBe(INSTITUTION_ID);
    expect(result.participantTokenValid).toBe(false);
    expect(result.participantTokenInvalidReason).toBe('revoked');
  });

  it('marks an expired participant token while preserving attribution claims', async () => {
    const token = expiredParticipantJwt();
    const result = await identifyUser({ 'x-participant-token': token });
    expect(result.userId).toBe(99);
    expect(result.institutionId).toBe(INSTITUTION_ID);
    expect(result.participantTokenValid).toBe(false);
    expect(result.participantTokenInvalidReason).toBe('expired');
    expect(prism.participantToken.findUnique).not.toHaveBeenCalled();
  });

  it('marks a forged participant token invalid without attribution', async () => {
    const result = await identifyUser({ 'x-participant-token': 'unknown' });
    expect(result.userId).toBeNull();
    expect(result.institutionId).toBeNull();
    expect(result.participantTokenValid).toBe(false);
    expect(result.participantTokenInvalidReason).toBeNull();
  });

  it('prefers JWT over participant token when both are present', async () => {
    const token = signAccessToken({
      sub: 10,
      username: 'admin',
      role: 'admin',
      institutionId: INSTITUTION_ID,
      institutionName: INSTITUTION_NAME,
    });
    vi.mocked(prism.participantToken.findUnique).mockResolvedValue({ userId: 20 } as any);

    const result = await identifyUser({
      authorization: `Bearer ${token}`,
      'x-participant-token': 'some-token',
    });

    expect(result.userId).toBe(10); // JWT wins
    expect(result.institutionId).toBe(INSTITUTION_ID);
    expect(result.username).toBe('admin');
    expect(prism.participantToken.findUnique).not.toHaveBeenCalled();
  });
});

// ─── handleRequest — pipeline integration ────────────────────────────────────

describe('handleRequest (pipeline)', () => {
  it('records a GET request and returns the proxied response', async () => {
    const res = await request({ method: 'GET', path: '/fhir/Patient' });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, path: '/fhir/Patient' });

    // Request recorded with status pending → then updated to completed
    expect(prism.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reqMethod: 'GET',
          reqUrl: '/fhir/Patient',
          status: 'pending',
          userId: null, // anonymous
          institutionId: null,
          participantTokenValid: null,
          participantTokenInvalidReason: null,
          serverId: 'test-server-id',
        }),
      }),
    );

    expect(prism.connection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conn-uuid-1' },
        data: expect.objectContaining({
          status: 'completed',
          resStatusCode: 200,
        }),
      }),
    );
  });

  it('records a POST request with JSON body', async () => {
    const body = JSON.stringify({ resourceType: 'Patient', id: 'example' });

    const res = await request({
      method: 'POST',
      path: '/fhir/Patient',
      headers: { 'content-type': 'application/fhir+json', 'content-length': String(body.length) },
      body,
    });

    expect(res.status).toBe(200);

    expect(prism.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reqMethod: 'POST',
          reqBody: body,
          reqBodyTruncated: false,
        }),
      }),
    );

    // Full body was forwarded to the target
    expect(lastTargetRequest?.body).toBe(body);
  });

  it('records connection with userId from JWT', async () => {
    const token = signAccessToken({
      sub: 7,
      username: 'brian9429',
      role: 'user',
      institutionId: INSTITUTION_ID,
      institutionName: INSTITUTION_NAME,
    });

    await request({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(prism.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 7,
          institutionId: INSTITUTION_ID,
          participantTokenValid: null,
          participantTokenInvalidReason: null,
        }),
      }),
    );
  });

  it('records connection attribution from a valid participant token', async () => {
    const token = participantJwt(55);
    vi.mocked(prism.participantToken.findUnique).mockResolvedValue({
      id: 'pt-1',
      userId: 55,
      institutionId: INSTITUTION_ID,
      token,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    } as any);

    await request({ headers: { 'x-participant-token': token } });

    expect(prism.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 55,
          institutionId: INSTITUTION_ID,
          participantTokenPresent: true,
          participantTokenValid: true,
          participantTokenInvalidReason: null,
        }),
      }),
    );
  });

  it('records expired participant token attribution as invalid', async () => {
    const token = expiredParticipantJwt(55);

    await request({ headers: { 'x-participant-token': token } });

    expect(prism.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 55,
          institutionId: INSTITUTION_ID,
          participantTokenPresent: true,
          participantTokenValid: false,
          participantTokenInvalidReason: 'expired',
        }),
      }),
    );
  });

  it('truncates request body that exceeds body_size_limit_kb', async () => {
    const limitedServer: BackendServer = { ...testBackendServer, bodySizeLimitKb: 1 }; // 1 KB

    const bigBody = 'x'.repeat(3000); // 3 KB

    const proxyWithLimit = http.createServer((req, res) => {
      handleRequest(limitedServer, req, res).catch(() => {
        res.writeHead(500); res.end();
      });
    });
    await new Promise<void>((resolve) => proxyWithLimit.listen(0, '127.0.0.1', resolve));
    const limitedPort = (proxyWithLimit.address() as AddressInfo).port;

    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: limitedPort, path: '/', method: 'POST',
            headers: { 'content-type': 'text/plain', 'content-length': String(bigBody.length) } },
          (res) => { res.resume(); res.on('end', resolve); },
        );
        req.on('error', reject);
        req.write(bigBody);
        req.end();
      });

      const createCall = vi.mocked(prism.connection.create).mock.calls[0][0] as any;
      expect(createCall.data.reqBodyTruncated).toBe(true);
      expect(createCall.data.reqBody).toHaveLength(1024); // exactly 1 KB stored
    } finally {
      await new Promise<void>((resolve) => proxyWithLimit.close(() => resolve()));
    }
  });

  it('records status=error and returns 502 when target is unreachable', async () => {
    const deadServer: BackendServer = { ...testBackendServer, targetUrl: 'http://127.0.0.1:1' }; // port 1 = unreachable

    const proxyDead = http.createServer((req, res) => {
      handleRequest(deadServer, req, res).catch(() => { res.writeHead(500); res.end(); });
    });
    await new Promise<void>((resolve) => proxyDead.listen(0, '127.0.0.1', resolve));
    const deadPort = (proxyDead.address() as AddressInfo).port;

    try {
      const res = await request({ port: deadPort } as any);
      // Can't use request() helper here since it uses proxyPort — make raw request
      const rawRes = await new Promise<{ status: number }>((resolve, reject) => {
        const r = http.request(
          { hostname: '127.0.0.1', port: deadPort, path: '/', method: 'GET' },
          (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode! })); },
        );
        r.on('error', reject);
        r.end();
      });

      expect(rawRes.status).toBe(502);

      expect(prism.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'error' }),
        }),
      );
    } finally {
      await new Promise<void>((resolve) => proxyDead.close(() => resolve()));
    }
  });

  it('records duration_ms in the completed connection', async () => {
    await request({ path: '/slow' });

    const updateCall = vi.mocked(prism.connection.update).mock.calls[0][0] as any;
    expect(typeof updateCall.data.durationMs).toBe('number');
    expect(updateCall.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('stores response status code and headers', async () => {
    await request({ path: '/fhir/metadata' });

    const updateCall = vi.mocked(prism.connection.update).mock.calls[0][0] as any;
    expect(updateCall.data.resStatusCode).toBe(200);
    expect(updateCall.data.resHeaders).toBeDefined();
  });

  it('decompresses gzip response body before storing', async () => {
    const plainText = JSON.stringify({ resourceType: 'Bundle', entry: [] });
    const compressed = zlib.gzipSync(Buffer.from(plainText));

    const gzipTarget = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/fhir+json',
        'Content-Encoding': 'gzip',
        'Content-Length': String(compressed.length),
      });
      res.end(compressed);
    });
    await new Promise<void>((resolve) => gzipTarget.listen(0, '127.0.0.1', resolve));
    const gzipTargetPort = (gzipTarget.address() as AddressInfo).port;

    const gzipBackend: BackendServer = {
      ...testBackendServer,
      targetUrl: `http://127.0.0.1:${gzipTargetPort}`,
    };
    const gzipProxy = http.createServer((req, res) => {
      handleRequest(gzipBackend, req, res).catch(() => { res.writeHead(500); res.end(); });
    });
    await new Promise<void>((resolve) => gzipProxy.listen(0, '127.0.0.1', resolve));
    const gzipProxyPort = (gzipProxy.address() as AddressInfo).port;

    try {
      // Client receives original compressed bytes (browser handles decompression)
      const clientRes = await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const r = http.request(
          { hostname: '127.0.0.1', port: gzipProxyPort, path: '/', method: 'GET' },
          (res) => {
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
          },
        );
        r.on('error', reject);
        r.end();
      });

      expect(clientRes.status).toBe(200);
      // Client got the compressed bytes (same as what the target sent)
      expect(clientRes.body).toEqual(compressed);

      // DB stored the decompressed, human-readable body
      const updateCall = vi.mocked(prism.connection.update).mock.calls[0][0] as any;
      expect(updateCall.data.resBody).toBe(plainText);
      expect(updateCall.data.resBodyTruncated).toBe(false);
    } finally {
      await new Promise<void>((resolve) => gzipProxy.close(() => resolve()));
      await new Promise<void>((resolve) => gzipTarget.close(() => resolve()));
    }
  });

  it('forwards the full body to the target regardless of storage limit', async () => {
    const limitedServer: BackendServer = { ...testBackendServer, bodySizeLimitKb: 1 };

    const proxyWithLimit = http.createServer((req, res) => {
      handleRequest(limitedServer, req, res).catch(() => { res.writeHead(500); res.end(); });
    });
    await new Promise<void>((resolve) => proxyWithLimit.listen(0, '127.0.0.1', resolve));
    const limitedPort = (proxyWithLimit.address() as AddressInfo).port;

    const bigBody = 'x'.repeat(3000);

    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: limitedPort, path: '/', method: 'POST',
            headers: { 'content-type': 'text/plain', 'content-length': String(bigBody.length) } },
          (res) => { res.resume(); res.on('end', resolve); },
        );
        req.on('error', reject);
        req.write(bigBody);
        req.end();
      });

      // Target received the full 3 KB body
      expect(lastTargetRequest?.body).toHaveLength(3000);
    } finally {
      await new Promise<void>((resolve) => proxyWithLimit.close(() => resolve()));
    }
  });
});
