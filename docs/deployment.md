# Deployment

## Local Stack

```bash
cp .env.example .env
docker compose up -d --build
```

Prism serves the web app on port `3000`. Proxy listeners use the configured proxy-port range and must be reachable by test clients directly.

## Post-Deploy Verification Checklist

After the stack starts, verify the system in this order:

1. Open the Prism web app and confirm the login page loads
2. Confirm PostgreSQL is healthy and no container is restarting
3. Confirm Prisma schema changes have been applied
4. Log in and verify `Integration Guide` loads
5. Open `Servers` and confirm at least one configured server shows expected backend/proxy state
6. Run `Test target` on a configured server
7. If heartbeat is enabled, run `Run heartbeat now`
8. Open `Global Traffic` and confirm:
   - raw traffic is loading
   - OAuth mode is loading
   - system heartbeat traffic is hidden by default

Recommended quick checks:

```bash
docker compose ps
docker compose logs postgres-prism --tail=100
docker compose logs prism-app --tail=100
```

If the app starts but data-dependent pages fail, the most common causes are:

- PostgreSQL still recovering
- Prisma schema not yet pushed or migrated
- server-role / endpoint configuration incomplete for OAuth features

## Environment

Core variables:

- `PROXY_DB_HOST`, `PROXY_DB_PORT`, `PROXY_DB_NAME`, `PROXY_DB_USER`, `PROXY_DB_PASS`
- `GAZELLE_DB_HOST`, `GAZELLE_DB_PORT`, `GAZELLE_DB_NAME`, `GAZELLE_DB_USER`, `GAZELLE_DB_PASS`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PARTICIPANT_TOKEN_SECRET`
- `APP_PORT`
- `PROXY_PORT_START`, `PROXY_PORT_END`

Keep JWT and participant token secrets long, random, and distinct. Treat Gazelle as read-only.

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

If the UI or API references newly added fields and the database was not updated, runtime failures are expected.

## Reverse Proxy

`nginx/` contains the public reverse-proxy config for HTTPS and WSS termination. The dedicated backend proxy ports are separate from the web entrypoint and should not be hidden behind the main app port.

## Operational Notes

- If PostgreSQL enters recovery mode, Prisma requests will fail until the database is healthy again.
- OAuth features depend on both correct server-role configuration and current database schema.
- Admin-only actions such as clearing traffic should be restricted to trusted operators.
- Heartbeat checks call the final user-facing URL, not just the upstream `target_url`. This is important when an external SSL or engine proxy sits in front of Prism-managed traffic.
- Server config now separates:
  - backend target URL
  - user access URL
  - heartbeat path
- Authentication servers default their heartbeat path to `/health`.
- Other servers default their heartbeat path to `/`.
- A passing proxy heartbeat should be interpreted as an implicit backend pass.
- If proxy heartbeat fails, Prism can still probe the backend directly to distinguish upstream failure from proxy-path failure.
