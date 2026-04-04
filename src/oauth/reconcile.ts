import crypto from 'crypto';
import { prism } from '../db/prism';
import { gazelle } from '../db/gazelle';

const VALIDATION_MATCH_WINDOW_MS = 30_000;

export type OAuthDiagnosticCode =
  | 'missing_token_issue'
  | 'token_issue_failed'
  | 'missing_token_issue_participant_token'
  | 'unlinked_token_issue_participant'
  | 'missing_issued_access_token'
  | 'missing_resource_calls'
  | 'missing_resource_participant_token'
  | 'unlinked_resource_participant'
  | 'resource_call_failed'
  | 'missing_validation'
  | 'validation_failed';

type ConnectionRecord = {
  id: string;
  userId: number | null;
  serverId: string;
  reqMethod: string;
  reqUrl: string;
  reqBody: string | null;
  reqTimestamp: Date;
  resStatusCode: number | null;
  resBody: string | null;
  participantTokenPresent: boolean;
  accessTokenHash: string | null;
  accessTokenPreview: string | null;
  refreshTokenHash: string | null;
  refreshTokenPreview: string | null;
  issuedAccessTokenHash: string | null;
  issuedAccessTokenPreview: string | null;
  issuedRefreshTokenHash: string | null;
  issuedRefreshTokenPreview: string | null;
  connectionKind: 'generic' | 'oauth_token_issue' | 'resource_access' | 'oauth_validation';
  status: 'pending' | 'completed' | 'error';
};

type ServerRecord = {
  id: string;
  name: string;
  serverRole?: 'generic' | 'authentication' | 'resource';
  oauthAuthServerId?: string | null;
  oauthValidationSuccessPath?: string | null;
  oauthValidationSuccessValue?: string | null;
};

function responseSucceeded(statusCode: number | null | undefined) {
  return typeof statusCode === 'number' && statusCode >= 200 && statusCode < 400;
}

function tryParseJson(input: string | null | undefined): unknown {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function parseBodyObject(input: string | null | undefined): Record<string, unknown> | null {
  if (!input?.trim()) return null;

  const json = tryParseJson(input);
  if (json && typeof json === 'object') return json as Record<string, unknown>;

  try {
    const params = new URLSearchParams(input);
    const out: Record<string, string> = {};
    for (const [key, value] of params.entries()) out[key] = value;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function getByPath(input: unknown, path: string): unknown {
  if (!path.trim()) return input;

  return path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<unknown>((value, part) => {
      if (!value || typeof value !== 'object') return undefined;
      return (value as Record<string, unknown>)[part];
    }, input);
}

function normalizeScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function deriveTokenPreview(token: string) {
  if (token.length <= 16) return token;
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

function extractTokenFromBody(body: string | null | undefined): string | null {
  const parsed = parseBodyObject(body);
  if (!parsed) return null;
  const candidate = parsed.access_token ?? parsed.token;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function extractStringField(body: string | null | undefined, field: string): string | null {
  const parsed = parseBodyObject(body);
  if (!parsed) return null;
  const value = parsed[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function extractAccessTokenForDisplay(body: string | null | undefined) {
  return extractTokenFromBody(body);
}

export function extractRefreshTokenForDisplay(body: string | null | undefined) {
  return extractStringField(body, 'refresh_token');
}

export function extractGrantType(body: string | null | undefined) {
  return extractStringField(body, 'grant_type');
}

function buildRefreshChainItem(pipeline: any) {
  return {
    id: pipeline.id,
    started_at: pipeline.issuedAt ?? null,
    access_token_fingerprint: pipeline.accessTokenPreview,
    authentication_server: pipeline.authenticationServer
      ? { id: pipeline.authenticationServer.id, name: pipeline.authenticationServer.name }
      : null,
    grant_type: extractGrantType(pipeline.tokenIssueConnection?.reqBody),
  };
}

async function findRefreshChain(input: {
  pipelineId: string;
  authenticationServerId: string | null;
  suppliedRefreshTokenHash: string | null;
  suppliedRefreshToken: string | null;
  issuedRefreshTokenHash: string | null;
  issuedRefreshToken: string | null;
}) {
  if (!input.suppliedRefreshTokenHash && !input.suppliedRefreshToken && !input.issuedRefreshTokenHash && !input.issuedRefreshToken) {
    return {
      previous_pipeline: null,
      next_pipelines: [] as Array<ReturnType<typeof buildRefreshChainItem>>,
    };
  }

  const candidates = await (prism as any).oAuthPipeline.findMany({
    where: {
      id: { not: input.pipelineId },
      ...(input.authenticationServerId ? { authenticationServerId: input.authenticationServerId } : {}),
      tokenIssueConnectionId: { not: null },
    },
    include: {
      authenticationServer: true,
      tokenIssueConnection: true,
    },
    orderBy: {
      issuedAt: 'asc',
    },
  });

  let previousPipeline: ReturnType<typeof buildRefreshChainItem> | null = null;
  const nextPipelines: Array<ReturnType<typeof buildRefreshChainItem>> = [];

  for (const candidate of candidates) {
    const candidateIssuedRefreshTokenHash = candidate.tokenIssueConnection?.issuedRefreshTokenHash ?? null;
    const candidateSuppliedRefreshTokenHash = candidate.tokenIssueConnection?.refreshTokenHash ?? null;
    const candidateIssuedRefreshToken = candidate.tokenIssueConnection?.issuedRefreshTokenPreview
      ? null
      : extractRefreshTokenForDisplay(candidate.tokenIssueConnection?.resBody);
    const candidateSuppliedRefreshToken = candidate.tokenIssueConnection?.refreshTokenPreview
      ? null
      : extractRefreshTokenForDisplay(candidate.tokenIssueConnection?.reqBody);

    if (
      ((input.suppliedRefreshTokenHash && candidateIssuedRefreshTokenHash === input.suppliedRefreshTokenHash) ||
        (input.suppliedRefreshToken && candidateIssuedRefreshToken === input.suppliedRefreshToken)) &&
      !previousPipeline
    ) {
      previousPipeline = buildRefreshChainItem(candidate);
    }

    if (
      (input.issuedRefreshTokenHash && candidateSuppliedRefreshTokenHash === input.issuedRefreshTokenHash) ||
      (input.issuedRefreshToken && candidateSuppliedRefreshToken === input.issuedRefreshToken)
    ) {
      nextPipelines.push(buildRefreshChainItem(candidate));
    }
  }

  return {
    previous_pipeline: previousPipeline,
    next_pipelines: nextPipelines,
  };
}

async function recoverAccessTokenPreview(connection: ConnectionRecord) {
  if (connection.issuedAccessTokenPreview) return connection.issuedAccessTokenPreview;
  if (connection.accessTokenPreview) return connection.accessTokenPreview;

  const issuedToken = extractTokenFromBody(connection.resBody);
  if (issuedToken) return deriveTokenPreview(issuedToken);
  return 'unknown';
}

function validationBodyPassed(connection: ConnectionRecord, server: ServerRecord | null) {
  if (!responseSucceeded(connection.resStatusCode)) return false;

  const parsed = tryParseJson(connection.resBody);
  if (parsed === null) return false;

  const successPath = server?.oauthValidationSuccessPath?.trim() || 'active';
  const expectedValue = server?.oauthValidationSuccessValue?.trim() || 'true';
  const actualValue = getByPath(parsed, successPath);

  return normalizeScalar(actualValue) === expectedValue;
}

async function fetchPipelineByTokenHash(tokenHash: string) {
  return (prism as any).oAuthPipeline.findUnique({
    where: { accessTokenHash: tokenHash },
    include: {
      tokenIssueConnection: true,
      authenticationServer: true,
      resourceCalls: {
        include: {
          resourceConnection: true,
          validationConnection: true,
          resourceServer: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export function derivePipelineDiagnostics(input: {
  hasTokenIssue: boolean;
  tokenIssueSuccess: boolean;
  tokenIssueParticipantTokenPresent: boolean;
  tokenIssueParticipantLinked: boolean;
  tokenIssueAccessTokenExtracted: boolean;
  resourceCalls: Array<{
    participantTokenPresent: boolean;
    participantLinked: boolean;
    resourceSuccess: boolean;
    validationMatched: boolean;
    validationSuccess: boolean | null;
  }>;
}) {
  const diagnostics = new Set<OAuthDiagnosticCode>();

  if (!input.hasTokenIssue) diagnostics.add('missing_token_issue');
  if (input.hasTokenIssue && !input.tokenIssueSuccess) diagnostics.add('token_issue_failed');
  if (input.hasTokenIssue && !input.tokenIssueParticipantTokenPresent) diagnostics.add('missing_token_issue_participant_token');
  if (input.hasTokenIssue && input.tokenIssueParticipantTokenPresent && !input.tokenIssueParticipantLinked) diagnostics.add('unlinked_token_issue_participant');
  if (input.hasTokenIssue && !input.tokenIssueAccessTokenExtracted) diagnostics.add('missing_issued_access_token');
  if (input.resourceCalls.length === 0) diagnostics.add('missing_resource_calls');

  for (const call of input.resourceCalls) {
    if (!call.participantTokenPresent) diagnostics.add('missing_resource_participant_token');
    if (call.participantTokenPresent && !call.participantLinked) diagnostics.add('unlinked_resource_participant');
    if (!call.resourceSuccess) diagnostics.add('resource_call_failed');
    if (!call.validationMatched) diagnostics.add('missing_validation');
    if (call.validationMatched && call.validationSuccess === false) diagnostics.add('validation_failed');
  }

  return Array.from(diagnostics);
}

export function summarizeDiagnostics(
  diagnostics: OAuthDiagnosticCode[],
  options?: { overallSuccess?: boolean },
) {
  if (options?.overallSuccess) return 'Success';
  if (diagnostics.includes('missing_validation')) return 'Validation missing';
  if (diagnostics.includes('validation_failed')) return 'Validation failed';
  if (diagnostics.includes('unlinked_token_issue_participant') || diagnostics.includes('unlinked_resource_participant')) {
    return 'Participant token expired or no longer linked to a user';
  }
  if (diagnostics.includes('missing_resource_participant_token')) return 'Participant token missing';
  if (diagnostics.includes('resource_call_failed')) return 'Resource call failed';
  if (diagnostics.includes('missing_issued_access_token')) return 'Access token missing';
  if (diagnostics.includes('token_issue_failed')) return 'Token issue failed';
  if (diagnostics.includes('missing_resource_calls')) return 'No resource calls';
  return diagnostics.length > 0 ? 'Pipeline has issues' : 'Healthy pipeline';
}

export function findMatchingValidationCall<T extends {
  id: string;
  validationConnectionId?: string | null;
  resourceConnection: { reqTimestamp: Date | string };
}>(calls: T[], validationTime: Date) {
  return [...calls]
    .filter((call) => !call.validationConnectionId)
    .filter((call) => {
      const resourceTime = new Date(call.resourceConnection.reqTimestamp).getTime();
      const validationTs = validationTime.getTime();
      return resourceTime <= validationTs && validationTs - resourceTime <= VALIDATION_MATCH_WINDOW_MS;
    })
    .sort((a, b) =>
      new Date(b.resourceConnection.reqTimestamp).getTime() - new Date(a.resourceConnection.reqTimestamp).getTime(),
    )[0] ?? null;
}

export function findValidationForResourceCall<T extends {
  id: string;
  reqTimestamp: Date | string;
  serverId?: string;
  oauthValidationCall?: unknown | null;
}>(validations: T[], resourceTime: Date) {
  return [...validations]
    .filter((validation) => !validation.oauthValidationCall)
    .filter((validation) => {
      const validationTs = new Date(validation.reqTimestamp).getTime();
      const resourceTs = resourceTime.getTime();
      return validationTs >= resourceTs && validationTs - resourceTs <= VALIDATION_MATCH_WINDOW_MS;
    })
    .sort((a, b) =>
      new Date(a.reqTimestamp).getTime() - new Date(b.reqTimestamp).getTime(),
    )[0] ?? null;
}

async function findPendingValidationConnection(tokenHash: string, resourceTime: Date) {
  const upperBound = new Date(resourceTime.getTime() + VALIDATION_MATCH_WINDOW_MS);
  const candidates = await (prism as any).connection.findMany({
    where: {
      accessTokenHash: tokenHash,
      connectionKind: 'oauth_validation',
      status: 'completed',
      reqTimestamp: {
        gte: resourceTime,
        lte: upperBound,
      },
    },
    include: {
      oauthValidationCall: true,
    },
    orderBy: {
      reqTimestamp: 'asc',
    },
  });

  return findValidationForResourceCall(candidates, resourceTime);
}

async function attachValidationToResourceCall(input: {
  resourceCallId: string;
  pipelineId: string;
  validationConnection: ConnectionRecord;
  server: ServerRecord | null;
  authenticationServerId: string | null | undefined;
}) {
  await (prism as any).oAuthPipelineResourceCall.update({
    where: { id: input.resourceCallId },
    data: {
      validationConnectionId: input.validationConnection.id,
      validationMatched: true,
      validationSuccess: validationBodyPassed(input.validationConnection, input.server),
    },
  });

  await (prism as any).oAuthPipeline.update({
    where: { id: input.pipelineId },
    data: {
      authenticationServerId: input.authenticationServerId ?? input.server?.id ?? null,
      lastSeenAt: input.validationConnection.reqTimestamp,
    },
  });

  await recomputePipelineState(input.pipelineId);
}

async function recomputePipelineState(pipelineId: string) {
  const pipeline = await (prism as any).oAuthPipeline.findUnique({
    where: { id: pipelineId },
    include: {
      tokenIssueConnection: true,
      resourceCalls: {
        include: {
          resourceConnection: true,
          validationConnection: true,
        },
      },
    },
  });

  if (!pipeline) return;

  const pipelineParticipantUserId = pipeline.participantUserId ?? pipeline.tokenIssueConnection?.userId ?? null;
  const tokenIssueParticipantLinked =
    !!pipeline.tokenIssueConnection?.participantTokenPresent &&
    typeof pipeline.tokenIssueConnection?.userId === 'number' &&
    typeof pipelineParticipantUserId === 'number' &&
    pipeline.tokenIssueConnection.userId === pipelineParticipantUserId;

  const tokenIssueSuccess =
    !!pipeline.tokenIssueConnection &&
    responseSucceeded(pipeline.tokenIssueConnection.resStatusCode) &&
    !!pipeline.tokenIssueConnection.issuedAccessTokenHash;

  const hasCompleteResourceFlow = pipeline.resourceCalls.some((call: any) =>
    !!call.resourceSuccess &&
    !!call.validationConnectionId &&
    call.validationSuccess === true,
  );

  const complete =
    tokenIssueSuccess &&
    hasCompleteResourceFlow;

  const legal =
    complete &&
    !!pipeline.tokenIssueConnection?.participantTokenPresent &&
    tokenIssueParticipantLinked &&
    pipeline.resourceCalls.every((call: any) =>
      !!call.participantTokenPresent &&
      typeof call.resourceConnection?.userId === 'number' &&
      typeof pipelineParticipantUserId === 'number' &&
      call.resourceConnection.userId === pipelineParticipantUserId,
    );

  const success =
    tokenIssueSuccess &&
    pipeline.resourceCalls.some((call: any) => !!call.resourceSuccess);

  const diagnostics = derivePipelineDiagnostics({
    hasTokenIssue: !!pipeline.tokenIssueConnection,
    tokenIssueSuccess,
    tokenIssueParticipantTokenPresent: !!pipeline.tokenIssueConnection?.participantTokenPresent,
    tokenIssueParticipantLinked,
    tokenIssueAccessTokenExtracted: !!pipeline.tokenIssueConnection?.issuedAccessTokenHash,
    resourceCalls: pipeline.resourceCalls.map((call: any) => ({
      participantTokenPresent: !!call.participantTokenPresent,
      participantLinked:
        !!call.participantTokenPresent &&
        typeof call.resourceConnection?.userId === 'number' &&
        typeof pipelineParticipantUserId === 'number' &&
        call.resourceConnection.userId === pipelineParticipantUserId,
      resourceSuccess: !!call.resourceSuccess,
      validationMatched: !!call.validationConnectionId,
      validationSuccess: call.validationSuccess ?? null,
    })),
  });

  await (prism as any).oAuthPipeline.update({
    where: { id: pipeline.id },
    data: {
      resourceCallCount: pipeline.resourceCalls.length,
      complete,
      legal,
      success,
      lastSeenAt: new Date(),
    },
  });
}

async function upsertTokenIssue(connection: ConnectionRecord, server: ServerRecord) {
  const tokenHash = connection.issuedAccessTokenHash;
  if (!tokenHash) return;

  const preview = await recoverAccessTokenPreview(connection);
  const existing = await fetchPipelineByTokenHash(tokenHash);

  if (!existing) {
    const created = await (prism as any).oAuthPipeline.create({
      data: {
        participantUserId: connection.userId,
        authenticationServerId: server.id,
        accessTokenHash: tokenHash,
        accessTokenPreview: preview,
        tokenIssueConnectionId: connection.id,
        issuedAt: connection.reqTimestamp,
        lastSeenAt: connection.reqTimestamp,
      },
    });
    await recomputePipelineState(created.id);
    return;
  }

  await (prism as any).oAuthPipeline.update({
    where: { id: existing.id },
    data: {
      participantUserId: existing.participantUserId ?? connection.userId,
      authenticationServerId: existing.authenticationServerId ?? server.id,
      accessTokenPreview: existing.accessTokenPreview || preview,
      tokenIssueConnectionId: existing.tokenIssueConnectionId ?? connection.id,
      issuedAt: existing.issuedAt ?? connection.reqTimestamp,
      lastSeenAt: connection.reqTimestamp,
    },
  });

  await recomputePipelineState(existing.id);
}

async function upsertResourceCall(connection: ConnectionRecord, server: ServerRecord) {
  const tokenHash = connection.accessTokenHash;
  if (!tokenHash) return;

  let pipeline = await fetchPipelineByTokenHash(tokenHash);
  if (!pipeline) {
    pipeline = await (prism as any).oAuthPipeline.create({
      data: {
        participantUserId: connection.userId,
        authenticationServerId: server.oauthAuthServerId ?? null,
        accessTokenHash: tokenHash,
        accessTokenPreview: connection.accessTokenPreview ?? 'unknown',
        issuedAt: connection.reqTimestamp,
        lastSeenAt: connection.reqTimestamp,
      },
      include: { resourceCalls: true },
    });
  }

  const existingCall = await (prism as any).oAuthPipelineResourceCall.findUnique({
    where: { resourceConnectionId: connection.id },
  });

  let resourceCallId = existingCall?.id ?? null;

  if (!existingCall) {
    const createdCall = await (prism as any).oAuthPipelineResourceCall.create({
      data: {
        pipelineId: pipeline.id,
        resourceConnectionId: connection.id,
        resourceServerId: server.id,
        resourceSuccess: responseSucceeded(connection.resStatusCode),
        participantTokenPresent: connection.participantTokenPresent,
        validationMatched: false,
      },
    });
    resourceCallId = createdCall.id;
  }

  await (prism as any).oAuthPipeline.update({
    where: { id: pipeline.id },
    data: {
      participantUserId: pipeline.participantUserId ?? connection.userId,
      authenticationServerId: pipeline.authenticationServerId ?? server.oauthAuthServerId ?? null,
      lastSeenAt: connection.reqTimestamp,
    },
  });

  if (resourceCallId && !existingCall?.validationConnectionId) {
    const pendingValidation = await findPendingValidationConnection(tokenHash, connection.reqTimestamp);
    if (pendingValidation) {
      const validationServer = await prism.backendServer.findUnique({
        where: { id: pendingValidation.serverId },
      }) as unknown as ServerRecord | null;

      await attachValidationToResourceCall({
        resourceCallId,
        pipelineId: pipeline.id,
        validationConnection: pendingValidation as ConnectionRecord,
        server: validationServer,
        authenticationServerId: pipeline.authenticationServerId ?? server.oauthAuthServerId ?? null,
      });
      return;
    }
  }

  await recomputePipelineState(pipeline.id);
}

async function attachValidation(connection: ConnectionRecord, server: ServerRecord) {
  const tokenHash = connection.accessTokenHash;
  if (!tokenHash) return;

  const pipeline = await fetchPipelineByTokenHash(tokenHash);
  if (!pipeline) return;

  const matchedCall = findMatchingValidationCall(pipeline.resourceCalls, connection.reqTimestamp);

  if (!matchedCall) return;

  await attachValidationToResourceCall({
    resourceCallId: matchedCall.id,
    pipelineId: pipeline.id,
    validationConnection: connection,
    server,
    authenticationServerId: pipeline.authenticationServerId ?? server.id,
  });
}

export async function reconcileOAuthPipeline(connectionId: string) {
  const connection = await prism.connection.findUnique({ where: { id: connectionId } }) as unknown as ConnectionRecord | null;
  if (!connection) return;
  if (connection.status !== 'completed') return;
  if (connection.connectionKind === 'generic') return;

  const server = await prism.backendServer.findUnique({ where: { id: connection.serverId } }) as unknown as ServerRecord | null;
  if (!server) return;

  if (connection.connectionKind === 'oauth_token_issue') {
    await upsertTokenIssue(connection, server);
    return;
  }

  if (connection.connectionKind === 'resource_access') {
    await upsertResourceCall(connection, server);
    return;
  }

  if (connection.connectionKind === 'oauth_validation') {
    await attachValidation(connection, server);
  }
}

const reconcileQueue = new Set<string>();
let reconcileFlushScheduled = false;

async function flushReconcileQueue() {
  reconcileFlushScheduled = false;
  const ids = Array.from(reconcileQueue);
  reconcileQueue.clear();

  for (const id of ids) {
    try {
      await reconcileOAuthPipeline(id);
    } catch (error) {
      console.error('OAuth reconcile failed', { connectionId: id, error });
    }
  }
}

export function enqueueOAuthReconcile(connectionId: string) {
  reconcileQueue.add(connectionId);
  if (reconcileFlushScheduled) return;
  reconcileFlushScheduled = true;
  setTimeout(() => {
    flushReconcileQueue().catch((error) => {
      console.error('OAuth reconcile queue flush failed', error);
    });
  }, 0);
}

export async function buildOAuthPipelineList(filters: {
  page: number;
  limit: number;
  accessToken?: string;
  participantUserIds?: number[];
  legal?: 'all' | 'legal' | 'illegal';
  success?: 'all' | 'success' | 'failed';
  authenticationServerIds?: string[];
  resourceServerIds?: string[];
}) {
  const where: Record<string, unknown> = {};

  if (filters.participantUserIds && filters.participantUserIds.length > 0) {
    where.participantUserId = { in: filters.participantUserIds };
  }

  if (filters.legal === 'legal') where.legal = true;
  if (filters.legal === 'illegal') where.legal = false;
  if (filters.success === 'success') where.success = true;
  if (filters.success === 'failed') where.success = false;

  if (filters.authenticationServerIds && filters.authenticationServerIds.length > 0) {
    where.authenticationServerId = { in: filters.authenticationServerIds };
  }

  if (filters.accessToken?.trim()) {
    const term = filters.accessToken.trim();
    const hashed = crypto.createHash('sha256').update(term).digest('hex');
    where.OR = [
      { accessTokenHash: hashed },
      { accessTokenPreview: { contains: term } },
    ];
  }

  if (filters.resourceServerIds && filters.resourceServerIds.length > 0) {
    where.resourceCalls = {
      some: {
        resourceServerId: { in: filters.resourceServerIds },
      },
    };
  }

  const skip = (filters.page - 1) * filters.limit;

  const [pipelines, total] = await Promise.all([
    (prism as any).oAuthPipeline.findMany({
      where,
      include: {
        authenticationServer: true,
        tokenIssueConnection: true,
        resourceCalls: {
          include: {
            resourceServer: true,
          },
        },
      },
      orderBy: { issuedAt: 'desc' },
      skip,
      take: filters.limit,
    }),
    (prism as any).oAuthPipeline.count({ where }),
  ]);

  const userIds: number[] = Array.from(new Set(
    pipelines
      .map((pipeline: any) => pipeline.participantUserId)
      .filter((id: unknown): id is number => typeof id === 'number'),
  ));

  const users = userIds.length > 0
    ? await gazelle.gazelleUser.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, firstname: true, lastname: true },
    })
    : [];

  const userMap = new Map(users.map((user) => [
    user.id,
    {
      id: user.id,
      username: user.username,
      name: `${user.firstname ?? ''} ${user.lastname ?? ''}`.trim() || user.username,
    },
  ]));

  const refreshConnectionsByPipeline = new Map<string, { refreshTokenHash: string | null; issuedRefreshTokenHash: string | null }>(
    pipelines.map((pipeline: any) => [
      pipeline.id,
      {
        refreshTokenHash: pipeline.tokenIssueConnection?.refreshTokenHash ?? null,
        issuedRefreshTokenHash: pipeline.tokenIssueConnection?.issuedRefreshTokenHash ?? null,
      },
    ]),
  );

  const issuedHashes = Array.from(new Set(
    pipelines
      .map((pipeline: any) => pipeline.tokenIssueConnection?.issuedRefreshTokenHash)
      .filter(Boolean),
  ));
  const suppliedHashes = Array.from(new Set(
    pipelines
      .map((pipeline: any) => pipeline.tokenIssueConnection?.refreshTokenHash)
      .filter(Boolean),
  ));

  const [prevCandidates, nextCandidates] = await Promise.all([
    issuedHashes.length > 0
      ? (prism as any).oAuthPipeline.findMany({
        where: {
          tokenIssueConnection: {
            is: {
              issuedRefreshTokenHash: { in: issuedHashes },
            },
          },
        },
        include: {
          tokenIssueConnection: true,
        },
      })
      : [],
    suppliedHashes.length > 0
      ? (prism as any).oAuthPipeline.findMany({
        where: {
          tokenIssueConnection: {
            is: {
              refreshTokenHash: { in: suppliedHashes },
            },
          },
        },
        include: {
          tokenIssueConnection: true,
        },
      })
      : [],
  ]);

  const previousBySuppliedHash = new Map<string, { id: string; accessTokenPreview: string }>();
  for (const candidate of prevCandidates) {
    if (candidate.tokenIssueConnection?.issuedRefreshTokenHash && candidate.id && candidate.accessTokenPreview) {
      previousBySuppliedHash.set(candidate.tokenIssueConnection.issuedRefreshTokenHash, {
        id: candidate.id,
        accessTokenPreview: candidate.accessTokenPreview,
      });
    }
  }

  const descendantCountByIssuedHash = new Map<string, number>();
  for (const candidate of nextCandidates) {
    if (!candidate.tokenIssueConnection?.refreshTokenHash) continue;
    descendantCountByIssuedHash.set(
      candidate.tokenIssueConnection.refreshTokenHash,
      (descendantCountByIssuedHash.get(candidate.tokenIssueConnection.refreshTokenHash) ?? 0) + 1,
    );
  }

  return {
    total,
    data: pipelines.map((pipeline: any) => {
      const resourceServers = Array.from(new Map(
        pipeline.resourceCalls.map((call: any) => [
          call.resourceServer.id,
          { id: call.resourceServer.id, name: call.resourceServer.name },
        ]),
      ).values());
      const diagnostics = derivePipelineDiagnostics({
        hasTokenIssue: !!pipeline.tokenIssueConnection,
        tokenIssueSuccess: !!pipeline.tokenIssueConnection &&
          responseSucceeded(pipeline.tokenIssueConnection.resStatusCode) &&
          !!pipeline.tokenIssueConnection.issuedAccessTokenHash,
        tokenIssueParticipantTokenPresent: !!pipeline.tokenIssueConnection?.participantTokenPresent,
        tokenIssueParticipantLinked:
          !!pipeline.tokenIssueConnection?.participantTokenPresent &&
          typeof pipeline.tokenIssueConnection?.userId === 'number' &&
          typeof pipeline.participantUserId === 'number' &&
          pipeline.tokenIssueConnection.userId === pipeline.participantUserId,
        tokenIssueAccessTokenExtracted: !!pipeline.tokenIssueConnection?.issuedAccessTokenHash,
        resourceCalls: pipeline.resourceCalls.map((call: any) => ({
          participantTokenPresent: !!call.participantTokenPresent,
          participantLinked:
            !!call.participantTokenPresent &&
            typeof call.resourceConnection?.userId === 'number' &&
            typeof pipeline.participantUserId === 'number' &&
            call.resourceConnection.userId === pipeline.participantUserId,
          resourceSuccess: !!call.resourceSuccess,
          validationMatched: !!call.validationMatched,
          validationSuccess: call.validationSuccess ?? null,
        })),
      });

      const refreshMeta = refreshConnectionsByPipeline.get(pipeline.id);
      const refreshedFrom = refreshMeta?.refreshTokenHash ? previousBySuppliedHash.get(refreshMeta.refreshTokenHash) ?? null : null;
      const descendantCount = refreshMeta?.issuedRefreshTokenHash ? descendantCountByIssuedHash.get(refreshMeta.issuedRefreshTokenHash) ?? 0 : 0;

      return {
        id: pipeline.id,
        started_at: pipeline.issuedAt ?? null,
        participant_user: pipeline.participantUserId ? userMap.get(pipeline.participantUserId) ?? null : null,
        authentication_server: pipeline.authenticationServer
          ? { id: pipeline.authenticationServer.id, name: pipeline.authenticationServer.name }
          : null,
        resource_servers: resourceServers,
        access_token_fingerprint: pipeline.accessTokenPreview,
        resource_call_count: pipeline.resourceCallCount,
        complete: pipeline.complete,
        legal: pipeline.legal,
        success: pipeline.success,
        refreshed_from: refreshedFrom,
        has_descendants: descendantCount > 0,
        descendant_count: descendantCount,
        diagnostics,
        diagnostics_summary: summarizeDiagnostics(diagnostics, { overallSuccess: pipeline.success }),
      };
    }),
  };
}

export async function buildOAuthPipelineDetail(pipelineId: string) {
  const pipeline = await (prism as any).oAuthPipeline.findUnique({
    where: { id: pipelineId },
    include: {
      authenticationServer: true,
      tokenIssueConnection: true,
      resourceCalls: {
        include: {
          resourceConnection: true,
          validationConnection: true,
          resourceServer: true,
        },
        orderBy: {
          resourceConnection: {
            reqTimestamp: 'asc',
          },
        },
      },
    },
  });

  if (!pipeline) return null;

  const user = pipeline.participantUserId
    ? await gazelle.gazelleUser.findUnique({
      where: { id: pipeline.participantUserId },
      select: { id: true, username: true, firstname: true, lastname: true },
    })
    : null;

  const participantUser = user
    ? {
      id: user.id,
      username: user.username,
      name: `${user.firstname ?? ''} ${user.lastname ?? ''}`.trim() || user.username,
    }
    : null;

  const tokenIssue = pipeline.tokenIssueConnection;
  const tokenIssueGrantType = extractGrantType(tokenIssue?.reqBody);
  const tokenIssueRefreshToken = extractRefreshTokenForDisplay(tokenIssue?.reqBody);
  const issuedRefreshToken = extractRefreshTokenForDisplay(tokenIssue?.resBody);
  const refreshChain = await findRefreshChain({
    pipelineId,
    authenticationServerId: pipeline.authenticationServerId ?? null,
    suppliedRefreshTokenHash: tokenIssue?.refreshTokenHash ?? null,
    suppliedRefreshToken: tokenIssueRefreshToken,
    issuedRefreshTokenHash: tokenIssue?.issuedRefreshTokenHash ?? null,
    issuedRefreshToken,
  });
  const validationCount = pipeline.resourceCalls.filter((call: any) => !!call.validationConnectionId).length;
  const resourceServers = Array.from(new Map(
    pipeline.resourceCalls.map((call: any) => [
      call.resourceServer.id,
      { id: call.resourceServer.id, name: call.resourceServer.name },
    ]),
  ).values());
  const diagnostics = derivePipelineDiagnostics({
    hasTokenIssue: !!tokenIssue,
    tokenIssueSuccess: !!tokenIssue && responseSucceeded(tokenIssue.resStatusCode) && !!tokenIssue.issuedAccessTokenHash,
    tokenIssueParticipantTokenPresent: !!tokenIssue?.participantTokenPresent,
    tokenIssueParticipantLinked:
      !!tokenIssue?.participantTokenPresent &&
      typeof tokenIssue?.userId === 'number' &&
      typeof pipeline.participantUserId === 'number' &&
      tokenIssue.userId === pipeline.participantUserId,
    tokenIssueAccessTokenExtracted: !!tokenIssue?.issuedAccessTokenHash,
    resourceCalls: pipeline.resourceCalls.map((call: any) => ({
      participantTokenPresent: !!call.participantTokenPresent,
      participantLinked:
        !!call.participantTokenPresent &&
        typeof call.resourceConnection?.userId === 'number' &&
        typeof pipeline.participantUserId === 'number' &&
        call.resourceConnection.userId === pipeline.participantUserId,
      resourceSuccess: !!call.resourceSuccess,
      validationMatched: !!call.validationConnectionId,
      validationSuccess: call.validationSuccess ?? null,
    })),
  });

  return {
    summary: {
      id: pipeline.id,
      started_at: pipeline.issuedAt ?? null,
      participant_user: participantUser,
      authentication_server: pipeline.authenticationServer
        ? { id: pipeline.authenticationServer.id, name: pipeline.authenticationServer.name }
        : null,
      access_token: {
        fingerprint: pipeline.accessTokenPreview,
      },
      complete: pipeline.complete,
      legal: pipeline.legal,
      success: pipeline.success,
      resource_call_count: pipeline.resourceCallCount,
      validation_call_count: validationCount,
      resource_servers: resourceServers,
      diagnostics,
      diagnostics_summary: summarizeDiagnostics(diagnostics, { overallSuccess: pipeline.success }),
    },
    token_issue: {
      connection_id: tokenIssue?.id ?? null,
      raw_connection_path: tokenIssue ? `/connections/${tokenIssue.id}` : null,
      status_code: tokenIssue?.resStatusCode ?? null,
      participant_token_present: tokenIssue?.participantTokenPresent ?? false,
      participant_token_linked:
        !!tokenIssue?.participantTokenPresent &&
        typeof tokenIssue?.userId === 'number' &&
        typeof pipeline.participantUserId === 'number' &&
        tokenIssue.userId === pipeline.participantUserId,
      grant_type: tokenIssueGrantType,
      is_refresh_grant: tokenIssueGrantType === 'refresh_token',
      refresh_token_supplied: !!tokenIssueRefreshToken,
      refresh_token_rotated: !!issuedRefreshToken,
      refresh_token_fingerprint: tokenIssueRefreshToken ? deriveTokenPreview(tokenIssueRefreshToken) : null,
      issued_refresh_token_fingerprint: issuedRefreshToken ? deriveTokenPreview(issuedRefreshToken) : null,
      endpoint_matched: !!tokenIssue,
      access_token_extracted: !!tokenIssue?.issuedAccessTokenHash,
      success: !!tokenIssue && responseSucceeded(tokenIssue.resStatusCode) && !!tokenIssue.issuedAccessTokenHash,
      ui_status: !tokenIssue
        ? 'missing'
        : (!tokenIssue.participantTokenPresent || !responseSucceeded(tokenIssue.resStatusCode) || !tokenIssue.issuedAccessTokenHash)
            ? 'error'
            : 'ok',
      req_timestamp: tokenIssue?.reqTimestamp ?? null,
    },
    resource_calls: pipeline.resourceCalls.map((call: any) => ({
      resource_connection_id: call.resourceConnection.id,
      raw_resource_connection_path: `/connections/${call.resourceConnection.id}`,
      resource_server: { id: call.resourceServer.id, name: call.resourceServer.name },
      method: call.resourceConnection.reqMethod,
      url: call.resourceConnection.reqUrl,
      status_code: call.resourceConnection.resStatusCode ?? null,
      participant_token_present: call.participantTokenPresent,
      participant_token_linked:
        !!call.participantTokenPresent &&
        typeof call.resourceConnection?.userId === 'number' &&
        typeof pipeline.participantUserId === 'number' &&
        call.resourceConnection.userId === pipeline.participantUserId,
      success: call.resourceSuccess,
      ui_status: !call.participantTokenPresent
        ? 'error'
        : call.resourceSuccess
            ? 'ok'
            : 'error',
      req_timestamp: call.resourceConnection.reqTimestamp,
      validation_expected: true,
      validation: call.validationConnection
        ? {
          connection_id: call.validationConnection.id,
          raw_validation_connection_path: `/connections/${call.validationConnection.id}`,
          authentication_server: pipeline.authenticationServer
            ? { id: pipeline.authenticationServer.id, name: pipeline.authenticationServer.name }
            : null,
          status_code: call.validationConnection.resStatusCode ?? null,
          endpoint_matched: true,
          body_check_passed: !!call.validationSuccess,
          success: !!call.validationSuccess,
          ui_status: call.validationSuccess ? 'ok' : 'error',
        }
        : null,
      diagnostics: summarizeDiagnostics(derivePipelineDiagnostics({
        hasTokenIssue: true,
        tokenIssueSuccess: true,
        tokenIssueParticipantTokenPresent: true,
        tokenIssueParticipantLinked: true,
        tokenIssueAccessTokenExtracted: true,
        resourceCalls: [{
          participantTokenPresent: call.participantTokenPresent,
          participantLinked:
            !!call.participantTokenPresent &&
            typeof call.resourceConnection?.userId === 'number' &&
            typeof pipeline.participantUserId === 'number' &&
            call.resourceConnection.userId === pipeline.participantUserId,
          resourceSuccess: call.resourceSuccess,
          validationMatched: !!call.validationConnectionId,
          validationSuccess: call.validationSuccess ?? null,
        }],
      })),
    })),
    access_token_full: extractAccessTokenForDisplay(tokenIssue?.resBody),
    refresh_token_full: tokenIssueRefreshToken,
    issued_refresh_token_full: issuedRefreshToken,
    refresh_chain: refreshChain,
  };
}

export async function buildOAuthFilterOptions(participantUserId?: number) {
  const [pipelines, authServers, resourceServers] = await Promise.all([
    (prism as any).oAuthPipeline.findMany({
      select: {
        participantUserId: true,
      },
      distinct: ['participantUserId'],
      where: {
        ...(participantUserId ? { participantUserId } : {}),
        participantUserId: { not: null },
      },
    }),
    prism.backendServer.findMany({
      where: { serverRole: 'authentication' } as any,
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prism.backendServer.findMany({
      where: { serverRole: 'resource' } as any,
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const userIds: number[] = pipelines
    .map((pipeline: any) => pipeline.participantUserId)
    .filter((id: unknown): id is number => typeof id === 'number');

  const users = userIds.length > 0
    ? await gazelle.gazelleUser.findMany({
      where: { id: { in: userIds } },
      orderBy: { username: 'asc' },
      select: { id: true, username: true, firstname: true, lastname: true },
    })
    : [];

  return {
    participant_users: users.map((user) => ({
      id: user.id,
      username: user.username,
      name: `${user.firstname ?? ''} ${user.lastname ?? ''}`.trim() || user.username,
    })),
    authentication_servers: authServers,
    resource_servers: resourceServers,
  };
}
