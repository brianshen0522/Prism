type ScenarioName =
  | 'happy-path'
  | 'refresh-token'
  | 'missing-participant-token'
  | 'missing-validation'
  | 'failed-validation'
  | 'failed-token-issue'
  | 'multiple-resource-calls'
  | 'token-only';

type DriverConfig = {
  authBaseUrl: string;
  resourceBaseUrl: string;
  participantHeaderName: string;
  participantTokenValue: string;
  tokenEndpoint: string;
};

type DriverOptions = {
  omitOn: 'token' | 'resource' | 'both';
  tokenMode: 'error' | 'malformed';
  calls: number;
};

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function parseArgs(argv: string[]): { scenario: ScenarioName; options: DriverOptions } {
  const scenario = (argv[0] || 'happy-path') as ScenarioName;
  const options: DriverOptions = {
    omitOn: 'both',
    tokenMode: 'error',
    calls: 3,
  };

  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--omit-on=')) {
      const value = arg.slice('--omit-on='.length);
      if (value === 'token' || value === 'resource' || value === 'both') options.omitOn = value;
    } else if (arg.startsWith('--token-mode=')) {
      const value = arg.slice('--token-mode='.length);
      if (value === 'error' || value === 'malformed') options.tokenMode = value;
    } else if (arg.startsWith('--calls=')) {
      const value = Number(arg.slice('--calls='.length));
      if (Number.isFinite(value) && value > 0) options.calls = Math.floor(value);
    }
  }

  return { scenario, options };
}

function buildConfig(): DriverConfig {
  return {
    authBaseUrl: env('CLIENT_AUTH_BASE_URL', 'http://127.0.0.1:4010'),
    resourceBaseUrl: env('CLIENT_RESOURCE_BASE_URL', 'http://127.0.0.1:4020'),
    participantHeaderName: env('PARTICIPANT_HEADER_NAME', 'X-Participant-Token'),
    participantTokenValue: env('PARTICIPANT_TOKEN_VALUE', 'demo-participant-token'),
    tokenEndpoint: env('AUTH_TOKEN_ENDPOINT', '/oauth/token'),
  };
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function makeHeaders(config: DriverConfig, includeParticipant: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (includeParticipant) {
    headers[config.participantHeaderName] = config.participantTokenValue;
  }
  return headers;
}

async function requestToken(
  config: DriverConfig,
  input: {
    includeParticipant: boolean;
    mode?: 'success' | 'error' | 'malformed';
    grantType?: 'client_credentials' | 'refresh_token';
    refreshToken?: string;
  },
) {
  const response = await fetch(buildUrl(config.authBaseUrl, config.tokenEndpoint), {
    method: 'POST',
    headers: makeHeaders(config, input.includeParticipant),
    body: JSON.stringify({
      grant_type: input.grantType ?? 'client_credentials',
      scope: 'patient/*.read',
      refresh_token: input.refreshToken,
      simulate_token_mode: input.mode ?? 'success',
    }),
  });

  const body = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    json = null;
  }

  const accessToken = typeof json?.access_token === 'string' ? json.access_token : null;
  const refreshToken = typeof json?.refresh_token === 'string' ? json.refresh_token : null;
  return { response, body, json, accessToken, refreshToken };
}

async function callResource(
  config: DriverConfig,
  input: {
    token: string;
    includeParticipant: boolean;
    skipValidation?: boolean;
    validationMode?: 'auto' | 'active' | 'inactive' | 'error' | 'malformed';
  },
) {
  const url = new URL('/resource/patient', config.resourceBaseUrl.endsWith('/') ? config.resourceBaseUrl : `${config.resourceBaseUrl}/`);
  if (input.skipValidation) url.searchParams.set('skipValidation', 'true');
  if (input.validationMode) url.searchParams.set('validationMode', input.validationMode);

  const headers = makeHeaders(config, input.includeParticipant);
  headers.authorization = `Bearer ${input.token}`;

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  const body = await response.text();
  return { response, body };
}

function logResponse(label: string, status: number, body: string) {
  console.log(`\n[${label}] status=${status}`);
  console.log(body);
}

async function run() {
  const config = buildConfig();
  const { scenario, options } = parseArgs(process.argv.slice(2));

  console.log(`scenario=${scenario}`);
  console.log(`auth_base=${config.authBaseUrl}`);
  console.log(`resource_base=${config.resourceBaseUrl}`);
  console.log(`participant_header=${config.participantHeaderName}`);

  if (scenario === 'failed-token-issue') {
    const token = await requestToken(config, {
      includeParticipant: true,
      mode: options.tokenMode,
    });
    logResponse('token', token.response.status, token.body);
    process.exit(token.response.ok && token.accessToken ? 1 : 0);
  }

  const omitTokenParticipant = scenario === 'missing-participant-token'
    && (options.omitOn === 'token' || options.omitOn === 'both');
  const omitResourceParticipant = scenario === 'missing-participant-token'
    && (options.omitOn === 'resource' || options.omitOn === 'both');

  const token = await requestToken(config, {
    includeParticipant: !omitTokenParticipant,
  });
  logResponse('token', token.response.status, token.body);

  if (!token.accessToken) {
    process.exit(1);
  }

  if (scenario === 'refresh-token') {
    if (!token.refreshToken) process.exit(1);

    const refreshed = await requestToken(config, {
      includeParticipant: true,
      grantType: 'refresh_token',
      refreshToken: token.refreshToken,
    });
    logResponse('refresh', refreshed.response.status, refreshed.body);

    if (!refreshed.accessToken) {
      process.exit(1);
    }

    const resource = await callResource(config, {
      token: refreshed.accessToken,
      includeParticipant: true,
    });
    logResponse('resource', resource.response.status, resource.body);
    process.exit(resource.response.ok ? 0 : 1);
  }

  if (scenario === 'token-only') {
    process.exit(0);
  }

  if (scenario === 'multiple-resource-calls') {
    for (let index = 0; index < options.calls; index += 1) {
      const resource = await callResource(config, {
        token: token.accessToken,
        includeParticipant: true,
      });
      logResponse(`resource-${index + 1}`, resource.response.status, resource.body);
      if (!resource.response.ok) process.exit(1);
    }
    process.exit(0);
  }

  const resource = await callResource(config, {
    token: token.accessToken,
    includeParticipant: !omitResourceParticipant,
    skipValidation: scenario === 'missing-validation',
    validationMode: scenario === 'failed-validation' ? 'inactive' : 'auto',
  });
  logResponse('resource', resource.response.status, resource.body);

  const expectedSuccess = scenario === 'happy-path'
    || scenario === 'missing-participant-token'
    || scenario === 'missing-validation';

  process.exit(expectedSuccess ? (resource.response.ok ? 0 : 1) : (resource.response.ok ? 1 : 0));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
