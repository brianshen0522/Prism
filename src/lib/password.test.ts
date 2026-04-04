import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyPassword } from './password';

function md5(s: string) {
  return crypto.createHash('md5').update(s).digest('hex');
}

describe('verifyPassword', () => {
  it('returns true for a matching password', () => {
    expect(verifyPassword('Shen@9429', md5('Shen@9429'))).toBe(true);
  });

  it('returns false for a wrong password', () => {
    expect(verifyPassword('wrong', md5('Shen@9429'))).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(verifyPassword('shen@9429', md5('Shen@9429'))).toBe(false);
  });

  it('returns false for an empty input against a real hash', () => {
    expect(verifyPassword('', md5('Shen@9429'))).toBe(false);
  });

  it('correctly verifies an empty password against its own hash', () => {
    expect(verifyPassword('', md5(''))).toBe(true);
  });
});
