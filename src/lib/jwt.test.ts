import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken, type JwtPayload } from './jwt';

const PAYLOAD: JwtPayload = {
  sub: 42,
  username: 'brian9429',
  role: 'admin',
  institutionId: 456,
  institutionName: 'Taiwan Hospital',
};

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips a payload', () => {
    const token = signAccessToken(PAYLOAD);
    const result = verifyAccessToken(token);
    expect(result.sub).toBe(42);
    expect(result.username).toBe('brian9429');
    expect(result.role).toBe('admin');
    expect(result.institutionId).toBe(456);
    expect(result.institutionName).toBe('Taiwan Hospital');
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
    const expired = jwt.sign(
      { sub: 1, username: 'x', role: 'user', institutionId: 1, institutionName: 'Org' },
      secret,
      { expiresIn: -1 },
    );
    expect(() => verifyAccessToken(expired)).toThrow();
  });

  it('throws on a token signed with the wrong secret', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const wrongSecret = jwt.sign(
      { sub: 1, username: 'x', role: 'user', institutionId: 1, institutionName: 'Org' },
      'wrong_secret_totally_different',
    );
    expect(() => verifyAccessToken(wrongSecret)).toThrow();
  });

  it('preserves all role values', () => {
    for (const role of ['admin', 'monitor', 'oauth2', 'user'] as const) {
      const token = signAccessToken({ sub: 1, username: 'u', role, institutionId: 1, institutionName: 'Org' });
      expect(verifyAccessToken(token).role).toBe(role);
    }
  });
});
