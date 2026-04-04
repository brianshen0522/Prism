import crypto from 'crypto';

export function verifyPassword(input: string, storedHash: string): boolean {
  const hashed = crypto.createHash('md5').update(input).digest('hex');
  return hashed === storedHash;
}
