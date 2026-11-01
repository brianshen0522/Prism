const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_KEYS = 10_000;

export const LOGIN_THROTTLED_ERROR = 'Too many failed attempts. Please try again later.';

const failures = new Map<string, { count: number; resetAt: number }>();

function keyFor(ip: string, username: string): string {
  return `${ip}|${username.toLowerCase()}`;
}

function makeRoom(now: number): void {
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key);
  }
  if (failures.size >= MAX_TRACKED_KEYS) {
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }
}

export function isLoginThrottled(ip: string, username: string): boolean {
  const entry = failures.get(keyFor(ip, username));
  return !!entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES;
}

export function recordLoginFailure(ip: string, username: string): void {
  const key = keyFor(ip, username);
  const now = Date.now();
  const entry = failures.get(key);
  if (entry && entry.resetAt > now) {
    entry.count += 1;
    return;
  }
  if (!entry && failures.size >= MAX_TRACKED_KEYS) makeRoom(now);
  failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
}

export function clearLoginFailures(ip: string, username: string): void {
  failures.delete(keyFor(ip, username));
}
