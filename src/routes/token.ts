import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prism } from '../db/prism';
import { authenticate } from '../plugins/authenticate';

const DEFAULT_TTL = 5;
export const DEFAULT_HEADER = 'X-Participant-Token';

async function getTtlMinutes(): Promise<number> {
  const s = await prism.systemSetting.findUnique({ where: { key: 'participant_token_ttl_minutes' } });
  const v = parseInt(s?.value ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL;
}

async function getHeaderName(): Promise<string> {
  const s = await prism.systemSetting.findUnique({ where: { key: 'participant_token_header' } });
  return s?.value || DEFAULT_HEADER;
}

async function generateToken(userId: number) {
  const ttl = await getTtlMinutes();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  return prism.participantToken.upsert({
    where: { userId },
    create: { id: crypto.randomUUID(), userId, token, expiresAt },
    update: { token, expiresAt },
  });
}

async function ensureToken(userId: number) {
  const existing = await prism.participantToken.findUnique({ where: { userId } });
  if (existing && existing.expiresAt > new Date()) return existing;
  return generateToken(userId);
}

function fmt(rec: { token: string; expiresAt: Date; createdAt: Date }, headerName: string) {
  return {
    token: rec.token,
    expires_at: rec.expiresAt,
    created_at: rec.createdAt,
    header_name: headerName,
  };
}

export async function tokenRoutes(fastify: FastifyInstance) {
  // GET /api/token — get (or auto-create) the user's participant token
  fastify.get('/token', { preHandler: [authenticate] }, async (req, reply) => {
    const [rec, headerName] = await Promise.all([ensureToken(req.user.sub), getHeaderName()]);
    reply.send(fmt(rec, headerName));
  });

  // POST /api/token/regen — force regenerate immediately
  fastify.post('/token/regen', { preHandler: [authenticate] }, async (req, reply) => {
    const [rec, headerName] = await Promise.all([generateToken(req.user.sub), getHeaderName()]);
    reply.send(fmt(rec, headerName));
  });
}
