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

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwt.secret) as unknown as JwtPayload;
}
