import { z } from 'zod';

const envSchema = z.object({
  // Gazelle DB (read-only)
  GAZELLE_DB_HOST: z.string().min(1, 'GAZELLE_DB_HOST is required'),
  GAZELLE_DB_PORT: z.string().default('5432'),
  GAZELLE_DB_NAME: z.string().default('gazelle'),
  GAZELLE_DB_USER: z.string().min(1, 'GAZELLE_DB_USER is required'),
  GAZELLE_DB_PASS: z.string().min(1, 'GAZELLE_DB_PASS is required'),
  GAZELLE_DB_SSL: z.enum(['true', 'false']).default('false'),
  // Prism DB
  PROXY_DB_HOST: z.string().default('postgres-prism'),
  PROXY_DB_PORT: z.string().default('5432'),
  PROXY_DB_NAME: z.string().default('prism'),
  PROXY_DB_USER: z.string().default('prism'),
  PROXY_DB_PASS: z.string().min(1, 'PROXY_DB_PASS is required'),
  // App
  APP_PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Proxy port range
  PROXY_PORT_START: z.string().default('7001'),
  PROXY_PORT_END: z.string().default('7100'),
  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const [field, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${field}: ${errors?.join(', ')}`);
  }
  process.exit(1);
}

const env = parsed.data;

function buildPostgresUrl(user: string, pass: string, host: string, port: string, name: string, ssl: boolean): string {
  const sslParam = ssl ? '?sslmode=require' : '';
  return `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${name}${sslParam}`;
}

export const config = {
  gazelle: {
    url: buildPostgresUrl(
      env.GAZELLE_DB_USER,
      env.GAZELLE_DB_PASS,
      env.GAZELLE_DB_HOST,
      env.GAZELLE_DB_PORT,
      env.GAZELLE_DB_NAME,
      env.GAZELLE_DB_SSL === 'true',
    ),
  },
  db: {
    url: buildPostgresUrl(
      env.PROXY_DB_USER,
      env.PROXY_DB_PASS,
      env.PROXY_DB_HOST,
      env.PROXY_DB_PORT,
      env.PROXY_DB_NAME,
      false,
    ),
  },
  app: {
    port: parseInt(env.APP_PORT, 10),
    env: env.NODE_ENV,
  },
  proxy: {
    portStart: parseInt(env.PROXY_PORT_START, 10),
    portEnd: parseInt(env.PROXY_PORT_END, 10),
  },
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },
} as const;

// Set database URLs for Prisma — must happen before Prisma clients are instantiated
process.env.PRISM_DATABASE_URL = config.db.url;
process.env.GAZELLE_DATABASE_URL = config.gazelle.url;
