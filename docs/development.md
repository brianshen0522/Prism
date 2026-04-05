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

Preferred API usage is `username/password` in the request body. Legacy authenticated routes remain available for the web UI:

- `GET /api/token`
- `GET /api/token/current`
- `POST /api/token/regen`

## Testing Guidance

- Keep tests next to the code they cover as `*.test.ts`
- Add focused tests when changing proxy flow, auth behavior, route filtering, or OAuth matching
- Run targeted Vitest commands before broad test runs when debugging

## Notes

- Prisma client types must be regenerated after schema changes.
- If code uses new DB columns, the database must be updated before runtime testing.
- The OAuth simulator has its own docs under [`simulators/oauth-simulator/`](../simulators/oauth-simulator/README.md).
