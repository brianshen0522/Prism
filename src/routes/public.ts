import type { FastifyPluginAsync } from 'fastify';
import { prism } from '../db/prism';
import { fmtConnectionDetail, loadUserNameMap } from './connections';
import { buildOAuthPipelineDetail } from '../oauth/reconcile';
import { ensureConnectionShareTokens } from '../lib/share';

type PipelineDetail = NonNullable<Awaited<ReturnType<typeof buildOAuthPipelineDetail>>>;

function collectConnectionIds(result: PipelineDetail): string[] {
  const calls: Array<{ resource_connection_id: string; validation?: { connection_id: string } | null }> = result.resource_calls ?? [];
  return [
    result.token_issue?.connection_id ?? null,
    ...calls.map((rc) => rc.resource_connection_id),
    ...calls.map((rc) => rc.validation?.connection_id ?? null),
  ].filter((id): id is string => !!id);
}

export const publicRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/public/connections/:shareToken', async (req, reply) => {
    const { shareToken } = req.params as { shareToken: string };
    const c = await prism.connection.findUnique({
      where: { shareToken },
      include: { server: { select: { name: true } } },
    });
    if (!c) return reply.status(404).send({ error: 'Not found' });
    const userNameMap = await loadUserNameMap([c.userId]);
    const userName = typeof c.userId === 'number' ? userNameMap.get(c.userId) : undefined;
    return reply.send(fmtConnectionDetail(c as any, (c as any).server?.name, userName));
  });

  fastify.get('/public/oauth/pipelines/:shareToken', async (req, reply) => {
    const { shareToken } = req.params as { shareToken: string };
    const pipeline = await prism.oAuthPipeline.findUnique({
      where: { shareToken },
      select: { id: true },
    });
    if (!pipeline) return reply.status(404).send({ error: 'Not found' });

    const result = await buildOAuthPipelineDetail(pipeline.id);
    if (!result) return reply.status(404).send({ error: 'Not found' });

    const connectionShareTokens = await ensureConnectionShareTokens(collectConnectionIds(result));
    return reply.send({ ...result, share_token: shareToken, connection_share_tokens: connectionShareTokens });
  });
};
