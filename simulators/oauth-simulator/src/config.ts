type RequiredString = string;

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }
  return parsed;
}

export type SimulatorConfig = {
  auth: {
    host: RequiredString;
    port: number;
    tokenEndpoint: string;
    validateEndpoint: string;
    validationSuccessPath: string;
    validationSuccessValue: string;
  };
  resource: {
    host: RequiredString;
    port: number;
    authValidateBaseUrl: string;
  };
  participantHeaderName: string;
};

export function loadConfig(): SimulatorConfig {
  return {
    auth: {
      host: env('AUTH_HOST', '0.0.0.0'),
      port: envNumber('AUTH_PORT', 4010),
      tokenEndpoint: env('AUTH_TOKEN_ENDPOINT', '/oauth/token'),
      validateEndpoint: env('AUTH_VALIDATE_ENDPOINT', '/oauth/validate'),
      validationSuccessPath: env('VALIDATION_SUCCESS_PATH', 'active'),
      validationSuccessValue: env('VALIDATION_SUCCESS_VALUE', 'true'),
    },
    resource: {
      host: env('RESOURCE_HOST', '0.0.0.0'),
      port: envNumber('RESOURCE_PORT', 4020),
      authValidateBaseUrl: env('AUTH_VALIDATE_BASE_URL', 'http://127.0.0.1:4010'),
    },
    participantHeaderName: env('PARTICIPANT_HEADER_NAME', 'X-Participant-Token'),
  };
}
