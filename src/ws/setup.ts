import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyAccessToken } from '../lib/jwt';
import { wsManager } from './manager';

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    // Only handle /ws upgrades
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
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
