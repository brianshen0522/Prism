# Participant Tokens

Prism exposes API endpoints for the participant token, also referred to in the UI as the Participant ID token.

For external integrations, the preferred pattern is to authenticate each request with `username` and `password` in the request body. Legacy Bearer-token routes remain available for the Prism web UI.

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
  "token": "9f6d...",
  "expires_at": "2026-04-05T12:00:00.000Z",
  "created_at": "2026-04-05T11:55:00.000Z",
  "header_name": "X-Participant-Token"
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
  "token": "9f6d...",
  "valid": true,
  "expires_at": "2026-04-05T12:00:00.000Z",
  "header_name": "X-Participant-Token",
  "belongs_to_current_user": true,
  "reason": "valid"
}
```

Possible `reason` values:

- `valid`
- `expired`
- `not_found`

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
