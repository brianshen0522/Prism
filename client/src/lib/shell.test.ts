import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { shellQuote } from './shell';

describe('shellQuote', () => {
  it('wraps plain values in single quotes', () => {
    expect(shellQuote('http://host/path?a=1')).toBe("'http://host/path?a=1'");
  });

  it('yields exactly one shell word holding the original value', () => {
    const value = `/x';echo injected;'$(id)\`id\`"`;
    const out = execFileSync('sh', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' });
    expect(out).toBe(value);
  });
});
