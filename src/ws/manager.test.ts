import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocket } from 'ws';
import { wsManager } from './manager';
import { signAccessToken } from '../lib/jwt';

// ─── Minimal WebSocket stub ───────────────────────────────────────────────────

function makeWS(): { ws: WebSocket; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: vi.fn((data: string) => sent.push(data)),
  } as unknown as WebSocket;
  return { ws, sent };
}

function lastMsg(sent: string[]): Record<string, unknown> {
  return JSON.parse(sent[sent.length - 1]);
}

// ─── Helpers to get a fresh wsManager state each test ────────────────────────

beforeEach(() => {
  // Remove all clients between tests by getting the private map and clearing it
  // Access via casting — test-only introspection
  (wsManager as any).clients.clear();
});

// ─── addClient / removeClient ─────────────────────────────────────────────────

describe('addClient / removeClient', () => {
  it('registers a client', () => {
    const { ws } = makeWS();
    const user = { sub: 1, username: 'brian9429', role: 'admin' as const };
    wsManager.addClient(ws, user);
    expect((wsManager as any).clients.has(ws)).toBe(true);
  });

  it('removes a client', () => {
    const { ws } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'brian9429', role: 'admin' });
    wsManager.removeClient(ws);
    expect((wsManager as any).clients.has(ws)).toBe(false);
  });
});

// ─── subscribe ────────────────────────────────────────────────────────────────

describe('subscribe', () => {
  it('admin can subscribe to dashboard', () => {
    const { ws } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'brian9429', role: 'admin' });
    const result = wsManager.subscribe(ws, 'dashboard');
    expect(result.ok).toBe(true);
  });

  it('monitor can subscribe to traffic:all', () => {
    const { ws } = makeWS();
    wsManager.addClient(ws, { sub: 2, username: 'mon', role: 'monitor' });
    const result = wsManager.subscribe(ws, 'traffic:all');
    expect(result.ok).toBe(true);
  });

  it('user can subscribe to own traffic channel', () => {
    const { ws } = makeWS();
    wsManager.addClient(ws, { sub: 42, username: 'bob', role: 'user' });
    const result = wsManager.subscribe(ws, 'traffic:user:42');
    expect(result.ok).toBe(true);
  });

  it("user cannot subscribe to another user's traffic channel", () => {
    const { ws } = makeWS();
    wsManager.addClient(ws, { sub: 42, username: 'bob', role: 'user' });
    const result = wsManager.subscribe(ws, 'traffic:user:99');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('forbidden');
  });

  it('user cannot subscribe to dashboard', () => {
    const { ws } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'bob', role: 'user' });
    const result = wsManager.subscribe(ws, 'dashboard');
    expect(result.ok).toBe(false);
  });

  it('returns error for unregistered ws', () => {
    const { ws } = makeWS();
    const result = wsManager.subscribe(ws, 'dashboard');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not registered');
  });
});

// ─── handleMessage ────────────────────────────────────────────────────────────

describe('handleMessage', () => {
  it('responds with subscribed on valid subscribe', () => {
    const { ws, sent } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'admin', role: 'admin' });
    wsManager.handleMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'dashboard' }));
    expect(lastMsg(sent).type).toBe('subscribed');
    expect(lastMsg(sent).channel).toBe('dashboard');
  });

  it('responds with error on forbidden subscribe', () => {
    const { ws, sent } = makeWS();
    wsManager.addClient(ws, { sub: 5, username: 'bob', role: 'user' });
    wsManager.handleMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'dashboard' }));
    expect(lastMsg(sent).type).toBe('error');
  });

  it('responds with unsubscribed on unsubscribe', () => {
    const { ws, sent } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'admin', role: 'admin' });
    wsManager.handleMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'traffic:all' }));
    wsManager.handleMessage(ws, JSON.stringify({ type: 'unsubscribe', channel: 'traffic:all' }));
    expect(lastMsg(sent).type).toBe('unsubscribed');
  });

  it('responds pong to ping', () => {
    const { ws, sent } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'admin', role: 'admin' });
    wsManager.handleMessage(ws, JSON.stringify({ type: 'ping' }));
    expect(lastMsg(sent).type).toBe('pong');
  });

  it('responds error for invalid JSON', () => {
    const { ws, sent } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'admin', role: 'admin' });
    wsManager.handleMessage(ws, 'not-json');
    expect(lastMsg(sent).type).toBe('error');
  });

  it('responds error for unknown message type', () => {
    const { ws, sent } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'admin', role: 'admin' });
    wsManager.handleMessage(ws, JSON.stringify({ type: 'explode' }));
    expect(lastMsg(sent).type).toBe('error');
  });
});

// ─── emit ─────────────────────────────────────────────────────────────────────

describe('emit', () => {
  it('delivers message to subscribed client only', () => {
    const { ws: ws1, sent: sent1 } = makeWS();
    const { ws: ws2, sent: sent2 } = makeWS();

    wsManager.addClient(ws1, { sub: 1, username: 'admin', role: 'admin' });
    wsManager.addClient(ws2, { sub: 2, username: 'mon', role: 'monitor' });

    wsManager.subscribe(ws1, 'traffic:all');
    // ws2 does NOT subscribe

    wsManager.emit('traffic:all', { type: 'test', ts: Date.now() });

    expect(sent1.length).toBe(1); // emitted message
    expect(sent2.length).toBe(0);
  });
});

// ─── domain event helpers ─────────────────────────────────────────────────────

describe('emitConnectionNew', () => {
  it('emits to traffic:all and server channel', () => {
    const { ws, sent } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'admin', role: 'admin' });
    wsManager.subscribe(ws, 'traffic:all');

    const serverId = '00000000-0000-0000-0000-000000000001';
    wsManager.emitConnectionNew({
      id: 'conn-1',
      userId: null,
      username: null,
      serverId,
      reqMethod: 'GET',
      reqUrl: '/fhir/Patient',
      reqTimestamp: new Date(),
    });

    const msgs = sent.map((s) => JSON.parse(s));
    expect(msgs.some((m) => m.type === 'connection:new')).toBe(true);
  });

  it("emits to traffic:user channel when userId is set", () => {
    const { ws, sent } = makeWS();
    wsManager.addClient(ws, { sub: 1, username: 'admin', role: 'admin' });
    wsManager.subscribe(ws, 'traffic:user:7');

    wsManager.emitConnectionNew({
      id: 'conn-2',
      userId: 7,
      username: 'brian9429',
      serverId: '00000000-0000-0000-0000-000000000002',
      reqMethod: 'POST',
      reqUrl: '/fhir/Patient',
      reqTimestamp: new Date(),
    });

    const msgs = sent.map((s) => JSON.parse(s));
    expect(msgs.some((m) => m.type === 'connection:new')).toBe(true);
  });
});
