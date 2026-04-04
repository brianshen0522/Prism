# Prism Setup for the OAuth Simulator

Use the simulator when you want deterministic OAuth traffic for Prism.

## Configure the Authentication Server in Prism

- Role: `authentication`
- Target URL: `http://host.docker.internal:4010`
- Token endpoint: `/oauth/token`
- Validation endpoint: `/oauth/validate`
- Validation success path: `active`
- Validation success value: `true`

## Configure the Resource Server in Prism

- Role: `resource`
- Target URL: `http://host.docker.internal:4020`
- Optionally associate it with the authentication server above

## Important Requirement

To let Prism see the full OAuth pipeline, both of these paths must go through Prism proxy ports:

- client -> authentication server
- client -> resource server

The resource server will then call the authentication server for validation, which Prism can match as the third step.

## What You Can Validate

With the simulator, Prism should be able to detect:

- token issue
- resource access
- validation call
- incomplete pipeline cases
- illegal flows caused by missing participant token
- refresh-token lineage between pipelines
