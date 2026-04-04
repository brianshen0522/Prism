import type { JwtPayload } from '../lib/jwt';

// ─── Message shape ────────────────────────────────────────────────────────────

export interface WSMessage {
  type: string;
  channel?: string;
  payload?: unknown;
  error?: string;
  ts: number;
}

// ─── Channel access rules ─────────────────────────────────────────────────────
// dashboard          → admin | monitor
// traffic:all        → admin | monitor
// traffic:user:{id}  → that user OR admin | monitor
// server:{uuid}      → admin | monitor

export function canSubscribe(user: JwtPayload | null, channel: string): boolean {
  if (!user) return false;

  const isPrivileged = user.role === 'admin' || user.role === 'monitor';

  if (channel === 'dashboard' || channel === 'traffic:all') {
    return isPrivileged;
  }

  const userMatch = channel.match(/^traffic:user:(\d+)$/);
  if (userMatch) {
    return isPrivileged || user.sub === Number(userMatch[1]);
  }

  if (/^server:[0-9a-f-]{36}$/i.test(channel)) {
    return isPrivileged;
  }

  return false;
}
