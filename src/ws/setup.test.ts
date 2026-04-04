import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import { signAccessToken } from '../lib/jwt';
import { setupWebSocket } from './setup';

// ─── Spin up a real HTTP+WS server ───────────────────────────────────────────

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
  setupWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function connect(token?: string): Promise<{ ws: WebSocket; firstMsg: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${port}/ws${token ? `?token=${token}` : ''}`;
    const ws = new WebSocket(url);

    ws.once('message', (data) => {
      resolve({ ws, firstMsg: JSON.parse(data.toString()) });
    });

    ws.once('error', reject);
    ws.once('close', (code) => {
      if (code !== 1000) reject(new Error(`Closed with code ${code}`));
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WebSocket setup', () => {
  it('rejects connection with no token (HTTP 101 never fires)', async () => {
    await expect(connect()).rejects.toThrow();
  });

  it('rejects connection with invalid token', async () => {
    await expect(connect('bad.token.here')).rejects.toThrow();
  });

  it('accepts connection with a valid JWT and sends auth:ok', async () => {
    const token = signAccessToken({ sub: 1, username: 'brian9429', role: 'admin' });
    const { ws, firstMsg } = await connect(token);

    expect(firstMsg.type).toBe('auth:ok');
    expect((firstMsg.payload as any).username).toBe('brian9429');
    expect((firstMsg.payload as any).role).toBe('admin');

    ws.close();
  });

  it('subscribes to dashboard channel and receives subscribed ack', async () => {
    const token = signAccessToken({ sub: 1, username: 'brian9429', role: 'admin' });
    const { ws } = await connect(token);

    const ack = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'dashboard' }));
    });

    expect(ack.type).toBe('subscribed');
    expect(ack.channel).toBe('dashboard');

    ws.close();
  });

  it('returns error when regular user tries to subscribe to dashboard', async () => {
    const token = signAccessToken({ sub: 5, username: 'bob', role: 'user' });
    const { ws } = await connect(token);

    const ack = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'dashboard' }));
    });

    expect(ack.type).toBe('error');

    ws.close();
  });

  it('responds pong to ping', async () => {
    const token = signAccessToken({ sub: 1, username: 'brian9429', role: 'admin' });
    const { ws } = await connect(token);

    const pong = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    expect(pong.type).toBe('pong');

    ws.close();
  });

  it('destroys non-/ws upgrade paths', async () => {
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/other`);
        ws.once('error', reject);
        ws.once('close', () => reject(new Error('closed')));
        ws.once('open', () => { resolve(); ws.close(); });
      }),
    ).rejects.toThrow();
  });
});
