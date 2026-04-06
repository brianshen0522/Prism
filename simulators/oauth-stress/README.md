# Prism OAuth Stress

`simulators/oauth-stress/` is a Python load and stress test tool for Prism.

It reads active server configuration from the Prism database, discovers configured authentication/resource server pairs, reads a JSON user credential file, and simulates concurrent OAuth workflows through Prism.

This project is meant to stress:

- Prism participant token APIs
- Prism proxy listeners
- backend writes and OAuth pipeline aggregation

## What It Tests

Each simulated success workflow does this:

1. call Prism `POST /api/token/current` using `username/password`
2. get a participant token
3. request an OAuth access token from the discovered authentication server token endpoint
4. call the discovered resource server one or more times with:
   - `Authorization: Bearer <access_token>`
   - the participant token header
5. optionally run a refresh-token flow if the auth server returns `refresh_token`
6. after refresh, call the resource server again one or more times with the refreshed access token

By default, the tool sends `2` resource requests per token-bearing phase. That means a workflow can produce:

- multiple resource requests before refresh
- multiple resource requests after refresh
- more than one FHIR/resource-server hit in a single workflow

Failure workflows are also supported. The first version includes:

- missing participant token header
- invalid participant token
- invalid access token
- bad resource path
- bad token grant

## Install

```bash
cd simulators/oauth-stress
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Users File

Use a JSON file like:

```json
[
  { "username": "user1", "password": "password1" },
  { "username": "user2", "password": "password2" }
]
```

An example file is included at [example-users.json](example-users.json).

## Pair Profiles

You can optionally override failure behavior for specific pairs with a JSON file such as [example-pair-profiles.json](example-pair-profiles.json).

The key must be:

```text
<auth server name> -> <resource server name>
```

Example:

```json
{
  "KEYCLOAK TEST -> FHIR TEST": {
    "success_ratio": 50,
    "failure_ratio": 50,
    "failure_modes": ["invalid-access-token", "bad-resource-path"],
    "failure_weights": {
      "invalid-access-token": 3,
      "bad-resource-path": 1
    },
    "failure_stages": {
      "invalid-access-token": "resource",
      "bad-resource-path": "resource"
    }
  }
}
```

## Discover Mode

Use discover mode to inspect the currently configured auth/resource pairs before you run load:

```bash
python main.py \
  --db-url postgresql://prism:changeme@localhost:5432/prism \
  --prism-origin http://localhost:3000 \
  --users example-users.json \
  --discover
```

This prints:

- participant token header name
- active authentication servers
- active resource servers
- active direct-access servers
- discovered auth/resource pairs
- skipped servers and why they were skipped
- pair-profile matches and warnings

## Dry Run

Use dry-run mode to resolve the full workload plan without sending any traffic:

```bash
python main.py \
  --db-url postgresql://prism:changeme@localhost:5432/prism \
  --prism-origin http://localhost:3000 \
  --users example-users.json \
  --include-direct \
  --resource-path /fhir/Patient \
  --resource-calls-per-workflow 3 \
  --pair-profiles example-pair-profiles.json \
  --dry-run
```

## Run Load

Example:

```bash
python main.py \
  --db-url postgresql://prism:changeme@localhost:5432/prism \
  --prism-origin http://localhost:3000 \
  --users example-users.json \
  --concurrency 50 \
  --duration 300 \
  --ramp-up 30 \
  --include-direct \
  --resource-path /fhir/Patient \
  --resource-calls-per-workflow 3 \
  --success-ratio 80 \
  --failure-ratio 20 \
  --renew-ratio 25 \
  --report ./report.json \
  --html-report ./report.html
```

## CLI Options

- `--db-url`
  Prism database connection string. Falls back to `PRISM_DATABASE_URL`.
- `--prism-origin`
  Prism web origin used for participant token APIs.
- `--users`
  JSON file with usernames and passwords.
- `--concurrency`
  Number of concurrent workers.
- `--duration`
  Total duration in seconds.
- `--ramp-up`
  Ramp-up duration in seconds.
- `--loop-delay`
  Delay between workflow loops.
- `--resource-path`
  Success-path resource URL path. Default `/`.
- `--bad-resource-path`
  Failure-path resource URL path. Default `/__stress_invalid_path__`.
- `--resource-calls-per-workflow`
  Number of resource requests to send in each token-bearing phase. Default `2`. If refresh is used, the same count is applied again after refresh.
- `--resource-server`
  Only test one named resource server.
- `--include-direct`
  Also include direct-access generic servers in the workload mix.
- `--auth-server`
  Only test one named auth server.
- `--success-ratio`
  Percentage of success workflows.
- `--failure-ratio`
  Percentage of failure workflows.
- `--renew-ratio`
  Percentage of successful workflows that should try a refresh-token flow.
- `--failure-modes`
  Comma-separated set of enabled failure modes.
- `--failure-weight-missing-participant-header`
  Relative weight for missing participant header failures.
- `--failure-weight-invalid-participant-token`
  Relative weight for invalid participant token failures.
- `--failure-weight-invalid-access-token`
  Relative weight for invalid access token failures.
- `--failure-weight-bad-resource-path`
  Relative weight for bad resource path failures.
- `--failure-weight-bad-token-grant`
  Relative weight for bad token grant failures.
- `--failure-stage-missing-participant-header`
  Inject this failure at the token request, the resource call, or both.
- `--failure-stage-invalid-participant-token`
  Inject this failure at the token request, the resource call, or both.
- `--failure-stage-invalid-access-token`
  Inject this failure at the token request, the resource call, or both.
- `--failure-stage-bad-resource-path`
  Inject this failure at the token request, the resource call, or both.
- `--failure-stage-bad-token-grant`
  Inject this failure at the token request, the resource call, or both.
- `--pair-profiles`
  JSON file with per-pair overrides for failure ratios, weights, and stages.
- `--report`
  JSON report output path.
- `--html-report`
  HTML report output path. If omitted but `--report` is set, the tool also writes a sibling `.html` report automatically.
- `--discover`
  Discovery-only mode.
- `--dry-run`
  Print the resolved run plan and exit without sending traffic.
- `--verbose`
  Reserved for future detailed logging.

## Report Output

The JSON report includes:

- run configuration summary
- discovery output
- workflow attempts / successes / failures
- per-step stats
  - participant token
  - token request
  - resource call
  - refresh token
- peak concurrent workflows and peak concurrent requests
- p50 / p95 / p99 latency per step
- category breakdown
  - oauth
  - direct
- per-pair breakdown
- failure reason counts
- HTML report with:
  - summary cards
  - chart-style bars
  - step latency table
  - per-pair table
  - category table
  - full raw JSON appendix

## Controlling Failure Scenarios

Use `--failure-ratio` to decide how often failure workflows run, then use:

- `--failure-modes`
- `--failure-weight-*`
- `--failure-stage-*`
- `--pair-profiles`

to control which failure types are selected inside those failing iterations.

Example:

```bash
python main.py \
  --db-url postgresql://prism:changeme@localhost:5432/prism \
  --prism-origin http://localhost:3000 \
  --users example-users.json \
  --concurrency 20 \
  --duration 120 \
  --resource-calls-per-workflow 3 \
  --success-ratio 60 \
  --failure-ratio 40 \
  --failure-modes invalid-access-token,bad-resource-path \
  --failure-weight-invalid-access-token 3 \
  --failure-weight-bad-resource-path 1 \
  --failure-stage-invalid-access-token resource \
  --failure-stage-bad-resource-path resource
```

This means:

- 60% of iterations use the normal success flow
- 40% of iterations use failure flows
- among failures:
  - invalid access token is chosen about 3x as often as bad resource path

If you also pass `--pair-profiles example-pair-profiles.json`, matching pairs can override:

- success/failure ratios
- enabled failure modes
- failure weights
- failure stages
- `resource_path`
- `bad_resource_path`

## Direct Server Workflows

If you pass `--include-direct`, the tool also discovers active generic servers and runs direct workflows against them.

Each direct workflow does this:

1. call Prism `POST /api/token/current`
2. get the participant token
3. call the direct server with the participant token header

Failure modes for direct servers currently apply at the resource stage:

- `missing-participant-header`
- `invalid-participant-token`
- `bad-resource-path`

You can also override direct server paths with `pair profiles`, using keys like:

```json
{
  "Direct -> API X": {
    "resource_path": "/actuator/health",
    "bad_resource_path": "/missing"
  }
}
```

## Tests

Run the lightweight unit tests with:

```bash
cd simulators/oauth-stress
PYTHONPATH=. python3 -m unittest discover -s tests -v
```

## Notes

- The tool derives user-facing base URLs from Prism server configuration, using the same user-facing URL rule used by the app.
- Success pipelines are inferred from server config, not historical traffic.
- If a resource server has no linked authentication server, it is skipped and reported in discovery.
- If a discovered authentication server has no token endpoint configured, its linked resource servers are skipped.
