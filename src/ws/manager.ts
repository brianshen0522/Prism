import { WebSocket } from 'ws';
import type { JwtPayload } from '../lib/jwt';
import { canSubscribe, type WSMessage } from './channels';

// ─── WSManager ────────────────────────────────────────────────────────────────

interface ClientMeta {
  user: JwtPayload;
  channels: Set<string>;
}

class WSManager {
  private readonly clients = new Map<WebSocket, ClientMeta>();

  addClient(ws: WebSocket, user: JwtPayload): void {
    this.clients.set(ws, { user, channels: new Set() });
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  subscribe(ws: WebSocket, channel: string): { ok: boolean; error?: string } {
    const meta = this.clients.get(ws);
    if (!meta) return { ok: false, error: 'not registered' };

    if (!canSubscribe(meta.user, channel)) {
      return { ok: false, error: 'forbidden' };
    }

    meta.channels.add(channel);
    return { ok: true };
  }

  unsubscribe(ws: WebSocket, channel: string): void {
    this.clients.get(ws)?.channels.delete(channel);
  }

  // Send a message to all clients subscribed to the given channel
  emit(channel: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    for (const [ws, meta] of this.clients) {
      if (meta.channels.has(channel) && ws.readyState === WebSocket.OPEN) {
        ws.send(json);
      }
    }
  }

  // Handle an incoming raw message from a client
  handleMessage(ws: WebSocket, raw: string): void {
    let msg: { type?: string; channel?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      this.send(ws, { type: 'error', error: 'invalid JSON', ts: Date.now() });
      return;
    }

    switch (msg.type) {
      case 'subscribe': {
        if (!msg.channel) {
          this.send(ws, { type: 'error', error: 'channel required', ts: Date.now() });
          return;
        }
        const result = this.subscribe(ws, msg.channel);
        if (result.ok) {
          this.send(ws, { type: 'subscribed', channel: msg.channel, ts: Date.now() });
        } else {
          this.send(ws, { type: 'error', error: result.error, channel: msg.channel, ts: Date.now() });
        }
        break;
      }

      case 'unsubscribe': {
        if (!msg.channel) return;
        this.unsubscribe(ws, msg.channel);
        this.send(ws, { type: 'unsubscribed', channel: msg.channel, ts: Date.now() });
        break;
      }

      case 'ping':
        this.send(ws, { type: 'pong', ts: Date.now() });
        break;

      default:
        this.send(ws, { type: 'error', error: `unknown type: ${msg.type}`, ts: Date.now() });
    }
  }

  // ─── Domain event helpers ─────────────────────────────────────────────────

  emitConnectionNew(data: {
    id: string;
    userId: number | null;
    username: string | null;
    serverId: string;
    reqMethod: string;
    reqUrl: string;
    reqTimestamp: Date;
  }): void {
    const msg: WSMessage = { type: 'connection:new', payload: data, ts: Date.now() };
    this.emit('traffic:all', msg);
    this.emit(`server:${data.serverId}`, msg);
    if (data.userId !== null) {
      this.emit(`traffic:user:${data.userId}`, msg);
    }
  }

  emitConnectionCompleted(data: {
    id: string;
    userId: number | null;
    serverId: string;
    resStatusCode: number;
    durationMs: number;
  }): void {
    const msg: WSMessage = { type: 'connection:completed', payload: data, ts: Date.now() };
    this.emit('traffic:all', msg);
    this.emit(`server:${data.serverId}`, msg);
    if (data.userId !== null) {
      this.emit(`traffic:user:${data.userId}`, msg);
    }
  }

  emitConnectionError(data: { id: string; userId: number | null; serverId: string }): void {
    const msg: WSMessage = { type: 'connection:error', payload: data, ts: Date.now() };
    this.emit('traffic:all', msg);
    this.emit(`server:${data.serverId}`, msg);
    if (data.userId !== null) {
      this.emit(`traffic:user:${data.userId}`, msg);
    }
  }

  emitDashboardStats(payload: {
    totalRequests: number;
    activeServers: number;
    requestsLastWindow: number;
    errorRate: number;
    windowMinutes: number;
  }): void {
    this.emit('dashboard', { type: 'dashboard:stats', payload, ts: Date.now() });
  }

  emitServerHealth(serverId: string, payload: { isRunning: boolean; requestsLast5m: number }): void {
    this.emit(`server:${serverId}`, { type: 'server:health', payload, ts: Date.now() });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

export const wsManager = new WSManager();
