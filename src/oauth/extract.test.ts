import { describe, it, expect } from 'vitest';
import { classifyOAuthConnection } from './extract';

function classify(reqUrl: string, reqHeaders: Record<string, string>, reqBody: string | null = null) {
  return classifyOAuthConnection({
    server: { serverRole: 'resource' },
    participantHeaderName: 'X-Participant-Token',
    connection: { reqUrl, reqHeaders, reqBody, resBody: null, resStatusCode: 200, status: 'completed' },
  });
}

describe('classifyOAuthConnection bearer forms', () => {
  it('gives the same hash for any casing of the auth scheme', () => {
    const expected = classify('/r', { authorization: 'Bearer tok-1' });
    expect(expected.connectionKind).toBe('resource_access');

    for (const scheme of ['bearer', 'BEARER', 'bEaReR']) {
      const result = classify('/r', { authorization: `${scheme} tok-1` });
      expect(result.connectionKind).toBe('resource_access');
      expect(result.accessTokenHash).toBe(expected.accessTokenHash);
    }
  });

  it('reads an access_token query parameter', () => {
    const expected = classify('/r', { authorization: 'Bearer tok-1' });
    const result = classify('/r?access_token=tok-1', {});
    expect(result.connectionKind).toBe('resource_access');
    expect(result.accessTokenHash).toBe(expected.accessTokenHash);
  });

  it('prefers the header over the query parameter', () => {
    const expected = classify('/r', { authorization: 'Bearer tok-1' });
    const result = classify('/r?access_token=tok-2', { authorization: 'Bearer tok-1' });
    expect(result.accessTokenHash).toBe(expected.accessTokenHash);
  });

  it('leaves other authorization schemes unclassified', () => {
    expect(classify('/r', { authorization: 'Basic dXNlcjpwYXNz' }).connectionKind).toBe('generic');
  });
});
