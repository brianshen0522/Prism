# Integration Guide

Prism includes a user-facing `Integration Guide` that is generated from active server configuration. It is intended to be the primary onboarding surface after login for participants who need to know which services exist and how to call them correctly.

## Structure

The guide now uses a two-step model:

1. Catalog page: `/guide`
2. Detail page: `/guide/:id`

The catalog only shows selectable service blocks. Each block represents one resource server or one direct-access server. Detailed flow explanations, headers, and curl examples are shown only after the user opens a specific guide item.

## What The Catalog Shows

- the current participant token header name
- the current user's masked participant token
- service counts for direct-access servers and OAuth-protected resource servers
- one card per available service
- the public user-facing URL for each service
- the linked authentication server, when applicable

## What The Detail Page Shows

- the selected server's public URL
- the linked authentication server, when applicable
- participant token requirements
- generated notes derived from server configuration
- a step-by-step walkthrough
- copy-ready curl examples for each step

For OAuth-protected resource servers, the detail page generates:

1. participant token retrieval
2. access-token request
3. resource call

For direct-access servers, the detail page generates a direct request flow with the participant token header.

## Data Source

The frontend calls:

- `GET /api/integration-guide`
- `GET /api/integration-guide/:id`

These responses are generated from:

- active `BackendServer` records
- server role and linked OAuth settings
- user-facing access URL
- the current user's participant token

## URL Rules

For each service, Prism displays:

- `user access URL` first
- `target_url` only as a fallback

This keeps the guide aligned with the URL that real participants should call.

## Intended Audience

The page is available to all authenticated roles:

- `user`
- `monitor`
- `admin`

The content is written from the participant point of view rather than the admin configuration point of view.

## UX Notes

The guide is designed as an onboarding and self-service portal rather than a raw admin table. It uses:

- a full-width onboarding hero
- service catalog cards
- separate sections for OAuth-protected and direct-access services
- a dedicated detail page per service
- walkthrough cards and curl examples
- copy buttons for URLs, tokens, and curl commands
