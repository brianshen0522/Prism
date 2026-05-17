# Participant Tokens

Prism exposes API endpoints for the participant token, also referred to in the UI as the Participant ID token.

For external integrations, the preferred pattern is to authenticate each request with `username` and `password` in the request body. Legacy Bearer-token routes remain available for the Prism web UI.

Participant tokens are signed JWTs issued for one user and that user's current institution. The signing secret is `PARTICIPANT_TOKEN_SECRET`, which must be different from the regular access-token secrets.

The token TTL is controlled by the `participant_token_ttl_minutes` system setting (configurable in the Settings page). Accepted range is 1 to 43200 minutes (30 days). The default is 5 minutes.

## Security Notes

- Use the username/password APIs only over HTTPS.
- Do not paste participant tokens into shared logs or tickets unless absolutely necessary.
- Prefer validating a token through the API instead of manually distributing raw token values.
- If a participant token is suspected to be exposed, use `POST /api/token/renew` to rotate it immediately.

## Endpoints

### `POST /api/token/current`

Returns the current participant token for the supplied user. If the token is missing or expired, Prism will generate a new one automatically.

Request body:

```json
{
  "username": "alice",
  "password": "secret"
}
```

Response shape:

```json
{
  "token": "eyJhbGciOi...",
  "expires_at": "2026-04-05T12:00:00.000Z",
  "created_at": "2026-04-05T11:55:00.000Z",
  "header_name": "X-Participant-Token",
  "institution_id": 456
}
```

### `POST /api/token/renew`

Forces a new participant token to be issued immediately for the authenticated user.

Use this when the current token must be rotated before expiry.

Request body:

```json
{
  "username": "alice",
  "password": "secret"
}
```

Response shape:

```json
{
  "token": "eyJhbGciOi...",
  "expires_at": "2026-04-05T12:30:00.000Z",
  "created_at": "2026-04-05T12:00:00.000Z",
  "header_name": "X-Participant-Token",
  "institution_id": 456
}
```

### `POST /api/token/validate`

Checks whether a participant token is valid.

Use this route in two different ways.

#### Validate the user's current token

If `token` is omitted, Prism looks up that user's current participant token and validates it.

Request body:

```json
{
  "username": "alice",
  "password": "secret"
}
```

This is useful when you want to know:

- whether the user currently has a participant token
- whether that token is still valid
- what token status Prism currently sees for that user

This mode is intended for:

- client self-checks
- onboarding checks
- support flows where the user wants to confirm their current token state

#### Validate a specific token value

If `token` is provided, Prism validates that exact token value.

Request body:

```json
{
  "username": "alice",
  "password": "secret",
  "token": "9f6d..."
}
```

Response shape:

```json
{
  "token": "eyJhbGciOi...",
  "valid": true,
  "expires_at": "2026-04-05T12:00:00.000Z",
  "header_name": "X-Participant-Token",
  "institution_id": 456,
  "belongs_to_current_organization": true,
  "belongs_to_current_user": true,
  "reason": "valid"
}
```

Possible `reason` values:

- `valid`
- `expired`
- `revoked`
- `not_found`

This mode is intended for:

- validating a token copied from another system
- checking whether a token still belongs to the current user
- confirming whether a previously issued token has already expired

## Legacy Aliases

These older routes still work for compatibility with the Prism web UI and authenticated internal flows:

- `GET /api/token`
- `GET /api/token/current`
- `POST /api/token/regen`
- `POST /api/token/renew` with `Authorization: Bearer <jwt>`
- `POST /api/token/validate` with `Authorization: Bearer <jwt>`

Prefer the clearer names for new integrations:

- `POST /api/token/current`
- `POST /api/token/renew`
- `POST /api/token/validate`

## Curl Examples

Get the current token for a user. If the token is missing or expired, Prism will issue a fresh one:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret"}' \
  http://localhost:3000/api/token/current
```

Force a new token to be issued for a user:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret"}' \
  http://localhost:3000/api/token/renew
```

Validate a specific token value:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret","token":"$PARTICIPANT_TOKEN"}' \
  http://localhost:3000/api/token/validate
```

Validate the user's current token without providing a token value:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret"}' \
  http://localhost:3000/api/token/validate
```

## Compatibility Note

Prism still supports Bearer-authenticated token routes for the web UI and older internal flows, but new external integrations should use the username/password examples above.

## UI Note

The `Participant Token` page in the Prism frontend shows these curl examples using the same origin the user is currently visiting. If the page is opened through `http://ip:port`, the examples use that address. If it is opened through an HTTPS domain, the examples use that domain.
