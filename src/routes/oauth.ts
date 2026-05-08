import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../plugins/authenticate';
import { requireRole } from '../plugins/authorize';
import { prism } from '../db/prism';
import {
  buildOAuthFilterOptions,
  buildOAuthPipelineDetail,
  buildOAuthPipelineList,
  reconcileOAuthPipeline,
} from '../oauth/reconcile';
import { ensureConnectionShareTokens, ensurePipelineShareToken } from '../lib/share';
import { canRoleViewAllTraffic } from '../lib/settings';

type PipelineDetail = NonNullable<Awaited<ReturnType<typeof buildOAuthPipelineDetail>>>;

function collectConnectionIds(result: PipelineDetail): string[] {
  const calls: Array<{ resource_connection_id: string; validation?: { connection_id: string } | null }> = result.resource_calls ?? [];
  return [
    result.token_issue?.connection_id ?? null,
    ...calls.map((rc) => rc.resource_connection_id),
    ...calls.map((rc) => rc.validation?.connection_id ?? null),
  ].filter((id): id is string => !!id);
}

function parseCsvValues(input?: string) {
  if (!input?.trim()) return [];
  return input.split(',').map((value) => value.trim()).filter(Boolean);
}

export const oauthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/oauth/filter-options', { preHandler: [authenticate] }, async (request, reply) => {
    const canViewAllTraffic = await canRoleViewAllTraffic(request.user.role);
    return reply.send(await buildOAuthFilterOptions(canViewAllTraffic ? undefined : request.user.sub));
  });

  fastify.get('/oauth/pipelines', { preHandler: [authenticate] }, async (request, reply) => {
    const {
      page = '1',
      limit = '25',
      access_token,
      participant_user_id,
      legal = 'all',
      success = 'all',
      authentication_server_id,
      resource_server_id,
    } = request.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const canViewAllTraffic = await canRoleViewAllTraffic(request.user.role);

    const participantUserIds = (canViewAllTraffic ? parseCsvValues(participant_user_id) : [String(request.user.sub)])
      .map((value) => parseInt(value, 10))
      .filter((value) => !Number.isNaN(value));

    const result = await buildOAuthPipelineList({
      page: pageNum,
      limit: limitNum,
      accessToken: access_token,
      participantUserIds,
      legal: legal === 'legal' || legal === 'illegal' ? legal : 'all',
      success: success === 'success' || success === 'failed' ? success : 'all',
      authenticationServerIds: parseCsvValues(authentication_server_id),
      resourceServerIds: parseCsvValues(resource_server_id),
    });

    return reply.send({
      data: result.data,
      total: result.total,
      page: pageNum,
      limit: limitNum,
    });
  });

  // Re-run reconciliation for all orphaned validation connections (admin only)
  fastify.post('/oauth/rereconcile', { preHandler: [authenticate, requireRole('admin')] }, async (_request, reply) => {
    const orphans = await (prism as any).connection.findMany({
      where: {
        connectionKind: 'oauth_validation',
        status: 'completed',
        oauthValidationCall: { is: null },
      },
      select: { id: true },
    });

    let reconciled = 0;
    for (const { id } of orphans) {
      try {
        await reconcileOAuthPipeline(id);
        reconciled++;
      } catch {
        // best-effort
      }
    }

    return reply.send({ orphans_found: orphans.length, reconciled });
  });

  fastify.get('/oauth/pipelines/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await buildOAuthPipelineDetail(id);
    if (!result) return reply.status(404).send({ error: 'OAuth pipeline not found' });
    const canViewAllTraffic = await canRoleViewAllTraffic(request.user.role);
    if (!canViewAllTraffic && result.summary.participant_user?.id !== request.user.sub) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const [shareToken, connectionShareTokens] = await Promise.all([
      ensurePipelineShareToken(id),
      ensureConnectionShareTokens(collectConnectionIds(result)),
    ]);
    return reply.send({ ...result, share_token: shareToken, connection_share_tokens: connectionShareTokens });
  });
};
