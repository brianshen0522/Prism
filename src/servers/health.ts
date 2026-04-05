import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { prism } from '../db/prism';

type StatusLamp = 'green' | 'amber' | 'red' | 'gray';

type ProbeResult = {
  ok: boolean;
  lamp: StatusLamp;
  checkedAt: string;
  responseTimeMs: number | null;
  statusCode: number | null;
  error: string | null;
  details?: string | null;
};

type ProbeHistoryPoint = {
  lamp: StatusLamp;
  checkedAt: string;
};

const HEARTBEAT_HEADER = 'x-prism-heartbeat-id';
const HEARTBEAT_TICK_MS = 5_000;

const backendResults = new Map<string, ProbeResult>();
const heartbeatResults = new Map<string, ProbeResult>();
const backendHistory = new Map<string, ProbeHistoryPoint[]>();
const heartbeatHistory = new Map<string, ProbeHistoryPoint[]>();
const lastHeartbeatAt = new Map<string, number>();
const HISTORY_LIMIT = 24;

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;

function statusLamp(ok: boolean, fallback: StatusLamp = 'red'): StatusLamp {
  return ok ? 'green' : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function readHeader(headers: unknown, name: string): string | null {
  const record = asRecord(headers);
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== name.toLowerCase()) continue;
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return null;
}

async function doFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string> },
  timeoutSeconds: number,
  tlsVerify = true,
) {
  const started = Date.now();
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? https : http;
  const port = target.port
    ? parseInt(target.port, 10)
    : target.protocol === 'https:'
      ? 443
      : 80;

  return new Promise<{ statusCode: number; body: string; responseTimeMs: number }>((resolve, reject) => {
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port,
      path: `${target.pathname}${target.search}`,
      method: init.method ?? 'GET',
      headers: init.headers,
      rejectUnauthorized: tlsVerify,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          responseTimeMs: Date.now() - started,
        });
      });
    });

    req.setTimeout(Math.max(1, timeoutSeconds) * 1000, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

function makeProbeResult(input: Partial<ProbeResult> & { ok: boolean }): ProbeResult {
  return {
    ok: input.ok,
    lamp: input.lamp ?? statusLamp(input.ok),
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    responseTimeMs: input.responseTimeMs ?? null,
    statusCode: input.statusCode ?? null,
    error: input.error ?? null,
    details: input.details ?? null,
  };
}

function pushHistory(target: Map<string, ProbeHistoryPoint[]>, serverId: string, probe: ProbeResult) {
  const next = [...(target.get(serverId) ?? []), { lamp: probe.lamp, checkedAt: probe.checkedAt }].slice(-HISTORY_LIMIT);
  target.set(serverId, next);
}

function setBackendResult(serverId: string, probe: ProbeResult) {
  backendResults.set(serverId, probe);
  pushHistory(backendHistory, serverId, probe);
}

function setHeartbeatResult(serverId: string, probe: ProbeResult) {
  heartbeatResults.set(serverId, probe);
  pushHistory(heartbeatHistory, serverId, probe);
}

function heartbeatDefaultUrl(server: Record<string, any>) {
  const legacyUrl = server.heartbeatUrl as string | undefined;
  const configuredPath = server.heartbeatPath as string | undefined;

  if (legacyUrl && !configuredPath) {
    const parsedLegacy = new URL(legacyUrl);
    if (parsedLegacy.pathname !== '/' || parsedLegacy.search) return legacyUrl;
  }

  const baseUrl = legacyUrl || (server.targetUrl as string | undefined) || '';
  if (!baseUrl) return '';

  const path = configuredPath
    || (server.serverRole === 'authentication' ? '/health' : '/');

  return new URL(path, baseUrl).toString();
}

function backendHeartbeatUrl(server: Record<string, any>) {
  const heartbeatUrl = heartbeatDefaultUrl(server);
  if (!heartbeatUrl) return '';
  const parsed = new URL(heartbeatUrl);
  return new URL(`${parsed.pathname}${parsed.search}`, server.targetUrl as string).toString();
}

async function runDirectBackendHeartbeat(server: Record<string, any>, expectedStatus: number) {
  const url = backendHeartbeatUrl(server);
  if (!url) {
    const probe = makeProbeResult({
      ok: false,
      lamp: 'red',
      error: 'Backend heartbeat URL is not configured',
    });
    backendResults.set(server.id as string, probe);
    return probe;
  }

  const method = (server.heartbeatMethod as string | undefined) || 'GET';
  const timeoutSeconds = (server.heartbeatTimeoutSeconds as number | undefined) || 10;
  const tlsVerify = (server.sslVerify as boolean | undefined) ?? true;

  try {
    const result = await doFetch(url, { method }, timeoutSeconds, tlsVerify);
    const ok = result.statusCode === expectedStatus;
    const probe = makeProbeResult({
      ok,
      lamp: ok ? 'green' : 'red',
      responseTimeMs: result.responseTimeMs,
      statusCode: result.statusCode,
      details: ok ? 'Direct backend heartbeat passed' : `Expected status ${expectedStatus}, received ${result.statusCode}`,
    });
    setBackendResult(server.id as string, probe);
    return probe;
  } catch (error) {
    const probe = makeProbeResult({
      ok: false,
      lamp: 'red',
      error: (error as Error).message,
    });
    setBackendResult(server.id as string, probe);
    return probe;
  }
}

export async function runTargetTest(server: Record<string, any>) {
  const method = (server.targetTestMethod as string | undefined) || 'GET';
  const timeoutSeconds = (server.targetTestTimeoutSeconds as number | undefined) || 10;
  const tlsVerify = (server.sslVerify as boolean | undefined) ?? true;

  try {
    const result = await doFetch(server.targetUrl as string, { method }, timeoutSeconds, tlsVerify);
    const probe = makeProbeResult({
      ok: result.statusCode >= 200 && result.statusCode < 500,
      lamp: result.statusCode >= 200 && result.statusCode < 500 ? 'green' : 'red',
      responseTimeMs: result.responseTimeMs,
      statusCode: result.statusCode,
    });
    setBackendResult(server.id as string, probe);
    return probe;
  } catch (error) {
    const probe = makeProbeResult({
      ok: false,
      lamp: 'red',
      error: (error as Error).message,
    });
    setBackendResult(server.id as string, probe);
    return probe;
  }
}

async function findHeartbeatConnection(serverId: string, heartbeatId: string) {
  const rows = await prism.connection.findMany({
    where: { serverId },
    orderBy: { reqTimestamp: 'desc' },
    take: 20,
  });

  return rows.find((row) => readHeader((row as any).reqHeaders, HEARTBEAT_HEADER) === heartbeatId) ?? null;
}

export async function runHeartbeat(server: Record<string, any>) {
  const url = heartbeatDefaultUrl(server);
  if (!url) {
    const result = makeProbeResult({
      ok: false,
      lamp: 'gray',
      error: 'Heartbeat URL is not configured',
    });
      setHeartbeatResult(server.id as string, result);
      return result;
    }

  const heartbeatId = crypto.randomUUID();
  const method = (server.heartbeatMethod as string | undefined) || 'GET';
  const timeoutSeconds = (server.heartbeatTimeoutSeconds as number | undefined) || 10;
  const expectedStatus = (server.heartbeatExpectedStatus as number | undefined) || 200;
  const tlsVerify = (server.heartbeatTlsVerify as boolean | undefined) ?? true;

  try {
    const sent = await doFetch(url, {
      method,
      headers: {
        [HEARTBEAT_HEADER]: heartbeatId,
      },
    }, timeoutSeconds, tlsVerify);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const connection = await findHeartbeatConnection(server.id as string, heartbeatId);

    if (!connection) {
      const result = makeProbeResult({
        ok: false,
        lamp: 'red',
        responseTimeMs: sent.responseTimeMs,
        statusCode: sent.statusCode,
        error: 'Proxy did not capture heartbeat traffic',
      });
      setHeartbeatResult(server.id as string, result);
      await runDirectBackendHeartbeat(server, expectedStatus);
      return result;
    }

    const interceptedStatus = (connection as any).resStatusCode ?? null;
    const interceptedBody = ((connection as any).resBody ?? '') as string;
    const statusMatches = interceptedStatus === sent.statusCode;
    const bodyMatches = interceptedBody === sent.body || interceptedBody === null;
    const expectedMatches = sent.statusCode === expectedStatus;
    const ok = statusMatches && bodyMatches && expectedMatches;

    const result = makeProbeResult({
      ok,
      lamp: ok ? 'green' : (expectedMatches ? 'amber' : 'red'),
      responseTimeMs: sent.responseTimeMs,
      statusCode: sent.statusCode,
      details: !statusMatches
        ? `Proxy captured ${interceptedStatus}, client received ${sent.statusCode}`
        : !bodyMatches
          ? 'Response body mismatch between proxy capture and client result'
          : expectedMatches
            ? null
            : `Expected status ${expectedStatus}, received ${sent.statusCode}`,
    });
    setHeartbeatResult(server.id as string, result);
    if (ok) {
      setBackendResult(server.id as string, makeProbeResult({
        ok: true,
        lamp: 'green',
        responseTimeMs: sent.responseTimeMs,
        statusCode: sent.statusCode,
        details: 'Verified through proxy heartbeat',
      }));
    } else {
      await runDirectBackendHeartbeat(server, expectedStatus);
    }
    return result;
  } catch (error) {
    const result = makeProbeResult({
      ok: false,
      lamp: 'red',
      error: (error as Error).message,
    });
      setHeartbeatResult(server.id as string, result);
      await runDirectBackendHeartbeat(server, expectedStatus);
      return result;
    }
}

async function tickHeartbeat() {
  if (running) return;
  running = true;
  try {
    const servers = await prism.backendServer.findMany({
      where: { isActive: true, heartbeatEnabled: true as any },
    } as any);
    const now = Date.now();

    for (const server of servers as Array<Record<string, any>>) {
      const intervalSeconds = (server.heartbeatIntervalSeconds as number | undefined) || 60;
      const lastRun = lastHeartbeatAt.get(server.id as string) ?? 0;
      if (now - lastRun < intervalSeconds * 1000) continue;
      lastHeartbeatAt.set(server.id as string, now);
      void runHeartbeat(server).catch(() => undefined);
    }
  } finally {
    running = false;
  }
}

export async function initializeServerHealth() {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => { void tickHeartbeat(); }, HEARTBEAT_TICK_MS);
  await tickHeartbeat();
}

export function shutdownServerHealth() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

export function getServerHealth(serverId: string, heartbeatEnabled = true) {
  return {
    backend: backendResults.get(serverId) ?? makeProbeResult({ ok: false, lamp: 'gray', error: 'Not tested yet' }),
    proxy: heartbeatEnabled
      ? (heartbeatResults.get(serverId) ?? makeProbeResult({ ok: false, lamp: 'gray', error: 'Heartbeat not run yet' }))
      : makeProbeResult({ ok: false, lamp: 'gray', error: 'Heartbeat not enabled' }),
    backendHistory: backendHistory.get(serverId) ?? [],
    proxyHistory: heartbeatEnabled ? (heartbeatHistory.get(serverId) ?? []) : [],
  };
}

export function getHeartbeatHeaderName() {
  return HEARTBEAT_HEADER;
}
