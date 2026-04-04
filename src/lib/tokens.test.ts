import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../db/prism', () => ({
  prism: {
    refreshToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { createRefreshToken, verifyAndRotateRefreshToken, revokeRefreshToken } from './tokens';
import { prism } from '../db/prism';

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const STORED = {
  id: 'rt-uuid-1',
  userId: 7,
  token: '',    // filled per test
  expiresAt: new Date(Date.now() + 86400_000),
  createdAt: new Date(),
};

beforeEach(() => vi.clearAllMocks());

// ─── createRefreshToken ───────────────────────────────────────────────────────

describe('createRefreshToken', () => {
  it('returns a non-empty opaque token string', async () => {
    vi.mocked(prism.refreshToken.create).mockResolvedValue(STORED as any);
    const token = await createRefreshToken(7);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('stores the SHA-256 hash, never the plaintext', async () => {
    vi.mocked(prism.refreshToken.create).mockResolvedValue(STORED as any);
    const token = await createRefreshToken(7);
    const [createArg] = vi.mocked(prism.refreshToken.create).mock.calls[0];
    const storedHash = (createArg as any).data.token as string;
    // stored value must equal sha256(plaintext)
    expect(storedHash).toBe(sha256(token));
    // plaintext must not equal the stored value
    expect(storedHash).not.toBe(token);
  });

  it('stores the correct userId', async () => {
    vi.mocked(prism.refreshToken.create).mockResolvedValue(STORED as any);
    await createRefreshToken(99);
    const [createArg] = vi.mocked(prism.refreshToken.create).mock.calls[0];
    expect((createArg as any).data.userId).toBe(99);
  });

  it('sets expiresAt ~7 days in the future', async () => {
    vi.mocked(prism.refreshToken.create).mockResolvedValue(STORED as any);
    await createRefreshToken(7);
    const [createArg] = vi.mocked(prism.refreshToken.create).mock.calls[0];
    const expires: Date = (createArg as any).data.expiresAt;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expires.getTime()).toBeGreaterThan(Date.now() + sevenDaysMs - 5000);
    expect(expires.getTime()).toBeLessThan(Date.now() + sevenDaysMs + 5000);
  });

  it('returns unique tokens on each call', async () => {
    vi.mocked(prism.refreshToken.create).mockResolvedValue(STORED as any);
    const t1 = await createRefreshToken(1);
    const t2 = await createRefreshToken(1);
    expect(t1).not.toBe(t2);
  });
});

// ─── verifyAndRotateRefreshToken ──────────────────────────────────────────────

describe('verifyAndRotateRefreshToken', () => {
  it('returns userId and deletes the old token on success', async () => {
    const plaintext = 'valid-opaque-token';
    vi.mocked(prism.refreshToken.findFirst).mockResolvedValue({ ...STORED, token: sha256(plaintext) } as any);
    vi.mocked(prism.refreshToken.delete).mockResolvedValue({} as any);

    const result = await verifyAndRotateRefreshToken(plaintext);

    expect(result).toEqual({ id: STORED.id, userId: 7 });
    expect(vi.mocked(prism.refreshToken.delete)).toHaveBeenCalledWith({ where: { id: STORED.id } });
  });

  it('queries by SHA-256 hash of the supplied token', async () => {
    const plaintext = 'lookup-token';
    vi.mocked(prism.refreshToken.findFirst).mockResolvedValue(null);

    await verifyAndRotateRefreshToken(plaintext);

    const [queryArg] = vi.mocked(prism.refreshToken.findFirst).mock.calls[0];
    expect((queryArg as any).where.token).toBe(sha256(plaintext));
  });

  it('returns null when token is not found', async () => {
    vi.mocked(prism.refreshToken.findFirst).mockResolvedValue(null);
    const result = await verifyAndRotateRefreshToken('unknown-token');
    expect(result).toBeNull();
    expect(vi.mocked(prism.refreshToken.delete)).not.toHaveBeenCalled();
  });
});

// ─── revokeRefreshToken ───────────────────────────────────────────────────────

describe('revokeRefreshToken', () => {
  it('deletes by SHA-256 hash', async () => {
    vi.mocked(prism.refreshToken.deleteMany).mockResolvedValue({ count: 1 });
    const plaintext = 'revoke-me';
    await revokeRefreshToken(plaintext);
    expect(vi.mocked(prism.refreshToken.deleteMany)).toHaveBeenCalledWith({
      where: { token: sha256(plaintext) },
    });
  });

  it('does not throw when no matching token exists', async () => {
    vi.mocked(prism.refreshToken.deleteMany).mockResolvedValue({ count: 0 });
    await expect(revokeRefreshToken('nonexistent')).resolves.toBeUndefined();
  });
});
