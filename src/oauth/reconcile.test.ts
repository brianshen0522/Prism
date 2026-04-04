import { describe, expect, it } from 'vitest';
import {
  derivePipelineDiagnostics,
  extractAccessTokenForDisplay,
  extractGrantType,
  extractRefreshTokenForDisplay,
  findValidationForResourceCall,
  findMatchingValidationCall,
  summarizeDiagnostics,
} from './reconcile';

describe('derivePipelineDiagnostics', () => {
  it('returns no diagnostics for a healthy pipeline', () => {
    const diagnostics = derivePipelineDiagnostics({
      hasTokenIssue: true,
      tokenIssueSuccess: true,
      tokenIssueParticipantTokenPresent: true,
      tokenIssueAccessTokenExtracted: true,
      resourceCalls: [
        {
          participantTokenPresent: true,
          resourceSuccess: true,
          validationMatched: true,
          validationSuccess: true,
        },
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(summarizeDiagnostics(diagnostics)).toBe('Healthy pipeline');
  });

  it('returns missing participant token and validation diagnostics', () => {
    const diagnostics = derivePipelineDiagnostics({
      hasTokenIssue: true,
      tokenIssueSuccess: true,
      tokenIssueParticipantTokenPresent: false,
      tokenIssueAccessTokenExtracted: false,
      resourceCalls: [
        {
          participantTokenPresent: false,
          resourceSuccess: false,
          validationMatched: false,
          validationSuccess: null,
        },
      ],
    });

    expect(diagnostics).toContain('missing_token_issue_participant_token');
    expect(diagnostics).toContain('missing_issued_access_token');
    expect(diagnostics).toContain('missing_resource_participant_token');
    expect(diagnostics).toContain('resource_call_failed');
    expect(diagnostics).toContain('missing_validation');
    expect(summarizeDiagnostics(diagnostics)).toBe('Validation missing');
  });
});

describe('findMatchingValidationCall', () => {
  it('matches the nearest prior unmatched resource call within the time window', () => {
    const validationTime = new Date('2026-04-04T10:00:20.000Z');
    const matched = findMatchingValidationCall([
      {
        id: 'older',
        validationConnectionId: null,
        resourceConnection: { reqTimestamp: new Date('2026-04-04T09:59:10.000Z') },
      },
      {
        id: 'nearest',
        validationConnectionId: null,
        resourceConnection: { reqTimestamp: new Date('2026-04-04T10:00:05.000Z') },
      },
    ], validationTime);

    expect(matched?.id).toBe('nearest');
  });

  it('does not match calls outside the validation time window', () => {
    const validationTime = new Date('2026-04-04T10:01:00.000Z');
    const matched = findMatchingValidationCall([
      {
        id: 'stale',
        validationConnectionId: null,
        resourceConnection: { reqTimestamp: new Date('2026-04-04T10:00:00.000Z') },
      },
    ], validationTime);

    expect(matched).toBeNull();
  });
});

describe('findValidationForResourceCall', () => {
  it('matches the nearest later unmatched validation within the time window', () => {
    const resourceTime = new Date('2026-04-04T10:00:05.000Z');
    const matched = findValidationForResourceCall([
      {
        id: 'too-early',
        oauthValidationCall: null,
        reqTimestamp: new Date('2026-04-04T10:00:04.000Z'),
      },
      {
        id: 'nearest-later',
        oauthValidationCall: null,
        reqTimestamp: new Date('2026-04-04T10:00:06.000Z'),
      },
      {
        id: 'later',
        oauthValidationCall: null,
        reqTimestamp: new Date('2026-04-04T10:00:10.000Z'),
      },
    ], resourceTime);

    expect(matched?.id).toBe('nearest-later');
  });

  it('ignores validations already attached to another resource call', () => {
    const resourceTime = new Date('2026-04-04T10:00:05.000Z');
    const matched = findValidationForResourceCall([
      {
        id: 'attached',
        oauthValidationCall: { id: 'call-1' },
        reqTimestamp: new Date('2026-04-04T10:00:06.000Z'),
      },
      {
        id: 'free',
        oauthValidationCall: null,
        reqTimestamp: new Date('2026-04-04T10:00:07.000Z'),
      },
    ], resourceTime);

    expect(matched?.id).toBe('free');
  });
});

describe('extractAccessTokenForDisplay', () => {
  it('extracts access token from JSON response body', () => {
    expect(extractAccessTokenForDisplay('{"access_token":"abc123"}')).toBe('abc123');
  });

  it('extracts access token from form encoded response body', () => {
    expect(extractAccessTokenForDisplay('access_token=xyz789&token_type=bearer')).toBe('xyz789');
  });
});

describe('refresh grant extraction helpers', () => {
  it('extracts grant_type and refresh_token from JSON request bodies', () => {
    expect(extractGrantType('{"grant_type":"refresh_token","refresh_token":"rt_123"}')).toBe('refresh_token');
    expect(extractRefreshTokenForDisplay('{"grant_type":"refresh_token","refresh_token":"rt_123"}')).toBe('rt_123');
  });

  it('extracts grant_type and refresh_token from form encoded request bodies', () => {
    expect(extractGrantType('grant_type=refresh_token&refresh_token=rt_456')).toBe('refresh_token');
    expect(extractRefreshTokenForDisplay('grant_type=refresh_token&refresh_token=rt_456')).toBe('rt_456');
  });
});
