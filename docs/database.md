# Database Model

Prism uses two Prisma schemas:

- `prisma/schema.prisma`: Prism application data
- `prisma-gazelle/schema.prisma`: Gazelle read-only user data

## Core Models

### `BackendServer`

Represents a proxied upstream service.

Important fields:

- target URL and proxy port
- optional description
- active state
- optional body size limit
- server role: `generic`, `authentication`, `resource`
- OAuth token and validation endpoint settings
- target test settings
- heartbeat base URL, heartbeat path, probe expectations, and TLS settings

Relationship notes:

- one `BackendServer` can produce many `Connection` rows
- a `resource` server can optionally point at one `authentication` server
- `heartbeat` and health metadata are derived from server configuration

### `Connection`

Stores one proxied HTTP exchange.

Important fields:

- request and response metadata
- system-heartbeat markers
- participant-token presence
- OAuth classification
- access-token hash / preview
- refresh-token hash / preview
- issued token hash / preview

Relationship notes:

- every proxied HTTP exchange becomes one `Connection`
- system heartbeat probes are also stored as `Connection` records, but marked separately
- OAuth extraction classifies connections before they are attached to pipelines

### `OAuthPipeline`

Groups related connections around one access token.

Important fields:

- participant user
- authentication server
- token issue connection
- completeness, legality, and success flags
- resource call count

Relationship notes:

- one `OAuthPipeline` represents one access-token-centered flow
- one pipeline can have many resource calls
- one pipeline can be linked backward and forward through refresh-token lineage

### `OAuthPipelineResourceCall`

Represents one resource call inside a pipeline and its optional matched validation request.

This is the bridge between:

- one resource access connection
- its matched validation connection
- its parent `OAuthPipeline`

## Supporting Models

- `RefreshToken`: Prism-issued refresh tokens for UI authentication
- `ParticipantToken`: anti-cheat token per user
- `SystemSetting`: runtime configuration

### `SystemSetting`

`SystemSetting` stores runtime configuration that the UI and backend both rely on.

Examples include:

- participant token header name
- participant token TTL
- default body storage limit
- proxy timeout
- dashboard window and chart settings
- connectathon display name

Known settings now use:

- frontend hints and range guidance in `Settings`
- backend validation in the settings route

This prevents invalid values from being silently accepted for important operational settings.

## Relationship Overview

```text
BackendServer
   |
   +----< Connection
   |
   +----< BackendServer (resource -> authentication link)

Connection
   |
   +---- token issue ----+
   |                     |
   +---- resource call --+--> OAuthPipeline
   |                     |
   +---- validation -----+

OAuthPipeline
   |
   +----< OAuthPipelineResourceCall
```

## Data Flow

### Raw Traffic

```text
proxied request
    ->
Connection row created
    ->
response stored on same row
```

### OAuth Pipeline

```text
Connection
  ->
classify kind
  ->
extract participant/access/refresh token metadata
  ->
find or create OAuthPipeline
  ->
attach resource call / validation
  ->
recompute complete / legal / success / diagnostics
```

### Participant Token Legality

`ParticipantToken` does not only power API retrieval. It also affects OAuth legality:

- client-originated requests must carry the participant token
- that token must still resolve to the pipeline user
- expired or unlinked participant tokens make the pipeline `illegal`

### System Heartbeat Traffic

Heartbeat traffic is stored in `Connection` like normal traffic, but marked as system traffic so the UI can:

- hide it by default in raw traffic views
- show it when operators explicitly include heartbeat traffic
- avoid mixing health checks with participant traffic unintentionally

## Important Rule

Schema changes in code are not enough. Runtime environments must apply the schema update before Prisma can read or write new fields.
