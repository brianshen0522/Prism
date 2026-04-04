# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Fastify backend. Keep route handlers in `src/routes/`, auth and role middleware in `src/plugins/`, proxy lifecycle code in `src/proxy/`, WebSocket logic in `src/ws/`, shared helpers in `src/lib/`, and Prisma clients in `src/db/`. Put backend tests beside the code they cover as `*.test.ts`.

`client/src/` contains the React/Vite frontend. Pages live in `client/src/pages/`, reusable UI in `client/src/components/`, API and WebSocket helpers in `client/src/lib/`, and Zustand state in `client/src/store/`. Database schemas are in `prisma/schema.prisma` and `prisma-gazelle/schema.prisma`. Deployment files live in `docker-compose.yml`, `Dockerfile`, and `nginx/`.

## Build, Test, and Development Commands
Run `npm install` at the repo root, then `cd client && npm install` for the frontend.

- `npm run dev` starts the backend with `tsx watch`.
- `npm run dev:client` starts the Vite client in `client/`.
- `npm test` runs the Vitest suite once.
- `npm run test:watch` runs tests in watch mode.
- `npm run build` compiles backend TypeScript and builds the client bundle.
- `npm run db:generate` regenerates both Prisma clients after schema changes.
- `docker compose up -d --build` rebuilds and starts the full stack locally.

## Coding Style & Naming Conventions
This repo uses strict TypeScript with ES2022 on the backend and React 18 on the client. Follow the existing style: semicolons, single quotes, trailing commas where they improve diffs, and 2-space indentation in both TS and TSX. Use `PascalCase` for React components and page files, `camelCase` for functions and variables, and kebab-free descriptive filenames such as `manager.ts` or `ConnectionDetailPage.tsx`.

There is no configured ESLint or Prettier layer here, so keep changes consistent with nearby files and rely on `tsc` plus tests before submitting.

## Testing Guidelines
Vitest is the test runner. Name tests `*.test.ts` and keep them close to the module under test, for example `src/routes/auth.test.ts`. Add focused unit tests for route behavior, proxy logic, auth helpers, and WebSocket channel rules whenever you change them. Run `npm test` before opening a PR; use `npx vitest run path/to/file.test.ts` for targeted checks.

## Commit & Pull Request Guidelines
History is minimal, but the existing style uses short, imperative commit subjects, for example `Initial commit`. Keep commits scoped and readable. PRs should include a brief summary, note schema or env changes, link the related issue when applicable, and attach screenshots for frontend changes touching dashboard, traffic, servers, or settings screens.
