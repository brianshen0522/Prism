# Deployment

## Local Stack

```bash
cp .env.example .env
docker compose up -d --build
```

Prism serves the web app on port `3000`. Proxy listeners use the configured proxy-port range and must be reachable by test clients directly.

## Environment

Core variables:

- `PROXY_DB_HOST`, `PROXY_DB_PORT`, `PROXY_DB_NAME`, `PROXY_DB_USER`, `PROXY_DB_PASS`
- `GAZELLE_DB_HOST`, `GAZELLE_DB_PORT`, `GAZELLE_DB_NAME`, `GAZELLE_DB_USER`, `GAZELLE_DB_PASS`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `APP_PORT`
- `PROXY_PORT_START`, `PROXY_PORT_END`

Keep JWT secrets long and random. Treat Gazelle as read-only.

## Database Updates

After schema changes, run one of:

```bash
npm run db:push
```

or

```bash
npm run db:migrate:deploy
```

Then regenerate clients if needed:

```bash
npm run db:generate
```

## Reverse Proxy

`nginx/` contains the public reverse-proxy config for HTTPS and WSS termination. The dedicated backend proxy ports are separate from the web entrypoint and should not be hidden behind the main app port.

## Operational Notes

- If PostgreSQL enters recovery mode, Prisma requests will fail until the database is healthy again.
- OAuth features depend on both correct server-role configuration and current database schema.
- Admin-only actions such as clearing traffic should be restricted to trusted operators.
