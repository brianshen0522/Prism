# Prism OAuth Simulator

This simulator generates Prism-friendly OAuth traffic with two actors:

- an authentication server
- a resource server

It is meant for local testing of raw traffic capture, OAuth pipeline detection, validation matching, and refresh-token lineage.

## What It Includes

- `POST /oauth/token`
- `POST /oauth/validate`
- `GET /health/live`
- `GET /health/ready`
- `GET /health/started`
- `GET /actuator/health`
- `GET /actuator/health/liveness`
- `GET /actuator/health/readiness`
- `GET /fhir`
- `GET /fhir/metadata`
- `GET /fhir/Patient`
- `GET /fhir/Patient/:id`
- `GET /realms/master`
- `GET /realms/master/.well-known/openid-configuration`
- `GET /admin/realms/master`
- `GET /resource/patient`
- a scenario driver for common success and failure cases

## Documents

- [Getting Started](SCENARIOS.md)
- [Prism Setup](PRISM_SETUP.md)

## Folder Layout

```text
simulators/oauth-simulator/
├── compose.yml
├── Dockerfile
├── package.json
├── src/
└── README.md
```

## Quick Start

```bash
cd simulators/oauth-simulator
cp .env.example .env
docker compose -f compose.yml up --build
```

Default ports:

- authentication server: `4010`
- resource server: `4020`

Keycloak-like health check paths on the authentication server:

- `/health/live`
- `/health/ready`
- `/health/started`

HAPI FHIR-like health check paths on the resource server:

- `/actuator/health`
- `/actuator/health/liveness`
- `/actuator/health/readiness`

HAPI FHIR-like resource paths on the resource server:

- `/fhir`
- `/fhir/metadata`
- `/fhir/Patient` for Patient search bundles
- `/fhir/Patient/:id` for Patient instance reads

Additional Keycloak-like discovery and admin paths:

- `/realms/master`
- `/realms/master/.well-known/openid-configuration`
- `/admin/realms/master`

Recommended Prism heartbeat path for the simulated Keycloak server:

- `http://localhost:4010/health/ready`

Use the linked documents for scenario commands, curl examples, and Prism configuration.

## Notes for Prism Heartbeat

When configuring the simulated authentication server inside Prism:

- backend target URL should point to the simulator auth server
- user access URL can point to the same host for local testing
- heartbeat path can use `/health/ready`

For non-auth simulator targets, the default heartbeat path can stay `/`.
