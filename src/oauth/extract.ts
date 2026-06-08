import crypto from 'crypto';

type ConnectionLike = {
  reqUrl: string;
  reqHeaders: Record<string, string | string[]>;
  reqBody: string | null;
  resBody: string | null;
  resStatusCode: number | null;
  status: 'pending' | 'completed' | 'error';
};

type OAuthCallerType = 'client' | 'resource_server' | 'unknown';

export type OAuthExtract = {
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
  oauthCallerType: OAuthCallerType;
};

function firstHeader(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return null;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function previewToken(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function normalizePath(urlOrPath: string): string {
  try {
    return new URL(urlOrPath, 'http://placeholder').pathname;
  } catch {
    return urlOrPath;
  }
}

function pathMatches(expected: string | null, actual: string): boolean {
  if (!expected) return false;
  return normalizePath(expected) === normalizePath(actual);
}

function extractBearerToken(headers: Record<string, string | string[]>): string | null {
  const auth = firstHeader(headers.authorization);
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

function parseBodyObject(body: string | null): Record<string, unknown> | null {
  if (!body?.trim()) return null;

  try {
    const parsed = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    // fall through
  }

  try {
    const params = new URLSearchParams(body);
    const out: Record<string, string> = {};
    for (const [key, value] of params.entries()) out[key] = value;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function extractTokenFromBody(body: string | null): string | null {
  const parsed = parseBodyObject(body);
  if (!parsed) return null;
  const candidate = parsed.access_token ?? parsed.token;
  return typeof candidate === 'string' && candidate ? candidate : null;
}

function extractIssuedAccessToken(body: string | null): string | null {
  const parsed = parseBodyObject(body);
  if (!parsed) return null;
  return typeof parsed.access_token === 'string' && parsed.access_token ? parsed.access_token : null;
}

function extractStringField(body: string | null, field: string): string | null {
  const parsed = parseBodyObject(body);
  if (!parsed) return null;
  const value = parsed[field];
  return typeof value === 'string' && value ? value : null;
}

function responseSucceeded(connection: ConnectionLike): boolean {
  if (connection.status === 'error') return false;
  return connection.resStatusCode !== null && connection.resStatusCode >= 200 && connection.resStatusCode < 400;
}

export function classifyOAuthConnection(input: {
  server: {
    serverRole?: 'generic' | 'authentication' | 'resource';
    oauthTokenEndpoint?: string | null;
    oauthValidationEndpoint?: string | null;
  };
  connection: ConnectionLike;
  participantHeaderName: string;
}): OAuthExtract {
  const participantHeader = input.participantHeaderName.toLowerCase();
  const participantTokenPresent = !!firstHeader(input.connection.reqHeaders[participantHeader]);
  const requestBearer = extractBearerToken(input.connection.reqHeaders) ?? extractTokenFromBody(input.connection.reqBody);
  const requestRefreshToken = extractStringField(input.connection.reqBody, 'refresh_token');
  const issuedAccessToken = extractIssuedAccessToken(input.connection.resBody);
  const issuedRefreshToken = extractStringField(input.connection.resBody, 'refresh_token');

  const accessTokenHash = requestBearer ? sha256(requestBearer) : null;
  const accessTokenPreview = requestBearer ? previewToken(requestBearer) : null;
  const refreshTokenHash = requestRefreshToken ? sha256(requestRefreshToken) : null;
  const refreshTokenPreview = requestRefreshToken ? previewToken(requestRefreshToken) : null;
  const issuedAccessTokenHash = issuedAccessToken ? sha256(issuedAccessToken) : null;
  const issuedAccessTokenPreview = issuedAccessToken ? previewToken(issuedAccessToken) : null;
  const issuedRefreshTokenHash = issuedRefreshToken ? sha256(issuedRefreshToken) : null;
  const issuedRefreshTokenPreview = issuedRefreshToken ? previewToken(issuedRefreshToken) : null;

  let connectionKind: OAuthExtract['connectionKind'] = 'generic';
  let oauthCallerType: OAuthCallerType = 'unknown';

  if (
    input.server.serverRole === 'authentication' &&
    pathMatches(input.server.oauthTokenEndpoint ?? null, input.connection.reqUrl) &&
    !!issuedAccessTokenHash
  ) {
    connectionKind = 'oauth_token_issue';
    oauthCallerType = 'client';
  } else if (
    input.server.serverRole === 'resource' &&
    !!accessTokenHash
  ) {
    connectionKind = 'resource_access';
    oauthCallerType = 'client';
  } else if (
    input.server.serverRole === 'authentication' &&
    pathMatches(input.server.oauthValidationEndpoint ?? null, input.connection.reqUrl) &&
    !participantTokenPresent &&
    !!accessTokenHash
  ) {
    connectionKind = 'oauth_validation';
    oauthCallerType = 'resource_server';
  }

  if (!responseSucceeded(input.connection) && connectionKind === 'oauth_token_issue') {
    // Still keep token issue classification if endpoint matched, but failed requests should not claim issued token metadata.
    return {
      participantTokenPresent,
      accessTokenHash,
      accessTokenPreview,
      refreshTokenHash,
      refreshTokenPreview,
      issuedAccessTokenHash: null,
      issuedAccessTokenPreview: null,
      issuedRefreshTokenHash: null,
      issuedRefreshTokenPreview: null,
      connectionKind,
      oauthCallerType,
    };
  }

  return {
    participantTokenPresent,
    accessTokenHash,
    accessTokenPreview,
    refreshTokenHash,
    refreshTokenPreview,
    issuedAccessTokenHash,
    issuedAccessTokenPreview,
    issuedRefreshTokenHash,
    issuedRefreshTokenPreview,
    connectionKind,
    oauthCallerType,
  };
}
