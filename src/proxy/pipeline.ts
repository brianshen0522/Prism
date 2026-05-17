import http from 'http';
import https from 'https';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';
import type { BackendServer } from '@prisma/client';
import { prism } from '../db/prism';
import { verifyAccessToken } from '../lib/jwt';
import { wsManager } from '../ws/manager';
import {
  DEFAULT_PARTICIPANT_TOKEN_HEADER,
  TokenExpiredError,
  decodeParticipantJwt,
  verifyParticipantJwt,
} from '../lib/participant-token';
import { classifyOAuthConnection } from '../oauth/extract';
import { enqueueOAuthReconcile } from '../oauth/reconcile';

type ParticipantTokenInvalidReason = 'expired' | 'revoked' | null;

interface IdentityResult {
  userId: number | null;
  institutionId: number | null;
  username: string | null;
  participantTokenValid: boolean | null;
  participantTokenInvalidReason: ParticipantTokenInvalidReason;
}

// ─── Cached participant-token header name (refreshed every 60 s) ──────────────

let _headerCache: { name: string; at: number } | null = null;

async function getParticipantHeader(): Promise<string> {
  if (_headerCache && Date.now() - _headerCache.at < 60_000) return _headerCache.name;
  const s = await prism.systemSetting.findUnique({ where: { key: 'participant_token_header' } });
  const name = (s?.value || DEFAULT_PARTICIPANT_TOKEN_HEADER).toLowerCase();
  _headerCache = { name, at: Date.now() };
  return name;
}

async function hasParticipantToken(headers: http.IncomingHttpHeaders): Promise<boolean> {
  const headerName = await getParticipantHeader();
  return firstHeader(headers[headerName]) !== null;
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((v) => v.length > 0) ?? null;
  return null;
}

// ─── Hop-by-hop headers that must not be forwarded ───────────────────────────

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

// ─── collectBody ──────────────────────────────────────────────────────────────

function collectBody(stream: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ─── decompressBody ───────────────────────────────────────────────────────────
// Returns the decompressed buffer when Content-Encoding is gzip/deflate/br.
// Falls back to the original buffer if encoding is unknown or decompression fails.

const gunzip   = promisify(zlib.gunzip);
const inflate  = promisify(zlib.inflate);
const brotli   = promisify(zlib.brotliDecompress);

async function decompressBody(buffer: Buffer, encoding: string | undefined): Promise<Buffer> {
  if (!encoding || buffer.length === 0) return buffer;
  try {
    const enc = encoding.toLowerCase().trim();
    if (enc === 'gzip' || enc === 'x-gzip') return await gunzip(buffer);
    if (enc === 'deflate')                  return await inflate(buffer);
    if (enc === 'br')                       return await brotli(buffer);
  } catch {
    // Decompression failed — return original so the client response is unaffected
  }
  return buffer;
}

// ─── filterHeaders ────────────────────────────────────────────────────────────

function filterHeaders(
  headers: http.IncomingHttpHeaders,
  overrideHost?: string,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && value !== undefined) {
      out[key] = value as string | string[];
    }
  }
  if (overrideHost) out['host'] = overrideHost;
  return out;
}

// ─── stripNulls ───────────────────────────────────────────────────────────────
// PostgreSQL TEXT columns reject null bytes (0x00). Strip them from any string
// before it reaches the DB. Headers are sanitized recursively since their values
// can be strings or string arrays.

function stripNulls(s: string): string {
  return s.includes('\0') ? s.replace(/\0/g, '') : s;
}

function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.map(stripNulls) : stripNulls(v);
  }
  return out;
}

// ─── applyBodyLimit ───────────────────────────────────────────────────────────

export function applyBodyLimit(
  buffer: Buffer,
  limitKb: number | null,
  contentType: string | undefined,
): { body: string | null; truncated: boolean } {
  if (buffer.length === 0) return { body: null, truncated: false };

  // Multipart: do not store binary parts
  if (contentType?.includes('multipart/form-data')) {
    return { body: '[multipart/form-data — binary content not stored]', truncated: false };
  }

  // Known binary content types
  if (
    contentType?.includes('application/octet-stream') ||
    contentType?.includes('image/') ||
    contentType?.includes('audio/') ||
    contentType?.includes('video/')
  ) {
    return { body: `[binary: ${buffer.length} bytes]`, truncated: false };
  }

  const limitBytes = limitKb !== null ? limitKb * 1024 : null;

  if (limitBytes === null || buffer.length <= limitBytes) {
    return { body: stripNulls(buffer.toString('utf8')), truncated: false };
  }

  return { body: stripNulls(buffer.subarray(0, limitBytes).toString('utf8')), truncated: true };
}

// ─── identifyUser ─────────────────────────────────────────────────────────────

export async function identifyUser(
  headers: http.IncomingHttpHeaders,
): Promise<IdentityResult> {
  // 1. JWT via Authorization: Bearer <token>
  const authHeader = headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(authHeader.slice(7));
      return {
        userId: payload.sub,
        institutionId: payload.institutionId ?? null,
        username: payload.username,
        participantTokenValid: null,
        participantTokenInvalidReason: null,
      };
    } catch {
      // Invalid or expired — treat as anonymous
    }
  }

  // 2. Participant token via configured header
  const headerName = await getParticipantHeader();
  const tokenValue = firstHeader(headers[headerName]);
  if (tokenValue) {
    try {
      const payload = verifyParticipantJwt(tokenValue);
      const rec = await prism.participantToken.findUnique({
        where: { userId: payload.userId },
      });
      const valid = rec?.token === tokenValue;
      return {
        userId: payload.userId,
        institutionId: payload.institutionId,
        username: null,
        participantTokenValid: valid,
        participantTokenInvalidReason: valid ? null : 'revoked',
      };
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        const payload = decodeParticipantJwt(tokenValue);
        return {
          userId: payload?.userId ?? null,
          institutionId: payload?.institutionId ?? null,
          username: null,
          participantTokenValid: false,
          participantTokenInvalidReason: payload ? 'expired' : null,
        };
      }

      return {
        userId: null,
        institutionId: null,
        username: null,
        participantTokenValid: false,
        participantTokenInvalidReason: null,
      };
    }
  }

  // 3. Anonymous
  return {
    userId: null,
    institutionId: null,
    username: null,
    participantTokenValid: null,
    participantTokenInvalidReason: null,
  };
}

// ─── forwardRequest ───────────────────────────────────────────────────────────

function forwardRequest(
  server: BackendServer,
  req: http.IncomingMessage,
  bodyBuffer: Buffer,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(server.targetUrl);
    const isHttps = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = filterHeaders(req.headers, targetUrl.host);

    // Set correct content-length for the buffered body
    if (bodyBuffer.length > 0) {
      headers['content-length'] = String(bodyBuffer.length);
    } else {
      delete headers['content-length'];
    }

    const defaultPort = isHttps ? 443 : 80;
    const port = targetUrl.port ? parseInt(targetUrl.port, 10) : defaultPort;

    const options: https.RequestOptions = {
      hostname: targetUrl.hostname,
      port,
      path: req.url ?? '/',
      method: req.method,
      headers,
      rejectUnauthorized: server.sslVerify,
    };

    const proxyReq = transport.request(options, resolve);
    proxyReq.on('error', reject);
    if (bodyBuffer.length > 0) proxyReq.write(bodyBuffer);
    proxyReq.end();
  });
}

// ─── handleRequest — the full pipeline ───────────────────────────────────────

export async function handleRequest(
  server: BackendServer,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const reqTimestamp = new Date();
  const startMs = Date.now();

  // Step 1 — Collect request body
  const reqBodyBuffer = await collectBody(req);

  // Step 2 — Identify user (JWT > participant token > anonymous)
  const {
    userId,
    institutionId,
    username,
    participantTokenValid,
    participantTokenInvalidReason,
  } = await identifyUser(req.headers);
  const participantTokenPresent = await hasParticipantToken(req.headers);
  const sanitizedReqHeaders = sanitizeHeaders(req.headers as Record<string, string | string[]>);
  const heartbeatIdHeader = Object.entries(sanitizedReqHeaders).find(
    ([key]) => key.toLowerCase() === 'x-prism-heartbeat-id',
  );
  const heartbeatId = typeof heartbeatIdHeader?.[1] === 'string'
    ? heartbeatIdHeader[1]
    : Array.isArray(heartbeatIdHeader?.[1]) && typeof heartbeatIdHeader[1][0] === 'string'
      ? heartbeatIdHeader[1][0]
      : null;

  // Step 3 — Apply body size limit for storage (full body is always forwarded)
  const { body: reqBody, truncated: reqBodyTruncated } = applyBodyLimit(
    reqBodyBuffer,
    server.bodySizeLimitKb,
    req.headers['content-type'],
  );

  // Step 4 — Record request → DB (status: pending)
  const connection = await prism.connection.create({
    data: {
      userId,
      serverId: server.id,
      status: 'pending',
      reqTimestamp,
      reqMethod: req.method ?? 'UNKNOWN',
      reqUrl: req.url ?? '/',
      reqHeaders: sanitizedReqHeaders,
      reqBody,
      reqBodySize: reqBodyBuffer.length > 0 ? reqBodyBuffer.length : null,
      reqBodyTruncated,
      participantTokenPresent,
      participantTokenValid,
      participantTokenInvalidReason,
      institutionId,
      isSystemHeartbeat: !!heartbeatId,
      heartbeatId,
    } as any,
  });

  wsManager.emitConnectionNew({
    id: connection.id,
    userId,
    institutionId,
    username,
    serverId: server.id,
    reqMethod: req.method ?? 'UNKNOWN',
    reqUrl: req.url ?? '/',
    reqTimestamp,
  });

  // Step 5 — Forward to target
  let proxyRes: http.IncomingMessage;
  try {
    proxyRes = await forwardRequest(server, req, reqBodyBuffer);
  } catch (err) {
    await prism.connection.update({
      where: { id: connection.id },
      data: { status: 'error' },
    });
    wsManager.emitConnectionError({ id: connection.id, userId, institutionId, serverId: server.id });
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Bad Gateway: ${(err as Error).message}`);
    }
    return;
  }

  // Step 6 — Collect response body
  const resBodyBuffer = await collectBody(proxyRes);
  const resTimestamp = new Date();
  const durationMs = Date.now() - startMs;

  // Step 7 — Decompress response body for storage (client always gets original bytes)
  const resBodyForStorage = await decompressBody(
    resBodyBuffer,
    proxyRes.headers['content-encoding'] as string | undefined,
  );
  const { body: resBody, truncated: resBodyTruncated } = applyBodyLimit(
    resBodyForStorage,
    server.bodySizeLimitKb,
    proxyRes.headers['content-type'],
  );
  const oauthMeta = classifyOAuthConnection({
    server: server as any,
    participantHeaderName: await getParticipantHeader(),
    connection: {
      reqUrl: req.url ?? '/',
      reqHeaders: sanitizedReqHeaders,
      reqBody,
      resBody,
      resStatusCode: proxyRes.statusCode ?? null,
      status: 'completed',
    },
  });

  // Step 8 — Record response → DB (status: completed)
  await prism.connection.update({
    where: { id: connection.id },
    data: {
      status: 'completed',
      resId: crypto.randomUUID(),
      resTimestamp,
      resStatusCode: proxyRes.statusCode ?? 0,
      resHeaders: sanitizeHeaders(proxyRes.headers as Record<string, string | string[]>),
      resBody,
      resBodySize: resBodyBuffer.length > 0 ? resBodyBuffer.length : null,
      resBodyTruncated,
      durationMs,
      participantTokenPresent: oauthMeta.participantTokenPresent,
      accessTokenHash: oauthMeta.accessTokenHash,
      accessTokenPreview: oauthMeta.accessTokenPreview,
      refreshTokenHash: oauthMeta.refreshTokenHash,
      refreshTokenPreview: oauthMeta.refreshTokenPreview,
      issuedAccessTokenHash: oauthMeta.issuedAccessTokenHash,
      issuedAccessTokenPreview: oauthMeta.issuedAccessTokenPreview,
      issuedRefreshTokenHash: oauthMeta.issuedRefreshTokenHash,
      issuedRefreshTokenPreview: oauthMeta.issuedRefreshTokenPreview,
      connectionKind: oauthMeta.connectionKind,
      oauthCallerType: oauthMeta.oauthCallerType,
    } as any,
  });

  enqueueOAuthReconcile(connection.id);

  wsManager.emitConnectionCompleted({
    id: connection.id,
    userId,
    institutionId,
    serverId: server.id,
    resStatusCode: proxyRes.statusCode ?? 0,
    durationMs,
  });

  // Step 9 — Return response to client
  const outHeaders = filterHeaders(proxyRes.headers);
  outHeaders['content-length'] = String(resBodyBuffer.length);

  res.writeHead(proxyRes.statusCode ?? 200, outHeaders);
  res.end(resBodyBuffer);
}
