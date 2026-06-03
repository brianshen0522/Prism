export function matchesIgnoredPath(url: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const path = url.split('?')[0].split('#')[0];
  return patterns.some((pattern) => matchPattern(path, pattern));
}

function matchPattern(path: string, pattern: string): boolean {
  // Extension shorthand: ".css" → "*.css" (matches any path ending with that extension)
  const normalized = /^\.[a-zA-Z0-9]+$/.test(pattern) ? `*${pattern}` : pattern;
  if (!normalized.includes('*')) {
    return path === normalized;
  }
  const regex = new RegExp(
    '^' + normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return regex.test(path);
}
