import { describe, it, expect } from 'vitest';
import { canSubscribe, type WSMessage } from './channels';
import type { JwtPayload } from '../lib/jwt';

const admin: JwtPayload   = { sub: 1, username: 'admin', role: 'admin' };
const monitor: JwtPayload = { sub: 2, username: 'mon',   role: 'monitor' };
const oauth2: JwtPayload  = { sub: 3, username: 'oauth', role: 'oauth2' };
const user: JwtPayload    = { sub: 10, username: 'bob',  role: 'user', institutionId: 456, institutionName: 'Taiwan Hospital' };

const SERVER_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('canSubscribe', () => {
  // ── dashboard ──────────────────────────────────────────────────────────────
  it('allows admin to subscribe to dashboard', () => {
    expect(canSubscribe(admin, 'dashboard')).toBe(true);
  });

  it('allows monitor to subscribe to dashboard', () => {
    expect(canSubscribe(monitor, 'dashboard')).toBe(true);
  });

  it('allows oauth2 to subscribe to dashboard', () => {
    expect(canSubscribe(oauth2, 'dashboard')).toBe(true);
  });

  it('denies user from subscribing to dashboard', () => {
    expect(canSubscribe(user, 'dashboard')).toBe(false);
  });

  // ── traffic:all ────────────────────────────────────────────────────────────
  it('allows admin to subscribe to traffic:all', () => {
    expect(canSubscribe(admin, 'traffic:all')).toBe(true);
  });

  it('allows monitor to subscribe to traffic:all', () => {
    expect(canSubscribe(monitor, 'traffic:all')).toBe(true);
  });

  it('allows oauth2 to subscribe to traffic:all', () => {
    expect(canSubscribe(oauth2, 'traffic:all')).toBe(true);
  });

  it('denies user from subscribing to traffic:all', () => {
    expect(canSubscribe(user, 'traffic:all')).toBe(false);
  });

  // ── traffic:user:{id} ──────────────────────────────────────────────────────
  it('allows a user to subscribe to their own traffic channel', () => {
    expect(canSubscribe(user, 'traffic:user:10')).toBe(true);
  });

  it('allows admin to subscribe to any user traffic channel', () => {
    expect(canSubscribe(admin, 'traffic:user:10')).toBe(true);
    expect(canSubscribe(admin, 'traffic:user:999')).toBe(true);
  });

  it('allows monitor to subscribe to any user traffic channel', () => {
    expect(canSubscribe(monitor, 'traffic:user:10')).toBe(true);
  });

  it('allows oauth2 to subscribe to any user traffic channel', () => {
    expect(canSubscribe(oauth2, 'traffic:user:10')).toBe(true);
  });

  it("denies user from subscribing to another user's traffic channel", () => {
    expect(canSubscribe(user, 'traffic:user:99')).toBe(false);
  });

  // ── traffic:institution:{id} ───────────────────────────────────────────────
  it('allows a user to subscribe to their institution traffic channel', () => {
    expect(canSubscribe(user, 'traffic:institution:456')).toBe(true);
  });

  it('denies a user from subscribing to another institution traffic channel', () => {
    expect(canSubscribe(user, 'traffic:institution:999')).toBe(false);
  });

  it('allows privileged roles to subscribe to any institution traffic channel', () => {
    expect(canSubscribe(admin, 'traffic:institution:456')).toBe(true);
    expect(canSubscribe(monitor, 'traffic:institution:456')).toBe(true);
    expect(canSubscribe(oauth2, 'traffic:institution:456')).toBe(true);
  });

  // ── server:{uuid} ──────────────────────────────────────────────────────────
  it('allows admin to subscribe to a server channel', () => {
    expect(canSubscribe(admin, `server:${SERVER_UUID}`)).toBe(true);
  });

  it('allows monitor to subscribe to a server channel', () => {
    expect(canSubscribe(monitor, `server:${SERVER_UUID}`)).toBe(true);
  });

  it('allows oauth2 to subscribe to a server channel', () => {
    expect(canSubscribe(oauth2, `server:${SERVER_UUID}`)).toBe(true);
  });

  it('denies user from subscribing to a server channel', () => {
    expect(canSubscribe(user, `server:${SERVER_UUID}`)).toBe(false);
  });

  // ── null / unknown ─────────────────────────────────────────────────────────
  it('returns false for null user', () => {
    expect(canSubscribe(null, 'dashboard')).toBe(false);
  });

  it('returns false for an unknown channel name', () => {
    expect(canSubscribe(admin, 'totally:unknown:channel')).toBe(false);
  });
});
