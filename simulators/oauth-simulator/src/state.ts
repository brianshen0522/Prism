import crypto from 'crypto';

export type IssuedToken = {
  accessToken: string;
  refreshToken: string;
  issuedAt: string;
  scope: string;
  subject: string;
};

export class TokenStore {
  private readonly accessTokens = new Map<string, IssuedToken>();
  private readonly refreshTokens = new Map<string, IssuedToken>();

  issue(scope: string): IssuedToken {
    const accessToken = `atk_${crypto.randomBytes(18).toString('hex')}`;
    const refreshToken = `rtk_${crypto.randomBytes(18).toString('hex')}`;
    const token: IssuedToken = {
      accessToken,
      refreshToken,
      issuedAt: new Date().toISOString(),
      scope,
      subject: 'simulated-client',
    };
    this.accessTokens.set(accessToken, token);
    this.refreshTokens.set(refreshToken, token);
    return token;
  }

  get(accessToken: string): IssuedToken | null {
    return this.accessTokens.get(accessToken) ?? null;
  }

  exchangeRefreshToken(refreshToken: string): IssuedToken | null {
    const existing = this.refreshTokens.get(refreshToken);
    if (!existing) return null;

    this.refreshTokens.delete(refreshToken);
    return this.issue(existing.scope);
  }
}
