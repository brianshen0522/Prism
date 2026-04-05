import type { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { prism } from '../db/prism';
import { authenticate } from '../plugins/authenticate';

const DEFAULT_HEADER = 'X-Participant-Token';
const DEFAULT_TTL_MINUTES = 5;

type BackendServerRecord = Awaited<ReturnType<typeof prism.backendServer.findMany>>[number] & Record<string, any>;

async function getParticipantHeaderName() {
  const setting = await prism.systemSetting.findUnique({ where: { key: 'participant_token_header' } });
  return setting?.value || DEFAULT_HEADER;
}

async function ensureParticipantToken(userId: number) {
  const existing = await prism.participantToken.findUnique({ where: { userId } });
  if (existing && existing.expiresAt > new Date()) return existing;

  const ttlSetting = await prism.systemSetting.findUnique({ where: { key: 'participant_token_ttl_minutes' } });
  const ttl = parseInt(ttlSetting?.value ?? '', 10);
  const ttlMinutes = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_MINUTES;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  return prism.participantToken.upsert({
    where: { userId },
    create: { id: crypto.randomUUID(), userId, token, expiresAt },
    update: { token, expiresAt },
  });
}

function maskToken(token: string | null) {
  if (!token) return null;
  if (token.length <= 12) return token;
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

function joinUrl(baseUrl: string, path = '/') {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function userFacingBaseUrl(server: BackendServerRecord) {
  return (server.heartbeatUrl as string | null) || server.targetUrl;
}

function tokenEndpointUrl(server: BackendServerRecord) {
  if (!server.oauthTokenEndpoint) return null;
  return joinUrl(userFacingBaseUrl(server), server.oauthTokenEndpoint as string);
}

function buildCurrentTokenCurl(origin: string, username: string) {
  return `curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"username":"${username}","password":"<password>"}' \\
  ${origin}/api/token/current`;
}

function buildTokenRequestCurl(headerName: string, authUrl: string) {
  return `curl -X POST \\
  -H "Content-Type: application/json" \\
  -H "${headerName}: <participant_token>" \\
  -d '{"grant_type":"client_credentials"}' \\
  ${authUrl}`;
}

function buildResourceCurl(headerName: string, resourceBaseUrl: string) {
  return `curl -i \\
  -H "Authorization: Bearer <access_token>" \\
  -H "${headerName}: <participant_token>" \\
  ${joinUrl(resourceBaseUrl, '/')}`;
}

function buildDirectCurl(headerName: string, publicBaseUrl: string) {
  return `curl -i \\
  -H "${headerName}: <participant_token>" \\
  ${joinUrl(publicBaseUrl, '/')}`;
}

function buildGuideItem(
  server: BackendServerRecord,
  authServer: BackendServerRecord | null,
) {
  const publicBaseUrl = userFacingBaseUrl(server);
  const authRequired = server.serverRole === 'resource' && !!authServer;
  const kind = authRequired ? 'oauth-pair' : 'direct-server';

  return {
    id: server.id,
    kind,
    title: server.name,
    description: server.description ?? null,
    role: server.serverRole,
    public_base_url: publicBaseUrl,
    target_url: server.targetUrl,
    auth_required: authRequired,
    authentication_server: authServer
      ? {
        id: authServer.id,
        name: authServer.name,
        public_base_url: userFacingBaseUrl(authServer),
        token_endpoint: tokenEndpointUrl(authServer),
      }
      : null,
    summary: authRequired
      ? `${authServer?.name} → ${server.name}`
      : 'Direct access',
  };
}

export const integrationGuideRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/integration-guide', { preHandler: [authenticate] }, async (request, reply) => {
    const [servers, headerName, participantToken] = await Promise.all([
      prism.backendServer.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
      getParticipantHeaderName(),
      ensureParticipantToken(request.user.sub),
    ]);

    const byId = new Map(servers.map((server) => [server.id, server as BackendServerRecord]));

    const items = servers
      .map((server) => server as BackendServerRecord)
      .filter((server) => server.serverRole !== 'authentication')
      .map((server) => {
        const authServer = server.oauthAuthServerId ? byId.get(server.oauthAuthServerId as string) ?? null : null;
        return buildGuideItem(server, authServer);
      });

    return reply.send({
      participant_token: {
        header_name: headerName,
        token: participantToken.token,
        masked_token: maskToken(participantToken.token),
        expires_at: participantToken.expiresAt.toISOString(),
      },
      overview: {
        total_servers: items.length,
        direct_servers: items.filter((item) => item.kind === 'direct-server').length,
        oauth_pairs: items.filter((item) => item.kind === 'oauth-pair').length,
      },
      items,
    });
  });

  fastify.get('/integration-guide/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [servers, headerName, participantToken] = await Promise.all([
      prism.backendServer.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
      getParticipantHeaderName(),
      ensureParticipantToken(request.user.sub),
    ]);

    const byId = new Map(servers.map((server) => [server.id, server as BackendServerRecord]));
    const server = byId.get(id);
    if (!server || server.serverRole === 'authentication') {
      return reply.status(404).send({ error: 'Guide item not found' });
    }

    const authServer = server.oauthAuthServerId ? byId.get(server.oauthAuthServerId as string) ?? null : null;
    const origin = `${request.protocol}://${request.headers.host}`;
    const publicBaseUrl = userFacingBaseUrl(server);
    const item = buildGuideItem(server, authServer);

    const steps = authServer
      ? [
        {
          id: `${server.id}-participant-token`,
          title: 'Get your participant token',
          description: 'Request your current participant token before starting the OAuth flow.',
          method: 'POST',
          url: `${origin}/api/token/current`,
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          curl: buildCurrentTokenCurl(origin, request.user.username),
          kind: 'participant-token',
        },
        {
          id: `${server.id}-token-request`,
          title: `Request an access token from ${authServer.name}`,
          description: 'Send the participant token to the authentication server and obtain an OAuth access token.',
          method: 'POST',
          url: tokenEndpointUrl(authServer),
          headers: [
            { name: 'Content-Type', value: 'application/json' },
            { name: headerName, value: '<participant_token>' },
          ],
          curl: tokenEndpointUrl(authServer)
            ? buildTokenRequestCurl(headerName, tokenEndpointUrl(authServer) as string)
            : null,
          kind: 'token-request',
        },
        {
          id: `${server.id}-resource-call`,
          title: `Call ${server.name}`,
          description: 'Use the access token on the user-facing resource URL and include the participant token again.',
          method: 'GET',
          url: joinUrl(publicBaseUrl, '/'),
          headers: [
            { name: 'Authorization', value: 'Bearer <access_token>' },
            { name: headerName, value: '<participant_token>' },
          ],
          curl: buildResourceCurl(headerName, publicBaseUrl),
          kind: 'resource-call',
        },
      ]
      : [
        {
          id: `${server.id}-direct-call`,
          title: `Call ${server.name}`,
          description: 'Use the public access URL directly and include the participant token header.',
          method: 'GET',
          url: joinUrl(publicBaseUrl, '/'),
          headers: [{ name: headerName, value: '<participant_token>' }],
          curl: buildDirectCurl(headerName, publicBaseUrl),
          kind: 'resource-call',
        },
      ];

    return reply.send({
      participant_token: {
        header_name: headerName,
        token: participantToken.token,
        masked_token: maskToken(participantToken.token),
        expires_at: participantToken.expiresAt.toISOString(),
      },
      item,
      detail: {
        notes: authServer
          ? [
            `This server is protected by ${authServer.name}.`,
            'Get a participant token first, then request an access token before calling the resource server.',
          ]
          : ['This server can be accessed directly with the participant token header.'],
        steps,
      },
    });
  });
};
