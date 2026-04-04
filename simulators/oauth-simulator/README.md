# Prism OAuth Simulator

This simulator generates Prism-friendly OAuth traffic with two actors:

- an authentication server
- a resource server

It is meant for local testing of raw traffic capture, OAuth pipeline detection, validation matching, and refresh-token lineage.

## What It Includes

- `POST /oauth/token`
- `POST /oauth/validate`
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

Use the linked documents for scenario commands, curl examples, and Prism configuration.
