# Architecture

Prism is a reverse-proxy observability system with three main parts:

1. A Fastify backend that exposes REST APIs, serves the built frontend, and publishes WebSocket updates.
2. A dynamic proxy layer that opens one local listener per configured backend server.
3. A React frontend that shows dashboard metrics, raw traffic, and OAuth pipeline views.

## Request Flow

```text
Client -> Prism proxy port -> Backend server
                 |
                 +-> store request/response metadata
                 +-> emit live updates over WebSocket
                 +-> classify OAuth traffic when applicable
```

Each `BackendServer` gets its own proxy port. Prism records the request before forwarding it, updates the record when the upstream response returns, and then queues OAuth reconciliation if the traffic matches token issue, resource access, or validation behavior.

## Identity and Roles

- User authentication comes from Gazelle-backed login and Prism-issued JWTs.
- Participant identity on proxied requests is inferred from JWT or participant token header.
- Backend servers can be classified as `generic`, `authentication`, or `resource`.
- Prism also exposes participant-token management APIs for current token retrieval, renewal, and validation.

## OAuth Model

Prism supports two traffic modes:

- Raw traffic: every proxied HTTP exchange as an individual connection
- OAuth pipelines: grouped flows built around access tokens

An OAuth pipeline can include:

- token issue
- resource access
- validation request
- refresh-token lineage

See [OAuth Pipelines](oauth-pipelines.md) for rules and UI behavior.
