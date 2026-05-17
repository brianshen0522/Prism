# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Prism — Claude Code Guide

## Project Overview

Prism is an HTTP reverse proxy for **IHE Connectathon Taiwan**. It intercepts traffic between participant test clients and backend FHIR servers, records every request/response pair, and provides a real-time dashboard for admins/monitors.

Anti-cheat: participants must include a system-issued rotating token in every request (via a configurable header, default `X-Participant-Token`). Only token-bearing traffic is attributed to their account.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 20 (Alpine) |
| Backend framework | Fastify 4 |
| Language | TypeScript 5 (strict, CommonJS) |
| ORM | Prisma 5 |
| Auth | JWT (jsonwebtoken) |
| Real-time | WebSocket (ws) |
| Validation | Zod |
| Tests | Vitest |
| Frontend framework | React 18 + Vite 6 |
| UI | Tailwind CSS 3 (dark mode via `media`) |
| State | Zustand + TanStack React Query |
| Database (Prism) | PostgreSQL 16 (Docker-managed) |
| Database (Gazelle) | PostgreSQL 9.6 (external, read-only) |

---

## Repository Layout

```
src/                        Backend source
  app.ts                    Fastify instance + route registration
  index.ts                  Entry point (starts server, proxy manager, WS stats)
  config.ts                 Zod-validated env config; builds DB URLs
  db/
    prism.ts                Prisma client for Prism DB
    gazelle.ts              Prisma client for Gazelle DB (read-only)
  routes/
    auth.ts                 Login / refresh / logout (reads Gazelle for users)
    servers.ts              Admin CRUD for BackendServer + import/export
    connections.ts          Connection history queries
    token.ts                Participant token get/regen
    dashboard.ts            Stats & chart (admin/monitor only)
    settings.ts             SystemSetting CRUD (admin only)
    oauth.ts                OAuth pipeline list/detail (filtered by role)
    integration-guide.ts    Per-user guide with curl snippets for each server
    public.ts               Unauthenticated share-token routes (connection + pipeline views)
  oauth/
    reconcile.ts            Build OAuthPipeline records from raw Connection rows
    extract.ts              Extract token hashes/previews from proxied request bodies
  servers/
    health.ts               Server heartbeat + direct backend probe (runs every 5 s)
  plugins/
    authenticate.ts         JWT Bearer verification middleware
    authorize.ts            Role-based access middleware
  proxy/
    manager.ts              HTTP listener lifecycle per server (ports 7001–7100)
    pipeline.ts             Full request/response interception + DB storage
  ws/
    setup.ts                WebSocket server attach
    manager.ts              Channel subscriptions + emit helpers
    channels.ts             Channel name constants + authorization helpers
    stats.ts                Background stats emit (every 5 s / 30 s)
  lib/
    jwt.ts                  sign / verify helpers
    password.ts             MD5 (Gazelle compatibility)
    tokens.ts               Refresh token CRUD (SHA-256 hashed before storage; rotate-on-use)
    settings.ts             SystemSetting read helpers (cached)
    share.ts                Share-token generation and lookup for connections + pipelines

client/src/                 React frontend
  App.tsx                   Router (React Router v6)
  pages/                    One file per page/route
  components/               Layout, NavBar, ProtectedRoute, ui/
  store/                    Zustand stores: auth (tokens + user) and theme (dark mode toggle)
  lib/
    api.ts                  Typed fetch wrapper (auto-refresh JWT)
    ws.ts                   WebSocket hook
    utils.ts                cn, fmtDate, fmtDuration, fmtBytes, copyToClipboard

prisma/schema.prisma        Prism DB schema
prisma-gazelle/schema.prisma  Gazelle DB schema (read-only)
compose.yml                 prism-app + postgres-prism
Dockerfile                  Multi-stage build (builder → runtime)
entrypoint.sh               prisma db push → node dist/index.js
nginx/prism.conf            Nginx TLS termination config (proxy ports bypass nginx)
simulators/                 oauth-simulator and oauth-stress test tools
docs/                       Supplementary architecture, deployment, and feature guides
```

---

## Commands

### Development
```bash
# Backend (hot-reload)
npm run dev

# Frontend (Vite dev server, proxies /api & /ws to :3000)
npm run dev:client

# Run all tests
npm test
npm run test:watch

# Run a single test file
npx vitest run src/routes/auth.test.ts
```

### Build & Deploy
```bash
# Full build (TypeScript + Vite)
npm run build

# Docker (rebuild + restart)
docker compose build prism-app
docker compose up -d prism-app

# Common one-liner used throughout this project
docker compose build prism-app 2>&1 | tail -8 && docker compose up -d prism-app 2>&1 | tail -4
```

### Database
```bash
# Regenerate both Prisma clients after schema change (run on host)
PRISM_DATABASE_URL="postgresql://prism:changeme@localhost:5432/prism" npm run db:generate

# Or regenerate only the Prism client
PRISM_DATABASE_URL="postgresql://prism:changeme@localhost:5432/prism" \
  npx prisma generate --schema=prisma/schema.prisma

# Apply schema changes directly to DB (in container)
docker compose exec postgres-prism psql -U prism -d prism -c "ALTER TABLE ..."

# Prisma db push inside container (non-interactive, needs PRISM_DATABASE_URL)
docker compose exec prism-app sh -c \
  'PRISM_DATABASE_URL="postgresql://prism:changeme@postgres-prism:5432/prism" npx prisma db push'
```

---

## Environment Variables (`.env`)

```bash
# Prism DB (Docker service, hostname = postgres-prism inside Compose network)
PROXY_DB_HOST=postgres-prism
PROXY_DB_PORT=5432
PROXY_DB_NAME=prism
PROXY_DB_USER=prism
PROXY_DB_PASS=changeme          # Required

# Gazelle DB (external, read-only, IHE server)
GAZELLE_DB_HOST=162.38.2.12
GAZELLE_DB_PORT=5432
GAZELLE_DB_NAME=gazelle
GAZELLE_DB_USER=gazelle
GAZELLE_DB_PASS=gazelle
GAZELLE_DB_SSL=false

# App
APP_PORT=3000
NODE_ENV=production

# Proxy port range (one port per BackendServer)
PROXY_PORT_START=7001
PROXY_PORT_END=7100

# JWT (generate with: openssl rand -hex 64)
JWT_SECRET=replace_with_long_random_string_at_least_32_chars
JWT_EXPIRES_IN=8h
JWT_REFRESH_SECRET=replace_with_different_long_random_string_at_least_32_chars
JWT_REFRESH_EXPIRES_IN=7d
```

`config.ts` validates all required vars at startup and constructs `PRISM_DATABASE_URL` + `GAZELLE_DATABASE_URL` for Prisma.

---

## Database Schema (Prism)

| Model | Key fields | Notes |
|---|---|---|
| `BackendServer` | id, name, targetUrl, proxyPort (unique), isActive, bodySizeLimitKb, serverRole | One HTTP listener per server; role is `generic`, `authentication`, or `resource` |
| `Connection` | userId, serverId, req*/res* fields, status, connectionKind, oauthCallerType | Full request+response log; kind is `generic`, `oauth_token_issue`, `resource_access`, or `oauth_validation` |
| `OAuthPipeline` | accessTokenHash (unique), participantUserId, authenticationServerId, legal, success | Groups a token issuance + all its resource calls under one access token |
| `OAuthPipelineResourceCall` | pipelineId, resourceConnectionId, validationConnectionId | Joins a resource call and its introspection/validation call to a pipeline |
| `RefreshToken` | userId, token (unique), expiresAt | Refresh token store; `token` column holds SHA-256 hash |
| `ParticipantToken` | userId (unique), token (unique), expiresAt | Anti-cheat token; one per user |
| `SystemSetting` | key (PK), value, updatedBy | Admin-configurable settings |

### BackendServer OAuth fields

| Field | Purpose |
|---|---|
| `serverRole` | `authentication` servers issue tokens; `resource` servers consume them |
| `oauthAuthServerId` | Points a resource server at its paired authentication server |
| `oauthTokenEndpoint` | Path on the auth server where clients POST for a token |
| `oauthValidationEndpoint` | Path on the auth server used for token introspection |
| `heartbeatEnabled` | Enables periodic proxy heartbeat checks via `servers/health.ts` |
| `heartbeatUrl` / `heartbeatPath` | URL or path used for heartbeat probes |
| `heartbeatIntervalSeconds` | How often to probe (default 60 s) |

### Important System Settings

| Key | Default | Purpose |
|---|---|---|
| `participant_token_header` | `X-Participant-Token` | Header participants must include |
| `participant_token_ttl_minutes` | `5` | Token rotation interval |
| `default_body_size_limit_kb` | (unlimited) | Applied to new servers |
| `proxy_request_timeout_ms` | `30000` | Proxy target timeout |
| `dashboard_requests_window_minutes` | `5` | Time window for dashboard Requests/Error Rate stat cards |
| `dashboard_chart_hours` | `24` | Hours of history shown in the dashboard traffic chart |

---

## Migration Approach

**No migration files are used.** The entrypoint runs `prisma db push` on every startup to sync the schema. For manual column additions during development:

```bash
# Add columns directly (when container has an old baked-in schema)
docker compose exec postgres-prism psql -U prism -d prism -c \
  "ALTER TABLE connections ADD COLUMN IF NOT EXISTS my_col INTEGER;"

# Then regenerate the local Prisma client
PRISM_DATABASE_URL="postgresql://prism:changeme@localhost:5432/prism" \
  npx prisma generate --schema=prisma/schema.prisma
```

**The `.dockerignore` excludes `node_modules/`** so Docker always regenerates the Prisma client during build from the current schema.

---

## Authentication Flow

### User authentication (API)
1. Login hits Gazelle DB → verifies MD5 password → maps `role_id` to `admin/monitor/user`
2. Returns short-lived access JWT + long-lived refresh JWT
3. Frontend (`api.ts`) auto-refreshes on 401

### Request identity in the proxy pipeline
Priority order in `pipeline.ts → identifyUser()`:
1. `Authorization: Bearer <jwt>` → identifies as logged-in user
2. Configured participant token header (e.g. `X-Participant-Token`) → looks up `ParticipantToken` where `expiresAt > now()`
3. Anonymous → `userId = null`

Header name is **cached in memory for 60 s** to avoid a DB hit on every proxied request.

---

## Roles & Access

| Role | Dashboard | Global Traffic | Servers (admin) | Settings (admin) | OAuth pipelines | My Token |
|---|---|---|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ | ✓ | all | ✓ |
| `monitor` | ✓ | ✓ | — | — | all | ✓ |
| `oauth2` | — | — | — | — | all | ✓ |
| `user` | — | own traffic only | — | — | own only | ✓ |

Role comes from Gazelle `role_id`: 1 = admin, 2 = monitor, other = user. `oauth2` is a special role that can view all OAuth pipelines but has no other elevated access.

After login, `admin`/`monitor`/`oauth2` roles are redirected to `/dashboard`; `user` role is redirected to `/guide`.

---

## WebSocket Channels

| Channel | Who can subscribe | Events |
|---|---|---|
| `dashboard` | admin, monitor | stats updates |
| `traffic:all` | admin, monitor | all connection events |
| `traffic:user:{id}` | owner, admin, monitor | per-user events |
| `server:{uuid}` | admin, monitor | server health + events |

---

## Server Health & Heartbeat

`servers/health.ts` runs a background ticker every 5 s. For each active server with `heartbeatEnabled = true`, it:
1. Sends an HTTP request through the **proxy port** with a unique `x-prism-heartbeat-id` header.
2. Waits 300 ms, then queries the `Connection` table to confirm the proxy captured the request.
3. If captured and status matches `heartbeatExpectedStatus` → lamp `green`; mismatch → `amber`; not captured → `red`.
4. When the proxy heartbeat fails it falls back to a **direct backend probe** that bypasses the proxy.

Results are stored in memory maps (`backendResults`, `heartbeatResults`) with the last 24 probe results kept as history. `getServerHealth(serverId)` returns both lamps and their histories.

---

## OAuth Pipeline Reconciliation

`oauth/reconcile.ts` builds `OAuthPipeline` and `OAuthPipelineResourceCall` records by correlating raw `Connection` rows using hashed token values:

- `oauth/extract.ts` extracts access/refresh token hashes from request/response bodies during the proxy pipeline.
- An `OAuthPipeline` groups one token-issuance `Connection` with all resource calls that present the same access token.
- `legal = true` when the participant token was present on token issuance; `success = true` when at least one resource call and its validation both succeeded.

---

## Coding Style

- Semicolons, single quotes, trailing commas, 2-space indentation in both TS and TSX.
- `PascalCase` for React components and page files; `camelCase` for functions and variables.
- No ESLint or Prettier configured — keep changes consistent with nearby files; rely on `tsc` and tests.
- Backend tests live beside the module they cover (e.g., `src/routes/auth.test.ts`).

---

## Key Architectural Notes

- **One HTTP listener per BackendServer** on a dedicated port (7001–7100). ProxyManager starts/stops them.
- **Body storage limit** per server (`bodySizeLimitKb`). Binary content types are stored as placeholder strings, not raw bytes.
- **Response body decompressed** before storage (gzip/deflate/br), but original compressed bytes are sent back to the client.
- **`navigator.clipboard`** is unavailable on plain HTTP. Use `copyToClipboard()` from `utils.ts` everywhere — it falls back to `execCommand`.
- **Server page lock** persists in `localStorage` as `'0'` (unlocked) or absent/anything-else (locked). Default is **locked**.
- **Export buttons** must use `fetch` with `Authorization` header, not `window.location.href` (which doesn't send auth headers).
- **POST with no body**: `apiFetch` only sets `Content-Type: application/json` when `init.body != null`. Don't pass a body for bodyless POSTs.
- **Dark mode**: Tailwind `darkMode: 'media'` — follows OS `prefers-color-scheme`. All components must include `dark:` variants.
