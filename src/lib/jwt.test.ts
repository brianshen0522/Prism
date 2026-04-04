import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken, type JwtPayload } from './jwt';

const PAYLOAD: JwtPayload = { sub: 42, username: 'brian9429', role: 'admin' };

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips a payload', () => {
    const token = signAccessToken(PAYLOAD);
    const result = verifyAccessToken(token);
    expect(result.sub).toBe(42);
    expect(result.username).toBe('brian9429');
    expect(result.role).toBe('admin');
  });

  it('produces a three-part JWT string', () => {
    const token = signAccessToken(PAYLOAD);
    expect(token.split('.')).toHaveLength(3);
  });

  it('throws on a tampered token', () => {
    const token = signAccessToken(PAYLOAD);
    const tampered = token.slice(0, -4) + 'xxxx';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('throws on an expired token', async () => {
    // sign with -1s expiry so it is immediately expired
    const { default: jwt } = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET!;
    const expired = jwt.sign({ sub: 1, username: 'x', role: 'user' }, secret, { expiresIn: -1 });
    expect(() => verifyAccessToken(expired)).toThrow();
  });

  it('throws on a token signed with the wrong secret', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const wrongSecret = jwt.sign({ sub: 1, username: 'x', role: 'user' }, 'wrong_secret_totally_different');
    expect(() => verifyAccessToken(wrongSecret)).toThrow();
  });

  it('preserves all three role values', () => {
    for (const role of ['admin', 'monitor', 'user'] as const) {
      const token = signAccessToken({ sub: 1, username: 'u', role });
      expect(verifyAccessToken(token).role).toBe(role);
    }
  });
});
