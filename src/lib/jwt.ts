import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface JwtPayload {
  sub: number;
  username: string;
  role: 'admin' | 'monitor' | 'oauth2' | 'user';
  institutionId?: number;
  institutionName?: string;
  iat?: number;
  exp?: number;
}

export function signAccessToken(payload: JwtPayload): string {
  const { iat, exp, ...claims } = payload;
  return jwt.sign(claims, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });
}

const ROLES: readonly unknown[] = ['admin', 'monitor', 'oauth2', 'user'];

export function verifyAccessToken(token: string): JwtPayload {
  const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as unknown as JwtPayload;
  // Traffic scoping is built from these claims, so never accept a token without them
  if (typeof payload.sub !== 'number' || !ROLES.includes(payload.role)) {
    throw new jwt.JsonWebTokenError('invalid access token payload');
  }
  return payload;
}
