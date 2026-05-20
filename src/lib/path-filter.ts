export function matchesIgnoredPath(url: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const path = url.split('?')[0].split('#')[0];
  return patterns.some((pattern) => matchPattern(path, pattern));
}

function matchPattern(path: string, pattern: string): boolean {
  if (!pattern.includes('*')) {
    return path === pattern;
  }
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return regex.test(path);
}
