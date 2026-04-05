import Fastify from 'fastify';
import { loadConfig } from './config';
import { TokenStore } from './state';

type TokenMode = 'success' | 'error' | 'malformed';
type ValidationMode = 'auto' | 'active' | 'inactive' | 'error' | 'malformed';

type ValidationBody = {
  access_token?: string;
  token?: string;
  simulate_validation_mode?: ValidationMode;
};

type TokenBody = {
  grant_type?: string;
  scope?: string;
  refresh_token?: string;
  simulate_token_mode?: TokenMode;
};

const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

type LogColor = keyof typeof ansi;

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function parseBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  if (!headerValue.startsWith('Bearer ')) return null;
  return headerValue.slice(7).trim() || null;
}

function parseBoolean(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(input.toLowerCase());
}

function readByPath(input: unknown, path: string): unknown {
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

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function serverBaseUrl(host: string, port: number) {
  return `http://127.0.0.1:${port}`;
}

function tokenPreview(token: string | null): string {
  if (!token) return 'none';
  if (token.length <= 18) return token;
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

function colorize(color: LogColor, text: string) {
  return `${ansi[color]}${text}${ansi.reset}`;
}

function logEvent(input: {
  color: LogColor;
  label: string;
  message: string;
  details?: Record<string, unknown>;
}) {
  const timestamp = new Date().toISOString();
  const prefix = `${ansi.dim}${timestamp}${ansi.reset} ${colorize(input.color, `[${input.label}]`)}`;
  const detailString = input.details
    ? ` ${ansi.gray}${Object.entries(input.details).map(([key, value]) => `${key}=${String(value)}`).join(' ')}${ansi.reset}`
    : '';
  console.log(`${prefix} ${input.message}${detailString}`);
}

function buildPatient(id: string) {
  return {
    resourceType: 'Patient',
    id,
    identifier: [
      {
        system: 'http://prism.local/mrn',
        value: id === 'example-patient' ? 'MRN-1001' : 'MRN-1002',
      },
    ],
    name: [
      id === 'example-patient'
        ? {
            family: 'Prism',
            given: ['OAuth', 'Simulator'],
          }
        : {
            family: 'Hapi',
            given: ['Fhir', 'Demo'],
          },
    ],
    gender: id === 'example-patient' ? 'unknown' : 'female',
    active: true,
  };
}

function buildPatientBundle(baseUrl: string, query: Record<string, unknown>) {
  const requestedName = typeof query.name === 'string' ? query.name.trim().toLowerCase() : '';
  const requestedFamily = typeof query.family === 'string' ? query.family.trim().toLowerCase() : '';
  const requestedIdentifier = typeof query.identifier === 'string' ? query.identifier.trim() : '';
  const patients = [buildPatient('example-patient'), buildPatient('demo-patient')].filter((patient) => {
    if (requestedName) {
      const fullName = patient.name.flatMap((name) => [name.family, ...(name.given ?? [])]).join(' ').toLowerCase();
      if (!fullName.includes(requestedName)) return false;
    }
    if (requestedFamily) {
      const family = patient.name[0]?.family?.toLowerCase() ?? '';
      if (!family.includes(requestedFamily)) return false;
    }
    if (requestedIdentifier) {
      const identifiers = patient.identifier?.map((identifier) => identifier.value) ?? [];
      if (!identifiers.includes(requestedIdentifier)) return false;
    }
    return true;
  });

  return {
    resourceType: 'Bundle',
    id: 'patient-search-results',
    type: 'searchset',
    total: patients.length,
    link: [
      {
        relation: 'self',
        url: buildUrl(baseUrl, '/fhir/Patient'),
      },
    ],
    entry: patients.map((patient) => ({
      fullUrl: buildUrl(baseUrl, `/fhir/Patient/${patient.id}`),
      resource: patient,
      search: {
        mode: 'match',
      },
    })),
  };
}

async function main() {
  const config = loadConfig();
  const store = new TokenStore();
  const authBaseUrl = serverBaseUrl(config.auth.host, config.auth.port);
  const resourceBaseUrl = serverBaseUrl(config.resource.host, config.resource.port);
  const realmName = 'master';

  const authApp = Fastify({ logger: false });
  const resourceApp = Fastify({ logger: false });

  const keycloakHealthPayload = {
    status: 'UP',
    checks: [
      {
        name: 'Keycloak database connections async health check',
        status: 'UP',
      },
    ],
  };
  const hapiFhirHealthPayload = {
    status: 'UP',
  };
  const hapiFhirLivenessPayload = {
    status: 'UP',
    components: {
      livenessState: {
        status: 'UP',
      },
    },
    groups: ['liveness'],
  };
  const hapiFhirReadinessPayload = {
    status: 'UP',
    components: {
      readinessState: {
        status: 'UP',
      },
    },
    groups: ['readiness'],
  };
  const capabilityStatement = {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString(),
    kind: 'instance',
    fhirVersion: '4.0.1',
    format: ['json'],
    software: {
      name: 'HAPI FHIR Simulator',
      version: '1.0.0',
    },
    implementation: {
      description: 'Prism OAuth simulator FHIR facade',
      url: buildUrl(resourceBaseUrl, '/fhir'),
    },
    rest: [
      {
        mode: 'server',
        security: {
          extension: [
            {
              url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
              extension: [
                {
                  url: 'token',
                  valueUri: buildUrl(authBaseUrl, config.auth.tokenEndpoint),
                },
              ],
            },
          ],
        },
        resource: [
          {
            type: 'Patient',
            interaction: [
              {
                code: 'search-type',
              },
              {
                code: 'read',
              },
            ],
          },
        ],
      },
    ],
  };

  authApp.get('/health', async () => ({ ok: true, role: 'authentication' }));
  authApp.get('/health/live', async () => ({
    status: 'UP',
    checks: [],
  }));
  authApp.get('/health/ready', async () => keycloakHealthPayload);
  authApp.get('/health/started', async () => ({
    status: 'UP',
    checks: [],
  }));
  authApp.get(`/realms/${realmName}`, async () => ({
    realm: realmName,
    public_key: 'simulated-public-key',
    'token-service': buildUrl(authBaseUrl, config.auth.tokenEndpoint),
    'account-service': buildUrl(authBaseUrl, `/realms/${realmName}/account`),
    'tokens-not-before': 0,
  }));
  authApp.get(`/realms/${realmName}/.well-known/openid-configuration`, async () => ({
    issuer: buildUrl(authBaseUrl, `/realms/${realmName}`),
    authorization_endpoint: buildUrl(authBaseUrl, `/realms/${realmName}/protocol/openid-connect/auth`),
    token_endpoint: buildUrl(authBaseUrl, config.auth.tokenEndpoint),
    introspection_endpoint: buildUrl(authBaseUrl, config.auth.validateEndpoint),
    userinfo_endpoint: buildUrl(authBaseUrl, `/realms/${realmName}/protocol/openid-connect/userinfo`),
    end_session_endpoint: buildUrl(authBaseUrl, `/realms/${realmName}/protocol/openid-connect/logout`),
    jwks_uri: buildUrl(authBaseUrl, `/realms/${realmName}/protocol/openid-connect/certs`),
    grant_types_supported: ['client_credentials', 'refresh_token'],
    response_types_supported: ['code', 'token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  }));
  authApp.get(`/admin/realms/${realmName}`, async () => ({
    id: realmName,
    realm: realmName,
    displayName: 'Simulated Keycloak Master Realm',
    enabled: true,
    sslRequired: 'external',
    registrationAllowed: false,
    loginWithEmailAllowed: true,
  }));
  resourceApp.get('/health', async () => ({ ok: true, role: 'resource' }));
  resourceApp.get('/actuator/health', async () => hapiFhirHealthPayload);
  resourceApp.get('/actuator/health/liveness', async () => hapiFhirLivenessPayload);
  resourceApp.get('/actuator/health/readiness', async () => hapiFhirReadinessPayload);
  resourceApp.get('/fhir/metadata', async () => capabilityStatement);
  resourceApp.get('/fhir', async () => capabilityStatement);

  authApp.post<{ Body: TokenBody; Querystring: { mode?: TokenMode } }>(
    config.auth.tokenEndpoint,
    async (request, reply) => {
      const participantTokenPresent = !!firstHeader(request.headers[config.participantHeaderName.toLowerCase()]);
      const mode = request.query.mode
        ?? request.body?.simulate_token_mode
        ?? firstHeader(request.headers['x-sim-token-mode']) as TokenMode | undefined
        ?? 'success';

      if (mode === 'error') {
        logEvent({
          color: 'red',
          label: 'TOKEN',
          message: 'token issuance failed',
          details: {
            mode,
            participant: participantTokenPresent,
          },
        });
        return reply.status(400).send({
          error: 'invalid_client',
          error_description: 'Simulated token issue failure',
        });
      }

      if (mode === 'malformed') {
        logEvent({
          color: 'yellow',
          label: 'TOKEN',
          message: 'token issuance returned malformed response',
          details: {
            mode,
            participant: participantTokenPresent,
          },
        });
        return reply.send({
          token: 'malformed-token-response',
          note: 'Missing access_token on purpose',
        });
      }

      const grantType = request.body?.grant_type || 'client_credentials';
      if (grantType === 'refresh_token') {
        const refreshToken = request.body?.refresh_token ?? null;
        const refreshed = refreshToken ? store.exchangeRefreshToken(refreshToken) : null;

        if (!refreshed) {
          logEvent({
            color: 'red',
            label: 'REFRESH',
            message: 'refresh token exchange failed',
            details: {
              participant: participantTokenPresent,
              refresh: tokenPreview(refreshToken),
            },
          });
          return reply.status(400).send({
            error: 'invalid_grant',
            error_description: 'Refresh token is missing or invalid',
          });
        }

        logEvent({
          color: 'green',
          label: 'REFRESH',
          message: 'refresh token exchanged for a new access token',
          details: {
            participant: participantTokenPresent,
            refresh: tokenPreview(refreshToken),
            access: tokenPreview(refreshed.accessToken),
            scope: refreshed.scope,
          },
        });

        return reply.send({
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: refreshed.scope,
        });
      }

      const scope = request.body?.scope || 'patient/*.read';
      const token = store.issue(scope);

      logEvent({
        color: 'green',
        label: 'TOKEN',
        message: 'access token issued',
        details: {
          token: tokenPreview(token.accessToken),
          participant: participantTokenPresent,
          scope: token.scope,
        },
      });

      return reply.send({
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: token.scope,
      });
    },
  );

  authApp.post<{ Body: ValidationBody; Querystring: { mode?: ValidationMode } }>(
    config.auth.validateEndpoint,
    async (request, reply) => {
      const participantTokenPresent = !!firstHeader(request.headers[config.participantHeaderName.toLowerCase()]);
      const requestedToken = parseBearerToken(firstHeader(request.headers.authorization))
        ?? request.body?.access_token
        ?? request.body?.token
        ?? null;

      const mode = request.query.mode
        ?? request.body?.simulate_validation_mode
        ?? firstHeader(request.headers['x-sim-validation-mode']) as ValidationMode | undefined
        ?? 'auto';

      if (mode === 'error') {
        logEvent({
          color: 'red',
          label: 'VALIDATE',
          message: 'validation endpoint returned server error',
          details: {
            token: tokenPreview(requestedToken),
            mode,
            participant: participantTokenPresent,
          },
        });
        return reply.status(500).send({
          error: 'validation_failed',
          error_description: 'Simulated validation failure',
        });
      }

      if (mode === 'malformed') {
        logEvent({
          color: 'yellow',
          label: 'VALIDATE',
          message: 'validation returned malformed response',
          details: {
            token: tokenPreview(requestedToken),
            mode,
            participant: participantTokenPresent,
          },
        });
        return reply.send({
          status: 'ok',
          note: 'Missing active field on purpose',
        });
      }

      const token = requestedToken ? store.get(requestedToken) : null;
      const active = mode === 'active'
        ? true
        : mode === 'inactive'
          ? false
          : !!token;

      logEvent({
        color: active ? 'cyan' : 'red',
        label: 'VALIDATE',
        message: active ? 'token validated as active' : 'token validated as inactive',
        details: {
          token: tokenPreview(requestedToken),
          mode,
          participant: participantTokenPresent,
        },
      });

      return reply.send({
        active,
        token_type: 'Bearer',
        scope: token?.scope ?? 'patient/*.read',
        sub: token?.subject ?? 'unknown',
      });
    },
  );

  async function validateProtectedResourceRequest(
    request: {
      headers: Record<string, string | string[] | undefined>;
      query: { skipValidation?: string; validationMode?: ValidationMode };
      url: string;
    },
    reply: {
      status: (code: number) => { send: (body: unknown) => unknown };
      send: (body: unknown) => unknown;
    }
  ): Promise<{ skippedValidation: boolean } | undefined> {
    const participantTokenPresent = !!firstHeader(request.headers[config.participantHeaderName.toLowerCase()]);
    const accessToken = parseBearerToken(firstHeader(request.headers.authorization));
    const requestPath = new URL(request.url, 'http://placeholder').pathname;
    const isLegacyPatientPath = requestPath === '/resource/patient';
    const isFhirPatientPath = requestPath === '/fhir/Patient' || /^\/fhir\/Patient\/[^/]+$/.test(requestPath);

    const isSupportedPath = isLegacyPatientPath || isFhirPatientPath;
    if (!isSupportedPath) {
      return reply.status(404).send({
        message: `Route GET:${requestPath} not found`,
        error: 'Not Found',
        statusCode: 404,
      }) as undefined;
    }

    if (!accessToken) {
      logEvent({
        color: 'red',
        label: 'RESOURCE',
        message: 'resource request rejected: missing bearer token',
        details: {
          path: requestPath,
          participant: participantTokenPresent,
        },
      });
      return reply.status(401).send({
        error: 'missing_token',
        error_description: 'Authorization: Bearer <token> is required',
      }) as undefined;
    }

    logEvent({
      color: 'blue',
      label: 'RESOURCE',
      message: 'resource request received',
      details: {
        path: requestPath,
        token: tokenPreview(accessToken),
        participant: participantTokenPresent,
      },
    });

    if (parseBoolean(request.query.skipValidation)) {
      logEvent({
        color: 'yellow',
        label: 'RESOURCE',
        message: 'resource request skipped validation',
        details: {
          path: requestPath,
          token: tokenPreview(accessToken),
        },
      });

      return { skippedValidation: true };
    }

    const validationUrl = buildUrl(config.resource.authValidateBaseUrl, config.auth.validateEndpoint);
    logEvent({
      color: 'magenta',
      label: 'RS->AS',
      message: 'resource server calling auth validation endpoint',
      details: {
        path: requestPath,
        token: tokenPreview(accessToken),
        target: validationUrl,
        participant: false,
      },
    });

    const validationResponse = await fetch(validationUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: accessToken,
        simulate_validation_mode: request.query.validationMode ?? 'auto',
      }),
    });

    let validationJson: unknown = null;
    try {
      validationJson = await validationResponse.json();
    } catch {
      validationJson = null;
    }

    const passed = validationResponse.ok
      && normalizeScalar(readByPath(validationJson, config.auth.validationSuccessPath))
        === config.auth.validationSuccessValue;

    if (!passed) {
      logEvent({
        color: 'red',
        label: 'RESOURCE',
        message: 'resource request denied after validation',
        details: {
          path: requestPath,
          token: tokenPreview(accessToken),
          validationStatus: validationResponse.status,
        },
      });
      return reply.status(401).send({
        error: 'invalid_token',
        error_description: 'Token validation failed',
        validation_response: validationJson,
      }) as undefined;
    }

    logEvent({
      color: 'green',
      label: 'RESOURCE',
      message: 'resource request succeeded after validation',
      details: {
        path: requestPath,
        token: tokenPreview(accessToken),
        validationStatus: validationResponse.status,
      },
    });

    return { skippedValidation: false };
  }

  async function handleLegacyPatientRequest(
    request: {
      headers: Record<string, string | string[] | undefined>;
      query: { skipValidation?: string; validationMode?: ValidationMode };
      url: string;
    },
    reply: {
      status: (code: number) => { send: (body: unknown) => unknown };
      send: (body: unknown) => unknown;
    },
  ) {
    const validationResult = await validateProtectedResourceRequest(request, reply);
    if (!validationResult) return;

    const patient = buildPatient('example-patient');
    if (validationResult.skippedValidation) {
      return reply.send({
        ...patient,
        validation_skipped: true,
      });
    }

    return reply.send(patient);
  }

  async function handleFhirPatientSearch(
    request: {
      headers: Record<string, string | string[] | undefined>;
      query: { skipValidation?: string; validationMode?: ValidationMode } & Record<string, unknown>;
      url: string;
    },
    reply: {
      status: (code: number) => { send: (body: unknown) => unknown };
      send: (body: unknown) => unknown;
    },
  ) {
    const validationResult = await validateProtectedResourceRequest(request, reply);
    if (!validationResult) return;

    const bundle = buildPatientBundle(resourceBaseUrl, request.query);
    if (validationResult.skippedValidation) {
      return reply.send({
        ...bundle,
        validation_skipped: true,
      });
    }

    return reply.send(bundle);
  }

  async function handleFhirPatientRead(
    request: {
      headers: Record<string, string | string[] | undefined>;
      query: { skipValidation?: string; validationMode?: ValidationMode };
      url: string;
      params: { id: string };
    },
    reply: {
      status: (code: number) => { send: (body: unknown) => unknown };
      send: (body: unknown) => unknown;
    },
  ) {
    const validationResult = await validateProtectedResourceRequest(request, reply);
    if (!validationResult) return;

    const patient = buildPatient(request.params.id);
    if (validationResult.skippedValidation) {
      return reply.send({
        ...patient,
        validation_skipped: true,
      });
    }

    return reply.send(patient);
  }

  resourceApp.get<{ Querystring: { skipValidation?: string; validationMode?: ValidationMode } }>(
    '/resource/patient',
    async (request, reply) => handleLegacyPatientRequest(request, reply),
  );
  resourceApp.get<{ Querystring: { skipValidation?: string; validationMode?: ValidationMode } & Record<string, unknown> }>(
    '/fhir/Patient',
    async (request, reply) => handleFhirPatientSearch(request, reply),
  );
  resourceApp.get<{ Params: { id: string }; Querystring: { skipValidation?: string; validationMode?: ValidationMode } }>(
    '/fhir/Patient/:id',
    async (request, reply) => handleFhirPatientRead(request, reply),
  );

  resourceApp.get<{ Params: { wildcard: string }; Querystring: { skipValidation?: string; validationMode?: ValidationMode } }>(
    '/resource/*',
    async (request, reply) => validateProtectedResourceRequest(request, reply),
  );
  resourceApp.get<{ Params: { wildcard: string }; Querystring: { skipValidation?: string; validationMode?: ValidationMode } }>(
    '/fhir/*',
    async (request, reply) => validateProtectedResourceRequest(request, reply),
  );

  await authApp.listen({ host: config.auth.host, port: config.auth.port });
  await resourceApp.listen({ host: config.resource.host, port: config.resource.port });

  logEvent({
    color: 'green',
    label: 'BOOT',
    message: 'OAuth simulator started',
    details: {
      auth: `http://${config.auth.host}:${config.auth.port}`,
      resource: `http://${config.resource.host}:${config.resource.port}`,
      tokenEndpoint: config.auth.tokenEndpoint,
      validateEndpoint: config.auth.validateEndpoint,
      validateBaseUrl: config.resource.authValidateBaseUrl,
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
