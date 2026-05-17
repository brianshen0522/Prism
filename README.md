# Prism

Prism is a reverse-proxy observability platform for integration testing environments. It sits between participants and backend systems, captures HTTP traffic in real time, and turns those exchanges into raw traffic views, OAuth pipeline views, health status, and user-facing integration guidance.

It is built for teams that need to answer questions like:

- Which request reached which server?
- Did the request include the required participant token?
- Did an OAuth flow complete, validate correctly, and remain legal?
- Is the backend healthy, or is the proxy path failing?
- What URL and headers should a participant use for a given server?

## What Problem It Solves

In connectathon-style environments, teams often have multiple backend services, authentication servers, and resource servers running behind different proxies. When something fails, the hard part is not only capturing traffic. It is understanding:

- what the participant actually called
- what the proxy forwarded
- what the backend returned
- how related OAuth calls belong to one flow
- how to explain the correct usage back to participants

Prism solves this by combining traffic capture, OAuth correlation, server health checks, and generated integration guidance in one system.

## Architecture

```text
Participant / Client
        |
        |  user-facing URL
        v
+---------------------------+
| Prism Proxy Listener      |
| one proxy port per server |
+---------------------------+
        |
        | forwards request
        v
+---------------------------+        +----------------------+
| Backend Server            |        | Authentication Server|
| generic or resource role  |<------>| token / validation   |
+---------------------------+        +----------------------+

               Prism Application Layer
┌─────────────────────────────────────────────────────────────┐
│ Fastify API                                                 │
│ React frontend                                              │
│ WebSocket live updates                                      │
│ OAuth extraction + reconcile                                │
│ Server health and heartbeat workers                         │
│ Integration Guide generation                                │
└─────────────────────────────────────────────────────────────┘
                            |
                            v
                    PostgreSQL + Prisma
```

## Core Workflows

### 1. Raw Traffic Capture

```text
Client -> Prism proxy -> target backend
                 |
                 +-> store request metadata
                 +-> store response metadata
                 +-> emit live updates
                 +-> make traffic searchable in UI
```

This workflow powers the Dashboard, Global Traffic, and connection inspect views.

### 2. OAuth Pipeline Correlation

```text
1. Client -> Authentication Server      (token issue)
2. Client -> Resource Server            (resource access)
3. Resource Server -> Authentication    (token validation)

Prism groups these calls by token context
and computes:
- complete / incomplete
- legal / illegal
- success / failed
- refresh-token lineage
```

This workflow powers the OAuth Pipelines mode in traffic pages and OAuth detail flow maps.

### 3. Server Health and Proxy Heartbeat

```text
Target Test:
Prism -> backend target URL

Heartbeat:
Prism -> user-facing URL through proxy path
      -> compare expected status
      -> verify proxy path is working
```

This workflow powers backend status, proxy status, and heartbeat timelines in `Servers`.

### 4. Generated Integration Guidance

```text
Server configuration
    + user access URL
    + OAuth links
    + participant token settings
            |
            v
Prism generates:
- service catalog
- per-service detail guide
- OAuth walkthrough with https-correct curl examples
```

This workflow powers `Integration Guide` and participant onboarding after login.

## Main Screens

| Screen | Who can use it | Description |
|---|---|---|
| `Integration Guide` | all roles | Catalog of active servers with a detail page per server showing the full OAuth walkthrough or direct-access curl steps |
| `Dashboard` | admin, monitor | Recent connections, recent OAuth pipelines, summary metrics, and a traffic chart |
| `Global Traffic` | admin, monitor | Raw traffic and OAuth pipeline views across all servers; supports filtering by server, institution, user, method, status code, and text |
| `My Traffic` | user, oauth2 | The same raw + OAuth views scoped to the logged-in user's institution; user filter is also available |
| `Servers` | admin, monitor | Server configuration, target testing, heartbeat testing, connection timelines, and per-server status lights |
| `Settings` | admin | System-wide settings: participant token header name, token TTL, body size limits, timeouts, and dashboard windows |
| `Participant Token` | all roles | Current JWT token, renewal, validation APIs, and curl examples pre-filled with the current origin |
| `Users` | admin | Overview of active Gazelle users grouped by institution |
| `OAuth Pipelines` | admin, monitor, oauth2 | Cross-institution OAuth pipeline view with full legal / success / refresh-chain detail |

## Traffic Filters

The raw traffic and OAuth pipeline views expose filters that adapt to the viewer's role:

- **admin / monitor**: institution filter plus a user filter that cascades when an institution is selected
- **user / oauth2**: user filter only, automatically scoped to the viewer's own institution by the backend

## Roles

| Role | Access |
|---|---|
| `admin` | Full configuration, all traffic, all OAuth pipelines, destructive actions |
| `monitor` | Global observability (same traffic and pipeline visibility as admin), no configuration |
| `oauth2` | All OAuth pipelines; no traffic, no configuration |
| `user` | Own institution's traffic, own OAuth pipelines, integration guide, participant token |

After login, admin, monitor, and oauth2 users are redirected to the Dashboard. Users are redirected to the Integration Guide.

## Participant Tokens

Every proxied request is expected to carry a rotating JWT in a configurable header (default `X-Participant-Token`). Prism uses this header to attribute traffic to a participant without requiring them to use their primary login credentials for every call.

- Tokens are JWT-signed with a separate secret (`PARTICIPANT_TOKEN_SECRET`)
- TTL is configurable via the Settings page (`participant_token_ttl_minutes`, 1 to 43200 minutes / 30 days)
- Each user has one active token at a time; renewing a token immediately revokes the previous one
- The `POST /api/token/current` and `POST /api/token/renew` endpoints allow programmatic token retrieval using username and password

See [Participant Tokens](docs/participant-tokens.md) for endpoint reference and curl examples.

## Configuration

Key environment variables (see `.env.example` for full reference):

| Variable | Default | Purpose |
|---|---|---|
| `PROXY_DB_PASS` | — | Required. Prism PostgreSQL password |
| `GAZELLE_DB_HOST` | — | Required. Gazelle read-only DB host |
| `JWT_SECRET` | — | Required. At least 32 random characters |
| `JWT_REFRESH_SECRET` | — | Required. Different from JWT_SECRET |
| `PARTICIPANT_TOKEN_SECRET` | — | Required. Different from both JWT secrets |
| `APP_PORT` | `3000` | Port for the Prism web app |
| `PROXY_PORT_START` / `PROXY_PORT_END` | `7001` / `7100` | Port range for proxy listeners |
| `BASE_PATH` | _(empty)_ | Sub-path prefix for reverse-proxy mounting (e.g. `/prism`) |

`BASE_PATH` is baked into the frontend bundle at Docker build time. Changing it requires a rebuild:

```bash
# .env
BASE_PATH=/prism

docker compose build prism-app && docker compose up -d prism-app
```

## Repository Layout

- `src/`: Fastify backend, proxy lifecycle, auth, health checks, OAuth reconciliation, and routes
- `client/src/`: React frontend pages, reusable UI, and state
- `prisma/`: Prism database schema
- `prisma-gazelle/`: Gazelle read-only schema
- `simulators/oauth-simulator/`: local authentication/resource simulator for testing OAuth flows
- `simulators/oauth-stress/`: stress-test driver for load-testing OAuth pipelines
- `docs/`: architecture, deployment, database, and feature guides
- `nginx/`: example Nginx TLS termination config

## Documentation

- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Deployment](docs/deployment.md)
- [Database Model](docs/database.md)
- [Participant Tokens](docs/participant-tokens.md)
- [OAuth Pipelines](docs/oauth-pipelines.md)
- [Integration Guide](docs/integration-guide.md)
- [OAuth Simulator](simulators/oauth-simulator/README.md)
- [Contributor Guide](AGENTS.md)
