# Prism

HTTP reverse proxy for IHE Connectathon Taiwan. Intercepts, records, and visualises traffic between test clients and backend FHIR servers in real time.

## Features

- **Per-server proxy ports** — each backend server gets its own port (default range 7001–7100)
- **Full request/response capture** — headers, bodies, timing; configurable storage limit per server
- **Anti-cheat token** — participants include a system-issued rotating token in every request so traffic is attributed to their account
- **Real-time dashboard** — WebSocket push for live traffic and aggregate stats
- **Role-based access** — admin, monitor, and user roles backed by the existing Gazelle user database
- **Import/export** — servers can be exported to JSON or CSV and re-imported with automatic port conflict resolution

## Architecture

```
Browser ──HTTPS──▶ Nginx ──HTTP──▶ Fastify :3000
                                       │
                              ┌────────┴────────┐
                              │  REST API /api  │
                              │  Static SPA     │
                              │  WS /ws         │
                              └────────┬────────┘
                                       │
                            ProxyManager (Node HTTP)
                                  ┌────┴────┐
                              :7001     :7002  …
                                  │         │
                            FHIR Server A   FHIR Server B
```

```
Auth source:  Gazelle PostgreSQL 9.6 (read-only, MD5 passwords)
Storage:      Prism PostgreSQL (read/write)
```

## Quick start (Docker)

```bash
# 1. Copy and fill in credentials
cp .env.example .env
$EDITOR .env

# 2. Build and start
docker compose up -d --build

# 3. Open the UI
open http://localhost:3000
```

The database schema is applied automatically on startup via `prisma db push`.

## Development

```bash
# Install dependencies (backend + frontend)
npm install
cd client && npm install && cd ..

# Start the backend (hot-reload)
npm run dev

# Start the frontend dev server (proxies /api and /ws to :3000)
npm run dev:client

# Run all tests
npm test

# Production build (backend TS + frontend Vite)
npm run build
```

## Environment variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `PROXY_DB_HOST` | `postgres-prism` | | Prism DB hostname |
| `PROXY_DB_PORT` | `5432` | | Prism DB port |
| `PROXY_DB_NAME` | `prism` | | Prism DB name |
| `PROXY_DB_USER` | `prism` | | Prism DB user |
| `PROXY_DB_PASS` | — | ✓ | Prism DB password |
| `GAZELLE_DB_HOST` | — | ✓ | Gazelle DB hostname |
| `GAZELLE_DB_PORT` | `5432` | | Gazelle DB port |
| `GAZELLE_DB_NAME` | `gazelle` | | Gazelle DB name |
| `GAZELLE_DB_USER` | — | ✓ | Gazelle DB user |
| `GAZELLE_DB_PASS` | — | ✓ | Gazelle DB password |
| `GAZELLE_DB_SSL` | `false` | | Set `true` to require SSL for Gazelle |
| `APP_PORT` | `3000` | | HTTP port the app listens on |
| `NODE_ENV` | `development` | | `production` disables debug logging |
| `PROXY_PORT_START` | `7001` | | First port in proxy range |
| `PROXY_PORT_END` | `7100` | | Last port in proxy range |
| `JWT_SECRET` | — | ✓ | ≥ 32 chars; signs access tokens |
| `JWT_EXPIRES_IN` | `8h` | | Access token lifetime |
| `JWT_REFRESH_SECRET` | — | ✓ | ≥ 32 chars; signs refresh tokens |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | | Refresh token lifetime |

Generate secrets:
```bash
openssl rand -hex 64   # run twice — one for JWT_SECRET, one for JWT_REFRESH_SECRET
```

## Nginx (HTTPS / WSS)

Copy `nginx/prism.conf` to `/etc/nginx/conf.d/`, update `server_name` and the SSL certificate paths, then reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The WebSocket endpoint (`/ws`) requires Nginx to pass the `Upgrade` header — this is already handled in the provided config.

Proxy ports (7001–7100) carry plain HTTP and must be exposed directly from the server; they bypass Nginx.

## System settings

Admins can configure the following keys at runtime via **Admin → Settings**:

| Key | Default | Description |
|---|---|---|
| `participant_token_header` | `X-Participant-Token` | Header participants must include in every proxied request |
| `participant_token_ttl_minutes` | `5` | How often participant tokens rotate |
| `default_body_size_limit_kb` | (unlimited) | Body storage limit applied to newly created servers |
| `proxy_request_timeout_ms` | `30000` | Max time (ms) to wait for a response from the target |
| `dashboard_requests_window_minutes` | `5` | Time window for the Requests and Error Rate stat cards |
| `dashboard_chart_hours` | `24` | Hours of history shown in the traffic chart (≤ 4 h uses 10-minute buckets) |
| `connectathon_name` | — | Event name displayed in the UI header |

## API reference

All endpoints are prefixed `/api`. Authenticated endpoints require `Authorization: Bearer <token>`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | — | Login; returns `access_token` + `refresh_token` |
| `POST` | `/auth/refresh` | — | Rotate refresh token |
| `POST` | `/auth/logout` | ✓ | Revoke refresh token |

### Participant token

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/token` | any | Get current token and expiry |
| `POST` | `/token/regen` | any | Regenerate token immediately |

### Connections

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/connections` | any | Paginated list. Users see own; admin/monitor see all. Query: `page`, `limit`, `server_id`, `method`, `status`, `user_id`*, `from`*, `to`* |
| `GET` | `/connections/:id` | any | Full detail with headers and bodies. Users see own; admin/monitor see any. |

*admin/monitor only

### Servers (admin only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/servers` | List all servers with running status |
| `POST` | `/admin/servers` | Create server; auto-assigns a proxy port and starts listener |
| `GET` | `/admin/servers/:id` | Get server |
| `PUT` | `/admin/servers/:id` | Update server; restarts listener if needed |
| `DELETE` | `/admin/servers/:id` | Delete server and stop listener |
| `POST` | `/admin/servers/:id/start` | Start proxy listener |
| `POST` | `/admin/servers/:id/stop` | Stop proxy listener |
| `POST` | `/admin/servers/:id/restart` | Restart proxy listener |
| `GET` | `/admin/servers/export` | Export all servers as JSON |
| `GET` | `/admin/servers/export/csv` | Export all servers as CSV |
| `POST` | `/admin/servers/import` | Import servers from JSON export |

### Dashboard (admin/monitor only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/dashboard/stats` | Live counts: total requests, requests in window, error rate, active servers |
| `GET` | `/dashboard/chart` | Request counts bucketed by time for the configured window |
| `GET` | `/dashboard/servers` | Server list for filter dropdowns |

### Settings (admin only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/settings` | List all settings |
| `PUT` | `/admin/settings/:key` | Upsert a setting |
| `DELETE` | `/admin/settings/:key` | Delete a setting |

## WebSocket

Connect to `wss://your-host/ws?token=<access_token>`.

After the server sends `{"type":"auth:ok"}`, subscribe to channels:

```json
{ "type": "subscribe", "channel": "traffic:all" }
```

| Channel | Access | Events |
|---|---|---|
| `dashboard` | admin, monitor | `dashboard:stats` (every 5 s) |
| `traffic:all` | admin, monitor | `connection:new`, `connection:completed`, `connection:error` |
| `traffic:user:{id}` | owner, admin, monitor | Same events filtered by user |
| `server:{uuid}` | admin, monitor | Same events filtered by server + `server:health` (every 30 s) |

Other messages: `{"type":"ping"}` → `{"type":"pong"}`, `{"type":"unsubscribe","channel":"..."}`.

## Roles

| Role | Source | Capabilities |
|---|---|---|
| `admin` | `role_id = 1` in Gazelle | Full access |
| `monitor` | `role_id = 2` in Gazelle | View all traffic; no server management |
| `user` | all others | Own connections and token only |

## Proxy identity

Requests arriving on proxy ports are identified in this order:

1. `Authorization: Bearer <JWT>` — maps to the JWT subject
2. Configured participant token header (default `X-Participant-Token`) — matched against active `ParticipantToken` records
3. Anonymous — recorded with `user_id = null`
