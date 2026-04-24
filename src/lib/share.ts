import crypto from 'crypto';
import { prism } from '../db/prism';

function generateToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function ensureConnectionShareToken(id: string): Promise<string> {
  const c = await prism.connection.findUnique({ where: { id }, select: { shareToken: true } });
  if (c?.shareToken) return c.shareToken;
  const token = generateToken();
  await prism.connection.update({ where: { id }, data: { shareToken: token } });
  return token;
}

export async function ensurePipelineShareToken(id: string): Promise<string> {
  const p = await prism.oAuthPipeline.findUnique({ where: { id }, select: { shareToken: true } });
  if (p?.shareToken) return p.shareToken;
  const token = generateToken();
  await prism.oAuthPipeline.update({ where: { id }, data: { shareToken: token } });
  return token;
}

export async function ensureConnectionShareTokens(
  ids: (string | null | undefined)[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return {};

  const rows = await prism.connection.findMany({
    where: { id: { in: unique } },
    select: { id: true, shareToken: true },
  });

  const map: Record<string, string> = {};
  const missing: string[] = [];

  for (const row of rows) {
    if (row.shareToken) map[row.id] = row.shareToken;
    else missing.push(row.id);
  }

  for (const id of missing) {
    const token = generateToken();
    await prism.connection.update({ where: { id }, data: { shareToken: token } });
    map[id] = token;
  }

  return map;
}
