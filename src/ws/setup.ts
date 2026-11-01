import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyAccessToken } from '../lib/jwt';
import { wsManager } from './manager';
import { config } from '../config';

// Clients only send small subscribe/ping control messages
const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;

function parseUpgradeUrl(rawUrl: string | undefined): URL | null {
  try {
    // Fixed base: the URL is only read for its path and query, and Host is client-supplied
    return new URL(rawUrl ?? '/', 'http://localhost');
  } catch {
    return null;
  }
}

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());

    // Only handle /ws upgrades (respects BASE_PATH)
    const url = parseUpgradeUrl(req.url);
    if (url?.pathname !== `${config.app.basePath}/ws`) {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    let user;
    try {
      user = verifyAccessToken(token);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wsManager.addClient(ws, user);

      ws.send(JSON.stringify({
        type: 'auth:ok',
        payload: {
          username: user.username,
          role: user.role,
          institution_id: user.institutionId ?? null,
          institution_name: user.institutionName ?? null,
        },
        ts: Date.now(),
      }));

      ws.on('message', (data) => {
        wsManager.handleMessage(ws, data.toString());
      });

      ws.on('close', () => {
        wsManager.removeClient(ws);
      });

      ws.on('error', () => {
        wsManager.removeClient(ws);
      });
    });
  });
}
