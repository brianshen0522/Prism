import { Prisma } from '@prisma/client';
import { prism } from '../db/prism';
import { updateTask } from './manager';
import { proxyManager } from '../proxy/manager';

const BATCH_SIZE = 500;

export interface ExportData {
  prism_export_version: string;
  exported_at: string;
  exported_by: string;
  data: {
    settings?: Record<string, unknown>[];
    servers?: Record<string, unknown>[];
    participant_tokens?: Record<string, unknown>[];
    connections?: Record<string, unknown>[];
    oauth_pipelines?: Record<string, unknown>[];
    oauth_pipeline_resource_calls?: Record<string, unknown>[];
  };
}

export function validateExportData(body: unknown): body is ExportData {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (typeof b['prism_export_version'] !== 'string') return false;
  if (!b['data'] || typeof b['data'] !== 'object') return false;
  return true;
}

function toDate(v: unknown): Date {
  return new Date(v as string);
}

export async function runImport(taskId: string, data: ExportData): Promise<void> {
  try {
    await updateTask(taskId, { progress: 2, message: 'Stopping proxy listeners...' });
    await proxyManager.shutdown();

    // Clear all data in reverse dependency order
    await updateTask(taskId, { progress: 6, message: 'Clearing existing data...' });
    await prism.oAuthPipelineResourceCall.deleteMany();
    await prism.oAuthPipeline.deleteMany();
    await prism.connection.deleteMany();
    await prism.participantToken.deleteMany();
    await prism.backendServer.deleteMany();
    await prism.systemSetting.deleteMany();

    // Settings
    await updateTask(taskId, { progress: 12, message: 'Importing settings...' });
    const settings = data.data.settings ?? [];
    for (const s of settings) {
      await prism.systemSetting.create({
        data: {
          key: s['key'] as string,
          value: s['value'] as string,
          updatedBy: s['updatedBy'] as number,
          updatedAt: toDate(s['updatedAt']),
        },
      });
    }

    // Servers (two-pass to handle self-referential oauthAuthServerId FK)
    await updateTask(taskId, { progress: 16, message: 'Importing servers...' });
    const servers = data.data.servers ?? [];
    for (const s of servers) {
      await prism.backendServer.create({
        data: {
          id: s['id'] as string,
          name: s['name'] as string,
          description: (s['description'] as string | null) ?? null,
          targetUrl: s['targetUrl'] as string,
          isHttps: s['isHttps'] as boolean,
          sslVerify: (s['sslVerify'] as boolean) ?? true,
          proxyPort: s['proxyPort'] as number,
          isActive: s['isActive'] as boolean,
          bodySizeLimitKb: (s['bodySizeLimitKb'] as number | null) ?? null,
          createdBy: s['createdBy'] as number,
          createdAt: toDate(s['createdAt']),
          serverRole: s['serverRole'] as 'generic' | 'authentication' | 'resource',
          oauthAuthServerId: null, // set in second pass
          oauthTokenEndpoint: (s['oauthTokenEndpoint'] as string | null) ?? null,
          oauthValidationEndpoint: (s['oauthValidationEndpoint'] as string | null) ?? null,
          oauthValidationSuccessPath: (s['oauthValidationSuccessPath'] as string | null) ?? null,
          oauthValidationSuccessValue: (s['oauthValidationSuccessValue'] as string | null) ?? null,
          targetTestMethod: (s['targetTestMethod'] as string | null) ?? 'GET',
          targetTestTimeoutSeconds: (s['targetTestTimeoutSeconds'] as number | null) ?? 10,
          heartbeatEnabled: (s['heartbeatEnabled'] as boolean) ?? false,
          heartbeatUrl: (s['heartbeatUrl'] as string | null) ?? null,
          heartbeatPath: (s['heartbeatPath'] as string | null) ?? null,
          heartbeatMethod: (s['heartbeatMethod'] as string | null) ?? 'GET',
          heartbeatIntervalSeconds: (s['heartbeatIntervalSeconds'] as number | null) ?? 60,
          heartbeatExpectedStatus: (s['heartbeatExpectedStatus'] as number | null) ?? 200,
          heartbeatTimeoutSeconds: (s['heartbeatTimeoutSeconds'] as number | null) ?? 10,
          heartbeatTlsVerify: (s['heartbeatTlsVerify'] as boolean) ?? true,
          ignoredPaths: (s['ignoredPaths'] as string[]) ?? [],
        },
      });
    }
    // Second pass: restore oauthAuthServerId FKs
    for (const s of servers) {
      if (s['oauthAuthServerId']) {
        await prism.backendServer.update({
          where: { id: s['id'] as string },
          data: { oauthAuthServerId: s['oauthAuthServerId'] as string },
        });
      }
    }

    // Participant tokens
    await updateTask(taskId, { progress: 22, message: 'Importing participant tokens...' });
    const tokens = data.data.participant_tokens ?? [];
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      await prism.participantToken.createMany({
        data: tokens.slice(i, i + BATCH_SIZE).map((t) => ({
          id: t['id'] as string,
          userId: t['userId'] as number,
          institutionId: (t['institutionId'] as number | null) ?? null,
          token: t['token'] as string,
          expiresAt: toDate(t['expiresAt']),
          createdAt: toDate(t['createdAt']),
        })),
        skipDuplicates: true,
      });
    }

    // Connections (batched)
    const connections = data.data.connections ?? [];
    const totalConns = connections.length;
    for (let i = 0; i < connections.length; i += BATCH_SIZE) {
      const batch = connections.slice(i, i + BATCH_SIZE);
      await prism.connection.createMany({
        data: batch.map((c) => ({
          id: c['id'] as string,
          userId: (c['userId'] as number | null) ?? null,
          institutionId: (c['institutionId'] as number | null) ?? null,
          serverId: c['serverId'] as string,
          status: c['status'] as 'pending' | 'completed' | 'error',
          reqId: c['reqId'] as string,
          reqTimestamp: toDate(c['reqTimestamp']),
          reqMethod: c['reqMethod'] as string,
          reqUrl: c['reqUrl'] as string,
          reqHeaders: c['reqHeaders'] as Prisma.InputJsonValue,
          reqBody: (c['reqBody'] as string | null) ?? null,
          reqBodySize: (c['reqBodySize'] as number | null) ?? null,
          reqBodyTruncated: (c['reqBodyTruncated'] as boolean) ?? false,
          resId: (c['resId'] as string | null) ?? null,
          resTimestamp: c['resTimestamp'] ? toDate(c['resTimestamp']) : null,
          resStatusCode: (c['resStatusCode'] as number | null) ?? null,
          resHeaders: c['resHeaders'] != null ? (c['resHeaders'] as Prisma.InputJsonValue) : Prisma.DbNull,
          resBody: (c['resBody'] as string | null) ?? null,
          resBodySize: (c['resBodySize'] as number | null) ?? null,
          resBodyTruncated: (c['resBodyTruncated'] as boolean) ?? false,
          durationMs: (c['durationMs'] as number | null) ?? null,
          createdAt: toDate(c['createdAt']),
          participantTokenPresent: (c['participantTokenPresent'] as boolean) ?? false,
          participantTokenValid: (c['participantTokenValid'] as boolean | null) ?? null,
          participantTokenInvalidReason: (c['participantTokenInvalidReason'] as string | null) ?? null,
          isSystemHeartbeat: (c['isSystemHeartbeat'] as boolean) ?? false,
          heartbeatId: (c['heartbeatId'] as string | null) ?? null,
          isPathIgnored: (c['isPathIgnored'] as boolean) ?? false,
          accessTokenHash: (c['accessTokenHash'] as string | null) ?? null,
          accessTokenPreview: (c['accessTokenPreview'] as string | null) ?? null,
          refreshTokenHash: (c['refreshTokenHash'] as string | null) ?? null,
          refreshTokenPreview: (c['refreshTokenPreview'] as string | null) ?? null,
          issuedAccessTokenHash: (c['issuedAccessTokenHash'] as string | null) ?? null,
          issuedAccessTokenPreview: (c['issuedAccessTokenPreview'] as string | null) ?? null,
          issuedRefreshTokenHash: (c['issuedRefreshTokenHash'] as string | null) ?? null,
          issuedRefreshTokenPreview: (c['issuedRefreshTokenPreview'] as string | null) ?? null,
          connectionKind: (c['connectionKind'] as 'generic' | 'oauth_token_issue' | 'resource_access' | 'oauth_validation') ?? 'generic',
          oauthCallerType: (c['oauthCallerType'] as 'client' | 'resource_server' | 'unknown') ?? 'unknown',
          shareToken: (c['shareToken'] as string | null) ?? null,
        })),
        skipDuplicates: true,
      });
      const prog = 25 + Math.round(((i + batch.length) / Math.max(totalConns, 1)) * 53);
      await updateTask(taskId, {
        progress: Math.min(prog, 78),
        message: `Importing traffic... (${Math.min(i + batch.length, totalConns)}/${totalConns})`,
      });
    }

    // OAuth pipelines
    await updateTask(taskId, { progress: 80, message: 'Importing OAuth pipelines...' });
    const pipelines = data.data.oauth_pipelines ?? [];
    for (let i = 0; i < pipelines.length; i += BATCH_SIZE) {
      await prism.oAuthPipeline.createMany({
        data: pipelines.slice(i, i + BATCH_SIZE).map((p) => ({
          id: p['id'] as string,
          participantUserId: (p['participantUserId'] as number | null) ?? null,
          participantInstitutionId: (p['participantInstitutionId'] as number | null) ?? null,
          authenticationServerId: (p['authenticationServerId'] as string | null) ?? null,
          accessTokenHash: p['accessTokenHash'] as string,
          accessTokenPreview: p['accessTokenPreview'] as string,
          tokenIssueConnectionId: (p['tokenIssueConnectionId'] as string | null) ?? null,
          issuedAt: p['issuedAt'] ? toDate(p['issuedAt']) : null,
          complete: (p['complete'] as boolean) ?? false,
          legal: (p['legal'] as boolean) ?? false,
          success: (p['success'] as boolean) ?? false,
          resourceCallCount: (p['resourceCallCount'] as number) ?? 0,
          lastSeenAt: toDate(p['lastSeenAt']),
          createdAt: toDate(p['createdAt']),
          shareToken: (p['shareToken'] as string | null) ?? null,
        })),
        skipDuplicates: true,
      });
    }

    // Pipeline resource calls
    await updateTask(taskId, { progress: 90, message: 'Importing pipeline resource calls...' });
    const calls = data.data.oauth_pipeline_resource_calls ?? [];
    for (let i = 0; i < calls.length; i += BATCH_SIZE) {
      await prism.oAuthPipelineResourceCall.createMany({
        data: calls.slice(i, i + BATCH_SIZE).map((c) => ({
          id: c['id'] as string,
          pipelineId: c['pipelineId'] as string,
          resourceConnectionId: c['resourceConnectionId'] as string,
          resourceServerId: c['resourceServerId'] as string,
          validationConnectionId: (c['validationConnectionId'] as string | null) ?? null,
          resourceSuccess: (c['resourceSuccess'] as boolean) ?? false,
          validationSuccess: (c['validationSuccess'] as boolean | null) ?? null,
          participantTokenPresent: (c['participantTokenPresent'] as boolean) ?? false,
          validationMatched: (c['validationMatched'] as boolean) ?? false,
          createdAt: toDate(c['createdAt']),
        })),
        skipDuplicates: true,
      });
    }

    // Restart proxy listeners
    await updateTask(taskId, { progress: 96, message: 'Restarting proxy listeners...' });
    await proxyManager.init();

    await updateTask(taskId, {
      status: 'done',
      progress: 100,
      message: `Import complete. ${servers.length} servers, ${totalConns} connections, ${pipelines.length} pipelines.`,
      completedAt: new Date(),
    });
  } catch (err) {
    await proxyManager.init().catch(() => {});
    await updateTask(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      completedAt: new Date(),
    }).catch(() => {});
  }
}
