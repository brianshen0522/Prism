# OAuth Pipelines

Prism can turn related raw HTTP exchanges into one higher-level OAuth pipeline. This allows operators and participants to inspect a complete OAuth story instead of manually hunting through separate traffic rows.

## Purpose

Raw traffic is useful for exact request and response inspection, but OAuth problems usually span multiple exchanges:

- token request
- resource call
- token validation
- refresh-token reissue

Prism groups those calls so the UI can answer:

- Did the OAuth flow complete?
- Was it legal?
- Was it successful?
- Which authentication server and resource server were involved?
- Which raw connections belong to this flow?

## Supported Roles

Prism classifies configured backend servers into:

- `authentication`
- `resource`
- `generic`

OAuth pipelines are built only when the relevant servers are configured as `authentication` and `resource`.

## Pipeline Architecture

```text
Client
  |
  | 1. request token + participant token
  v
Authentication Server
  |
  | issues access token
  v
Client
  |
  | 2. call resource server with access token + participant token
  v
Resource Server
  |
  | 3. validate access token
  v
Authentication Server

Prism:
- captures all matching HTTP exchanges
- extracts token metadata
- groups calls by token relationship
- computes pipeline state
```

## Classic Flow

Prism currently supports the classic three-step OAuth pattern:

1. Client requests an access token from the authentication server
2. Client calls the resource server with that access token
3. Resource server validates the token with the authentication server

It also supports refresh-token lineage:

- refresh grant detection
- issued refresh-token extraction
- previous and next pipeline linking through refresh-token relationships

## How Prism Builds a Pipeline

```text
Incoming proxied connection
        |
        v
Classify request kind
- token issue
- resource access
- token validation
- generic
        |
        v
Extract token metadata
- participant token presence
- access token
- refresh token
        |
        v
Find or create pipeline
        |
        v
Attach resource call / validation
        |
        v
Recompute:
- complete
- legal
- success
- diagnostics
```

## Pipeline States

- `complete`
  - the expected OAuth steps were found and at least one resource flow is complete enough to count
- `legal`
  - the flow is complete and client-originated requests have participant tokens that still resolve to the pipeline user
- `success`
  - token issue succeeded and at least one resource call succeeded

These three states are intentionally different:

- a pipeline can be complete but illegal
- a pipeline can be incomplete and failed
- a pipeline can contain both failed and successful resource calls, while overall success remains true if at least one resource call succeeded

## Participant Token Dependency

OAuth legality depends on the participant token carried by client-originated requests.

- the token header name comes from Prism system settings
- expired or unlinked participant tokens make a pipeline `illegal`
- pipeline legality requires the participant token to resolve back to the user
- participant tokens can be managed through the APIs documented in [Participant Tokens](participant-tokens.md)

## UI Workflow

### List View

`Global Traffic` and `My Connections` both support an `OAuth Pipelines` mode.

The list view shows:

- participant user
- authentication server
- resource server
- token fingerprint
- resource call count
- complete / legal / success
- diagnostics summary
- refresh lineage indicators

### Detail View

The OAuth detail page shows:

- summary status
- flow map
- linked token issue, resource, and validation steps
- connection inspect sidebar for the selected step
- refresh-token lineage
- links back to raw connections

The detail page is designed to answer both:

- what happened in the OAuth flow
- which exact HTTP exchanges produced that result

## Filters

OAuth mode uses a simpler filter model than raw traffic:

- access token
- participant user
- legal / illegal
- success / failed
- authentication server
- resource server

## Dashboard

The dashboard also includes a recent OAuth pipelines section so operators can jump into pipeline detail without first opening the traffic pages.

## Simulator

For local test data, use the [OAuth Simulator](../simulators/oauth-simulator/README.md).
