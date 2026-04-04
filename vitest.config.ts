import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      GAZELLE_DB_HOST: 'localhost',
      GAZELLE_DB_PORT: '5432',
      GAZELLE_DB_NAME: 'gazelle',
      GAZELLE_DB_USER: 'test',
      GAZELLE_DB_PASS: 'test',
      PROXY_DB_PASS: 'test',
      JWT_SECRET: 'test_jwt_secret_at_least_32_characters_long',
      JWT_REFRESH_SECRET: 'test_jwt_refresh_secret_at_least_32_chars',
    },
  },
});
