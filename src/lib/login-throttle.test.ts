import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLoginFailures, isLoginThrottled, recordLoginFailure } from './login-throttle';

function fail(ip: string, username: string, times: number) {
  for (let i = 0; i < times; i += 1) recordLoginFailure(ip, username);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('login throttle', () => {
  it('allows attempts below the limit and blocks at it', () => {
    fail('10.0.0.1', 'below', 9);
    expect(isLoginThrottled('10.0.0.1', 'below')).toBe(false);
    recordLoginFailure('10.0.0.1', 'below');
    expect(isLoginThrottled('10.0.0.1', 'below')).toBe(true);
  });

  it('counts usernames case-insensitively', () => {
    fail('10.0.0.2', 'MixedCase', 10);
    expect(isLoginThrottled('10.0.0.2', 'mixedcase')).toBe(true);
  });

  it('keeps separate counts per client address', () => {
    fail('10.0.0.3', 'shared', 10);
    expect(isLoginThrottled('10.0.0.4', 'shared')).toBe(false);
  });

  it('forgets failures after a success', () => {
    fail('10.0.0.5', 'cleared', 10);
    clearLoginFailures('10.0.0.5', 'cleared');
    expect(isLoginThrottled('10.0.0.5', 'cleared')).toBe(false);
  });

  it('expires after the window', () => {
    vi.useFakeTimers();
    fail('10.0.0.6', 'expiring', 10);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(isLoginThrottled('10.0.0.6', 'expiring')).toBe(false);
  });

  it('stays bounded under many distinct usernames', () => {
    for (let i = 0; i < 10_050; i += 1) recordLoginFailure('10.0.0.7', `flood-${i}`);
    fail('10.0.0.8', 'after-flood', 10);
    expect(isLoginThrottled('10.0.0.8', 'after-flood')).toBe(true);
  });
});
