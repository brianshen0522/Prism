# OAuth Simulator

Small Dockerized OAuth traffic simulator for Prism. It exposes:

- An authentication server with `POST /oauth/token` and `POST /oauth/validate`
- A resource server with `GET /resource/patient`
- A tiny driver command to trigger Prism-friendly flows

The simulator is designed around Prism's OAuth matching rules:

- Client token requests should include the participant token header
- Client resource requests should include the participant token header
- Resource-server validation requests should omit the participant token header
- Initial access token issue and refresh token exchange both go through `POST /oauth/token`

## Folder layout

```text
simulators/oauth-simulator/
├── docker-compose.yml
├── Dockerfile
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── config.ts
    ├── driver.ts
    ├── server.ts
    └── state.ts
```

## Start the simulator

```bash
cd /home/user/Prism/simulators/oauth-simulator
cp .env.example .env
docker compose up --build
```

That starts:

- Authentication server on `http://localhost:4010`
- Resource server on `http://localhost:4020`

## Log colors

The simulator prints colored event logs so different traffic types are easy to distinguish in `docker compose up` output:

- Green `TOKEN` or `RESOURCE`: successful token issue or resource success
- Green `REFRESH`: successful refresh token exchange
- Blue `RESOURCE`: client request reached the resource server
- Magenta `RS->AS`: resource server calling auth validation
- Cyan `VALIDATE`: auth validation returned active
- Yellow `TOKEN` or `RESOURCE`: malformed token issue or validation skipped
- Red `TOKEN`, `REFRESH`, `VALIDATE`, or `RESOURCE`: failure or inactive token

## Trigger scenarios

Open a second terminal in the same folder.

Happy path:

```bash
docker compose run --rm oauth-driver happy-path
```

Refresh token flow:

```bash
docker compose run --rm oauth-driver refresh-token
```

Missing participant token on both client requests:

```bash
docker compose run --rm oauth-driver missing-participant-token
```

Missing participant token only on the token request:

```bash
docker compose run --rm oauth-driver missing-participant-token --omit-on=token
```

Missing participant token only on the resource request:

```bash
docker compose run --rm oauth-driver missing-participant-token --omit-on=resource
```

Missing validation:

```bash
docker compose run --rm oauth-driver missing-validation
```

Failed validation:

```bash
docker compose run --rm oauth-driver failed-validation
```

Failed token issue:

```bash
docker compose run --rm oauth-driver failed-token-issue
```

Malformed token issue response:

```bash
docker compose run --rm oauth-driver failed-token-issue --token-mode=malformed
```

Multiple resource calls with one access token:

```bash
docker compose run --rm oauth-driver multiple-resource-calls --calls=3
```

Incomplete pipeline with only token issue:

```bash
docker compose run --rm oauth-driver token-only
```

## Manual curl examples

Happy path:

```bash
ACCESS_TOKEN=$(curl -s \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-Token: demo-participant-token' \
  -d '{"grant_type":"client_credentials","scope":"patient/*.read"}' \
  | jq -r '.access_token')

curl -i \
  -X GET "http://localhost:4020/resource/patient" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'X-Participant-Token: demo-participant-token'
```

Missing participant token:

```bash
ACCESS_TOKEN=$(curl -s \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credentials"}' \
  | jq -r '.access_token')

curl -i \
  -X GET "http://localhost:4020/resource/patient" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

Missing validation:

```bash
ACCESS_TOKEN=$(curl -s \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-Token: demo-participant-token' \
  -d '{"grant_type":"client_credentials"}' \
  | jq -r '.access_token')

curl -i \
  -X GET "http://localhost:4020/resource/patient?skipValidation=true" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'X-Participant-Token: demo-participant-token'
```

Failed validation:

```bash
ACCESS_TOKEN=$(curl -s \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-Token: demo-participant-token' \
  -d '{"grant_type":"client_credentials"}' \
  | jq -r '.access_token')

curl -i \
  -X GET "http://localhost:4020/resource/patient?validationMode=inactive" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'X-Participant-Token: demo-participant-token'
```

Failed token issue:

```bash
curl -i \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-Token: demo-participant-token' \
  -d '{"grant_type":"client_credentials","simulate_token_mode":"error"}'
```

Malformed token issue:

```bash
curl -i \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-Token: demo-participant-token' \
  -d '{"grant_type":"client_credentials","simulate_token_mode":"malformed"}'
```

Refresh token:

```bash
INITIAL=$(curl -s \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-Token: demo-participant-token' \
  -d '{"grant_type":"client_credentials","scope":"patient/*.read"}')

REFRESH_TOKEN=$(printf '%s' "$INITIAL" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).refresh_token))")

REFRESHED=$(curl -s \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-Token: demo-participant-token' \
  -d "{\"grant_type\":\"refresh_token\",\"refresh_token\":\"${REFRESH_TOKEN}\"}")

ACCESS_TOKEN=$(printf '%s' "$REFRESHED" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))")

curl -i \
  -X GET "http://localhost:4020/resource/patient" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'X-Participant-Token: demo-participant-token'
```

Multiple resource calls using the same token:

```bash
ACCESS_TOKEN=$(curl -s \
  -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -H 'X-Participant-Token: demo-participant-token' \
  -d '{"grant_type":"client_credentials"}' \
  | jq -r '.access_token')

curl -i -H "Authorization: Bearer ${ACCESS_TOKEN}" -H 'X-Participant-Token: demo-participant-token' http://localhost:4020/resource/patient
curl -i -H "Authorization: Bearer ${ACCESS_TOKEN}" -H 'X-Participant-Token: demo-participant-token' http://localhost:4020/resource/patient
curl -i -H "Authorization: Bearer ${ACCESS_TOKEN}" -H 'X-Participant-Token: demo-participant-token' http://localhost:4020/resource/patient
```

## Prism setup

To make Prism capture all three steps, route both the client traffic and the resource-server validation traffic through Prism proxy ports.

Example local setup:

1. Start Prism normally.
2. In Prism, create an authentication server:
   - Role: `authentication`
   - Target base URL: `http://host.docker.internal:4010`
   - Token endpoint: `/oauth/token`
   - Validation endpoint: `/oauth/validate`
   - Validation success path: `active`
   - Validation success value: `true`
3. In Prism, create a resource server:
   - Role: `resource`
   - Target base URL: `http://host.docker.internal:4020`
   - Linked authentication server: the auth server above
4. Note the assigned Prism proxy ports, for example:
   - Auth proxy: `http://host.docker.internal:7001`
   - Resource proxy: `http://host.docker.internal:7002`
5. In `.env`, point the simulator and driver at Prism:

```bash
AUTH_VALIDATE_BASE_URL=http://host.docker.internal:7001
CLIENT_AUTH_BASE_URL=http://host.docker.internal:7001
CLIENT_RESOURCE_BASE_URL=http://host.docker.internal:7002
```

Then restart the simulator:

```bash
docker compose up --build
```

Now a happy-path driver run produces:

1. Client -> Prism auth proxy -> simulator auth `/oauth/token`
2. Client -> Prism resource proxy -> simulator resource `/resource/patient`
3. Resource simulator -> Prism auth proxy -> simulator auth `/oauth/validate`

That gives Prism the three linked requests it needs to classify an OAuth pipeline.

## Config

| Variable | Default | Purpose |
|---|---|---|
| `AUTH_HOST` | `0.0.0.0` | Authentication server bind host |
| `AUTH_PORT` | `4010` | Authentication server bind port |
| `RESOURCE_HOST` | `0.0.0.0` | Resource server bind host |
| `RESOURCE_PORT` | `4020` | Resource server bind port |
| `PARTICIPANT_HEADER_NAME` | `X-Participant-Token` | Client-side participant header name |
| `AUTH_TOKEN_ENDPOINT` | `/oauth/token` | Token endpoint |
| `AUTH_VALIDATE_ENDPOINT` | `/oauth/validate` | Validation endpoint |
| `VALIDATION_SUCCESS_PATH` | `active` | Field Prism expects in validation response |
| `VALIDATION_SUCCESS_VALUE` | `true` | Value Prism treats as successful |
| `AUTH_VALIDATE_BASE_URL` | `http://127.0.0.1:4010` | Where the resource server sends validation requests |
| `CLIENT_AUTH_BASE_URL` | `http://oauth-simulator:4010` | Driver target for token requests |
| `CLIENT_RESOURCE_BASE_URL` | `http://oauth-simulator:4020` | Driver target for resource requests |
| `PARTICIPANT_TOKEN_VALUE` | `demo-participant-token` | Participant token value sent by the driver |

## Notes

- The resource server never forwards the participant token header during `/oauth/validate`.
- The auth server accepts tokens in JSON body as `access_token` or `token`, or via `Authorization: Bearer`.
- `missing-validation` returns a successful resource response without any validation call so Prism can treat it as incomplete.
