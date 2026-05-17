import jwt, { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { prism } from '../db/prism';

const DEFAULT_TTL_MINUTES = 5;
export const DEFAULT_PARTICIPANT_TOKEN_HEADER = 'X-Participant-Token';

export interface ParticipantTokenPayload {
  userId: number;
  institutionId: number;
  iat?: number;
  exp?: number;
}

function normalizePayload(payload: unknown): ParticipantTokenPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const claims = payload as Record<string, unknown>;
  if (typeof claims.userId !== 'number' || typeof claims.institutionId !== 'number') return null;
  return {
    userId: claims.userId,
    institutionId: claims.institutionId,
    iat: typeof claims.iat === 'number' ? claims.iat : undefined,
    exp: typeof claims.exp === 'number' ? claims.exp : undefined,
  };
}

export function generateParticipantJwt(userId: number, institutionId: number, ttlMinutes: number) {
  const token = jwt.sign({ userId, institutionId }, config.participantTokenSecret, {
    expiresIn: ttlMinutes * 60,
  });
  return {
    token,
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
  };
}

export async function getParticipantTokenTtlMinutes(): Promise<number> {
  const setting = await prism.systemSetting.findUnique({ where: { key: 'participant_token_ttl_minutes' } });
  const value = parseInt(setting?.value ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TTL_MINUTES;
}

export async function getParticipantHeaderName(): Promise<string> {
  const setting = await prism.systemSetting.findUnique({ where: { key: 'participant_token_header' } });
  return setting?.value || DEFAULT_PARTICIPANT_TOKEN_HEADER;
}

function currentStoredTokenMatches(token: string, userId: number, institutionId: number): boolean {
  try {
    const payload = verifyParticipantJwt(token);
    return payload.userId === userId && payload.institutionId === institutionId;
  } catch {
    return false;
  }
}

export async function generateParticipantToken(userId: number, institutionId: number) {
  const ttlMinutes = await getParticipantTokenTtlMinutes();
  const issuedAt = new Date();
  const { token, expiresAt } = generateParticipantJwt(userId, institutionId, ttlMinutes);
  return prism.participantToken.upsert({
    where: { userId },
    create: {
      id: crypto.randomUUID(),
      userId,
      institutionId,
      token,
      expiresAt,
      createdAt: issuedAt,
    },
    update: {
      institutionId,
      token,
      expiresAt,
      createdAt: issuedAt,
    },
  });
}

export async function ensureParticipantToken(userId: number, institutionId: number) {
  const existing = await prism.participantToken.findUnique({ where: { userId } });
  if (
    existing &&
    existing.expiresAt > new Date() &&
    existing.institutionId === institutionId &&
    currentStoredTokenMatches(existing.token, userId, institutionId)
  ) {
    return existing;
  }
  return generateParticipantToken(userId, institutionId);
}

export function verifyParticipantJwt(token: string): ParticipantTokenPayload {
  const payload = normalizePayload(jwt.verify(token, config.participantTokenSecret));
  if (!payload) throw new JsonWebTokenError('invalid participant token payload');
  return payload;
}

export function decodeParticipantJwt(token: string): ParticipantTokenPayload | null {
  return normalizePayload(jwt.decode(token));
}

export { JsonWebTokenError, TokenExpiredError };
