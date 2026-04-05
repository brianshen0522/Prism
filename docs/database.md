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

### `OAuthPipeline`

Groups related connections around one access token.

Important fields:

- participant user
- authentication server
- token issue connection
- completeness, legality, and success flags
- resource call count

### `OAuthPipelineResourceCall`

Represents one resource call inside a pipeline and its optional matched validation request.

## Supporting Models

- `RefreshToken`: Prism-issued refresh tokens for UI authentication
- `ParticipantToken`: anti-cheat token per user
- `SystemSetting`: runtime configuration

## Important Rule

Schema changes in code are not enough. Runtime environments must apply the schema update before Prisma can read or write new fields.
