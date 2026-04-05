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
│ Fastify API                                                │
│ React frontend                                             │
│ WebSocket live updates                                     │
│ OAuth extraction + reconcile                               │
│ Server health and heartbeat workers                        │
│ Integration Guide generation                               │
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

This workflow powers:

- `Dashboard`
- `Global Traffic`
- `My Connections`
- connection inspect sidebars

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

This workflow powers:

- `OAuth Pipelines` mode in traffic pages
- OAuth detail flow maps
- refresh-chain tracing

### 3. Server Health and Proxy Heartbeat

```text
Target Test:
Prism -> backend target URL

Heartbeat:
Prism -> user-facing URL through proxy path
      -> compare expected status
      -> verify proxy path is working
```

This workflow powers:

- backend status
- proxy status
- heartbeat timelines in `Servers`

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
- OAuth walkthrough
- curl examples
```

This workflow powers:

- `Integration Guide`
- participant onboarding after login

## Main Screens

- `Integration Guide`: catalog of services plus a detail page for each direct server or OAuth server pair
- `Dashboard`: recent raw connections, recent OAuth pipelines, and summary metrics
- `Global Traffic`: raw traffic and OAuth pipeline views across the whole system
- `My Connections`: the same two modes, scoped to the current user
- `Servers`: server configuration, target testing, heartbeat testing, timelines, and status lights
- `Participant Token`: current token, renewal actions, validation APIs, and curl examples

## Roles

- `admin`: full configuration, traffic visibility, and destructive actions
- `monitor`: global observability views without admin-only configuration powers
- `user`: personal traffic plus generated integration guidance and token tools

## Repository Layout

- `src/`: Fastify backend, proxy lifecycle, auth, health checks, OAuth reconciliation, and routes
- `client/src/`: React frontend pages, reusable UI, and state
- `prisma/`: Prism database schema
- `prisma-gazelle/`: Gazelle read-only schema
- `simulators/oauth-simulator/`: local authentication/resource simulator for testing OAuth flows

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

For setup, commands, schema details, and simulator scenarios, use the linked documents above.
