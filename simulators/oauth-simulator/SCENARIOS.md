# OAuth Simulator Scenarios

## Start the Simulator

```bash
cd /home/user/Prism/simulators/oauth-simulator
cp .env.example .env
docker compose -f compose.yml up --build
```

## Driver Commands

Run scenarios from a second terminal:

```bash
docker compose -f compose.yml run --rm oauth-driver happy-path
docker compose -f compose.yml run --rm oauth-driver refresh-token
docker compose -f compose.yml run --rm oauth-driver missing-participant-token
docker compose -f compose.yml run --rm oauth-driver missing-validation
docker compose -f compose.yml run --rm oauth-driver failed-validation
docker compose -f compose.yml run --rm oauth-driver failed-token-issue
docker compose -f compose.yml run --rm oauth-driver multiple-resource-calls --calls=3
docker compose -f compose.yml run --rm oauth-driver token-only
```

## Supported Scenario Types

- happy path
- refresh-token exchange
- missing participant token
- missing validation
- failed validation
- failed token issue
- malformed token issue
- multiple resource calls using one access token
- token issue only

## Manual Curl Example

```bash
ACCESS_TOKEN=$(curl -s \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-Token: demo-participant-token' \
  -d '{"grant_type":"client_credentials"}' \
  | jq -r '.access_token')

curl -i \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'X-Participant-Token: demo-participant-token' \
  http://localhost:4020/resource/patient
```

## Suggested Prism Setup for These Scenarios

- authentication server:
  - target URL: `http://host.docker.internal:4010`
  - user access URL: `http://host.docker.internal:4010`
  - heartbeat path: `/health/ready`
- resource server:
  - target URL: `http://host.docker.internal:4020`
  - user access URL: `http://host.docker.internal:4020`
  - heartbeat path: `/`

## Traffic Rules

The simulator is aligned with Prism’s pipeline rules:

- client token requests include the participant token header
- client resource requests include the participant token header
- resource-server validation requests omit the participant token header
- refresh-token grant reuses the same token endpoint
