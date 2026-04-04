import crypto from 'crypto';
import { prism } from '../db/prism';

function generateOpaqueToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createRefreshToken(userId: number): Promise<string> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await prism.refreshToken.create({
    data: { userId, token: hashToken(token), expiresAt },
  });

  return token;
}

export async function verifyAndRotateRefreshToken(token: string): Promise<{ id: string; userId: number } | null> {
  const hashed = hashToken(token);

  const stored = await prism.refreshToken.findFirst({
    where: { token: hashed, expiresAt: { gt: new Date() } },
  });

  if (!stored) return null;

  // Rotate: delete old token
  await prism.refreshToken.delete({ where: { id: stored.id } });

  return { id: stored.id, userId: stored.userId };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const hashed = hashToken(token);
  await prism.refreshToken.deleteMany({ where: { token: hashed } });
}
