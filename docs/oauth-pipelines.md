# OAuth Pipelines

Prism can group raw HTTP traffic into OAuth pipelines when server roles and endpoint settings are configured.

## Supported Roles

- `authentication`
- `resource`
- `generic`

## Classic Flow

Prism currently tracks:

1. Client requests an access token from the authentication server
2. Client calls the resource server with that access token
3. Resource server validates the token with the authentication server

It also supports refresh-token chaining:

- refresh grant detection
- newly issued refresh token display
- previous and next pipeline linking through refresh-token lineage

## Pipeline States

- `complete`: required OAuth steps were found
- `legal`: the client-originated steps carried the participant token and the flow is complete
- `success`: token issue succeeded and at least one resource call succeeded

## Detail View

The OAuth detail page shows:

- summary status
- swimlane flow map
- token issue and resource/validation steps
- refresh-token lineage
- links back to raw connections

## Filters

OAuth mode uses a simpler filter model than raw traffic:

- access token
- participant user
- legal / illegal
- success / failed
- authentication server
- resource server

## Simulator

For local test data, use the [OAuth Simulator](../simulators/oauth-simulator/README.md).
