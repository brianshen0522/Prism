import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/prism', () => ({
  prism: {
    oAuthPipeline: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    backendServer: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../db/gazelle', () => ({
  gazelle: {
    gazelleUser: {
      findMany: vi.fn(),
    },
    gazelleInstitution: {
      findMany: vi.fn(),
    },
  },
}));

import { buildOAuthFilterOptions, buildOAuthPipelineList } from './reconcile';
import { prism } from '../db/prism';
import { gazelle } from '../db/gazelle';

const pipeline = {
  id: 'pipe-1',
  participantUserId: 10,
  participantInstitutionId: 456,
  authenticationServerId: 'auth-1',
  authenticationServer: { id: 'auth-1', name: 'Auth Server' },
  tokenIssueConnection: {
    userId: 10,
    institutionId: 456,
    participantTokenPresent: true,
    resStatusCode: 200,
    issuedAccessTokenHash: 'issued-hash',
    refreshTokenHash: null,
    issuedRefreshTokenHash: null,
  },
  resourceCalls: [
    {
      participantTokenPresent: true,
      resourceSuccess: true,
      validationMatched: true,
      validationSuccess: true,
      resourceServer: { id: 'resource-1', name: 'Resource Server' },
      resourceConnection: {
        userId: 10,
        institutionId: 456,
        participantTokenPresent: true,
      },
    },
  ],
  issuedAt: new Date('2026-01-01T00:00:00.000Z'),
  accessTokenPreview: 'access-preview',
  resourceCallCount: 1,
  complete: true,
  legal: true,
  success: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(gazelle.gazelleUser.findMany).mockResolvedValue([
    { id: 10, username: 'alice', firstname: 'Alice', lastname: 'Chen' },
  ] as any);
  vi.mocked(gazelle.gazelleInstitution.findMany).mockResolvedValue([
    { id: 456, name: 'Taiwan Hospital', keyword: 'TWH' },
  ] as any);
  vi.mocked(prism.backendServer.findMany).mockResolvedValue([] as any);
});

describe('OAuth institution summaries', () => {
  it('filters pipelines by participant institution and returns institution summary', async () => {
    vi.mocked((prism as any).oAuthPipeline.findMany)
      .mockResolvedValueOnce([pipeline])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vi.mocked((prism as any).oAuthPipeline.count).mockResolvedValue(1);

    const result = await buildOAuthPipelineList({
      page: 1,
      limit: 25,
      participantInstitutionIds: [456],
    });

    expect((prism as any).oAuthPipeline.findMany.mock.calls[0][0].where).toMatchObject({
      participantInstitutionId: { in: [456] },
    });
    expect(result.data[0]).toMatchObject({
      participant_institution_id: 456,
      participant_institution: {
        id: 456,
        name: 'Taiwan Hospital',
        keyword: 'TWH',
      },
    });
  });

  it('returns participant institutions in filter options', async () => {
    vi.mocked((prism as any).oAuthPipeline.findMany).mockResolvedValueOnce([
      { participantUserId: 10, participantInstitutionId: 456 },
    ]);

    const result = await buildOAuthFilterOptions({ participantInstitutionId: 456 });

    expect((prism as any).oAuthPipeline.findMany.mock.calls[0][0].where).toMatchObject({
      participantInstitutionId: 456,
    });
    expect(result.participant_institutions).toEqual([
      { id: 456, name: 'Taiwan Hospital', keyword: 'TWH' },
    ]);
  });
});
