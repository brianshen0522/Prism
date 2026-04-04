# Prism

Prism is a traffic inspection and monitoring platform for IHE-style integration testing. It sits in front of FHIR, OAuth, and other backend services, records HTTP exchanges in real time, and gives organizers and participants a shared view of what happened.

The system is built for environments where teams need to answer questions like:

- Which requests reached a server, and how did they fail?
- Did a participant include the required participant token?
- Did an OAuth flow complete, validate correctly, and stay legal?
- Which backend server or authentication server was involved?

Prism combines a Fastify API, a React dashboard, dynamic proxy listeners, WebSocket updates, and PostgreSQL storage. It can show raw traffic or aggregate OAuth pipelines, including token issue, resource access, validation, and refresh-token lineage.

## What Prism Does

- Proxies HTTP traffic to configured backend servers
- Stores request and response metadata for analysis
- Provides dashboard, traffic, and connection views
- Enforces participant-token visibility rules
- Tracks OAuth pipelines across authentication and resource servers
- Supports role-based access for admins, monitors, and users

## Documentation

- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Deployment](docs/deployment.md)
- [Database Model](docs/database.md)
- [OAuth Pipelines](docs/oauth-pipelines.md)
- [OAuth Simulator](simulators/oauth-simulator/README.md)
- [Contributor Guide](AGENTS.md)

## Repository Layout

- `src/`: Fastify backend, proxy lifecycle, WebSocket services, auth, and OAuth aggregation
- `client/src/`: React dashboard and traffic UI
- `prisma/`: Prism database schema
- `prisma-gazelle/`: Gazelle read-only schema
- `simulators/oauth-simulator/`: local OAuth authentication/resource simulator

## Audience

- Connectathon organizers who need a central operations dashboard
- Monitors who inspect live traffic and OAuth failures
- Participants who need to review their own requests and pipelines

For setup, commands, environment variables, schema details, and simulator scenarios, use the linked documents above.
