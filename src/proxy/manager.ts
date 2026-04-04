import http from 'http';
import { prism } from '../db/prism';
import { config } from '../config';
import type { BackendServer } from '@prisma/client';
import { handleRequest } from './pipeline';

export class ProxyManager {
  private readonly listeners = new Map<string, http.Server>();

  /** Start listeners for all active servers from DB. Called once on startup. */
  async init(): Promise<void> {
    const servers = await prism.backendServer.findMany({ where: { isActive: true } });
    const results = await Promise.allSettled(servers.map((s) => this.start(s)));

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        console.error(
          `[ProxyManager] Failed to start listener for "${servers[i].name}" on :${servers[i].proxyPort}:`,
          r.reason,
        );
      }
    }
  }

  async start(server: BackendServer): Promise<void> {
    if (this.listeners.has(server.id)) return;

    const httpServer = http.createServer((req, res) => {
      handleRequest(server, req, res).catch((err) => {
        console.error(`[ProxyManager] Unhandled pipeline error for "${server.name}":`, err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal proxy error');
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(server.proxyPort, '0.0.0.0', resolve);
    });

    this.listeners.set(server.id, httpServer);
    console.log(`[ProxyManager] :${server.proxyPort} → ${server.targetUrl}`);
  }

  async stop(serverId: string): Promise<void> {
    const httpServer = this.listeners.get(serverId);
    if (!httpServer) return;

    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });

    this.listeners.delete(serverId);
  }

  async restart(server: BackendServer): Promise<void> {
    await this.stop(server.id);
    await this.start(server);
  }

  isRunning(serverId: string): boolean {
    return this.listeners.has(serverId);
  }

  async getNextAvailablePort(): Promise<number> {
    const { portStart, portEnd } = config.proxy;

    const rows = await prism.backendServer.findMany({ select: { proxyPort: true } });
    const used = new Set(rows.map((r) => r.proxyPort));

    for (let port = portStart; port <= portEnd; port++) {
      if (!used.has(port)) return port;
    }

    throw new Error(`No available proxy ports in range ${portStart}–${portEnd}`);
  }

  async shutdown(): Promise<void> {
    await Promise.all(Array.from(this.listeners.keys()).map((id) => this.stop(id)));
  }
}

export const proxyManager = new ProxyManager();
