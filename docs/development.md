# Development

## Prerequisites

- Node.js 20+
- npm
- PostgreSQL access for both Prism and Gazelle schemas, or Docker Compose for local stack work

## Install

```bash
npm install
cd client && npm install
```

## Common Commands

```bash
npm run dev
npm run dev:client
npm test
npx vitest run src/routes/connections.test.ts
npm run build
```

## Database Commands

```bash
npm run db:generate
npm run db:push
npm run db:migrate:dev
npm run db:migrate:deploy
```

Use `db:push` for fast local schema sync. Use migrations for controlled deployment work.

## Code Areas

- `src/routes/`: REST endpoints
- `src/proxy/`: request capture and forwarding
- `src/oauth/`: OAuth extraction and pipeline reconciliation
- `src/ws/`: live dashboard and traffic updates
- `client/src/pages/`: screen-level UI
- `client/src/components/`: reusable UI pieces

## API Notes

Participant-token APIs are documented separately in [Participant Tokens](participant-tokens.md).

Current routes:

- `POST /api/token/current`
- `POST /api/token/renew`
- `POST /api/token/validate`
- `GET /api/integration-guide`
- `GET /api/integration-guide/:id`

Preferred API usage is `username/password` in the request body. Legacy authenticated routes remain available for the web UI:

- `GET /api/token`
- `GET /api/token/current`
- `POST /api/token/regen`

## Testing Guidance

- Keep tests next to the code they cover as `*.test.ts`
- Add focused tests when changing proxy flow, auth behavior, route filtering, or OAuth matching
- Run targeted Vitest commands before broad test runs when debugging

## Typical Workflows

### Schema Change

When changing Prisma models:

1. edit `prisma/schema.prisma`
2. run:

```bash
npm run db:push
npm run db:generate
```

3. update any affected route or frontend types
4. run targeted tests
5. run `npm run build`

### Frontend Page Change

When changing a major page such as traffic, servers, or guide pages:

1. update page component and any shared primitives
2. verify responsive behavior
3. confirm affected API types still match backend responses
4. run `npm run build`

### OAuth Pipeline Change

When changing OAuth extraction, reconcile logic, or OAuth UI:

1. update backend classification / reconcile logic
2. add or adjust focused OAuth tests
3. verify:
   - raw traffic still loads
   - OAuth list still loads
   - OAuth detail still renders
4. run `npm run build`
5. run targeted Vitest for OAuth-related files when available

### Server Configuration Change

When changing server configuration fields:

1. update backend schema and route validation
2. update frontend form state and defaults
3. verify `Servers` page create/edit flows
4. verify `Test target` and heartbeat behavior if impacted

## Notes

- Prisma client types must be regenerated after schema changes.
- If code uses new DB columns, the database must be updated before runtime testing.
- The OAuth simulator has its own docs under [`simulators/oauth-simulator/`](../simulators/oauth-simulator/README.md).
- The user-facing `Integration Guide` now uses a catalog/detail model built from `/api/integration-guide` and `/api/integration-guide/:id`.
- Server config now includes:
  - optional descriptions
  - direct target tests
  - separate backend target and user access URL settings
  - heartbeat path, method, expected status, interval, timeout, and TLS options
- Heartbeat traffic is stored as system traffic and is hidden from raw traffic views unless explicitly enabled.
- Authentication servers default heartbeat path to `/health`; other servers default to `/`.
