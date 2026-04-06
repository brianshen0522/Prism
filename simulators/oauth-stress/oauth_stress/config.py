from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse


FailureMode = Literal[
  'missing-participant-header',
  'invalid-participant-token',
  'invalid-access-token',
  'bad-resource-path',
  'bad-token-grant',
]

FailureStage = Literal['token', 'resource', 'both']


@dataclass(frozen=True)
class UserCredential:
  username: str
  password: str


@dataclass(frozen=True)
class StressConfig:
  db_url: str
  prism_origin: str
  users_file: Path
  concurrency: int
  duration_seconds: int
  ramp_up_seconds: int
  loop_delay_seconds: float
  resource_path: str
  bad_resource_path: str
  resource_calls_per_workflow: int
  auth_server_filter: str | None
  resource_server_filter: str | None
  include_direct: bool
  success_ratio: int
  failure_ratio: int
  renew_ratio: int
  report_path: Path | None
  html_report_path: Path | None
  discover_only: bool
  dry_run: bool
  verbose: bool
  failure_modes: tuple[FailureMode, ...]
  failure_weights: dict[FailureMode, int]
  failure_stages: dict[FailureMode, FailureStage]
  pair_profile_path: Path | None
  pair_profiles: dict[str, dict[str, Any]]


def _positive_int(value: str) -> int:
  parsed = int(value, 10)
  if parsed <= 0:
    raise argparse.ArgumentTypeError('must be a positive integer')
  return parsed


def _non_negative_int(value: str) -> int:
  parsed = int(value, 10)
  if parsed < 0:
    raise argparse.ArgumentTypeError('must be a non-negative integer')
  return parsed


def _non_negative_float(value: str) -> float:
  parsed = float(value)
  if parsed < 0:
    raise argparse.ArgumentTypeError('must be a non-negative number')
  return parsed


def _origin(value: str) -> str:
  parsed = urlparse(value)
  if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
    raise argparse.ArgumentTypeError('must be a valid http/https origin')
  return value.rstrip('/')


def _path(value: str) -> str:
  if not value.startswith('/'):
    raise argparse.ArgumentTypeError('must start with "/"')
  return value


def parse_args(argv: list[str] | None = None) -> StressConfig:
  parser = argparse.ArgumentParser(
    description='Stress test Prism OAuth workflows by discovering auth/resource pairs from the Prism database.',
  )
  parser.add_argument('--db-url', default=os.getenv('PRISM_DATABASE_URL'), help='Prism PostgreSQL connection string. Defaults to PRISM_DATABASE_URL.')
  parser.add_argument('--prism-origin', required=True, type=_origin, help='Prism web origin, for example https://prism.example.org')
  parser.add_argument('--users', required=True, type=Path, help='Path to the JSON file containing username/password pairs.')
  parser.add_argument('--concurrency', type=_positive_int, default=10, help='Number of concurrent workers.')
  parser.add_argument('--duration', dest='duration_seconds', type=_positive_int, default=60, help='Total test duration in seconds.')
  parser.add_argument('--ramp-up', dest='ramp_up_seconds', type=_non_negative_int, default=0, help='Ramp-up duration in seconds.')
  parser.add_argument('--loop-delay', dest='loop_delay_seconds', type=_non_negative_float, default=0.0, help='Optional delay between workflow loops, in seconds.')
  parser.add_argument('--resource-path', type=_path, default='/', help='Path to call on every discovered resource server for success workflows.')
  parser.add_argument('--bad-resource-path', type=_path, default='/__stress_invalid_path__', help='Path to use for bad-resource-path failure workflows.')
  parser.add_argument('--resource-calls-per-workflow', type=_positive_int, default=2, help='How many resource requests to send per token-bearing workflow phase. Applies to the initial access token and again after refresh when refresh is used.')
  parser.add_argument('--resource-server', dest='resource_server_filter', help='Only test the named resource server.')
  parser.add_argument('--include-direct', action='store_true', help='Also stress direct-access generic servers discovered from Prism.')
  parser.add_argument('--auth-server', dest='auth_server_filter', help='Only test the named authentication server.')
  parser.add_argument('--success-ratio', type=_non_negative_int, default=80, help='Percentage of workflow iterations that should use the success path.')
  parser.add_argument('--failure-ratio', type=_non_negative_int, default=20, help='Percentage of workflow iterations that should use failure paths.')
  parser.add_argument('--renew-ratio', type=_non_negative_int, default=25, help='Percentage of successful iterations that should try a refresh-token flow when refresh_token is available.')
  parser.add_argument('--report', dest='report_path', type=Path, help='Optional path to write the final JSON report.')
  parser.add_argument('--html-report', dest='html_report_path', type=Path, help='Optional path to write the final HTML report.')
  parser.add_argument('--discover', dest='discover_only', action='store_true', help='Print discovered pairs and exit.')
  parser.add_argument('--dry-run', action='store_true', help='Print the resolved run plan and exit without sending traffic.')
  parser.add_argument('--verbose', action='store_true', help='Enable verbose logging.')
  parser.add_argument(
    '--failure-modes',
    default='missing-participant-header,invalid-participant-token,invalid-access-token,bad-resource-path,bad-token-grant',
    help='Comma-separated failure modes to use.',
  )
  parser.add_argument('--failure-weight-missing-participant-header', type=_non_negative_int, default=1, help='Relative weight for missing-participant-header failures.')
  parser.add_argument('--failure-weight-invalid-participant-token', type=_non_negative_int, default=1, help='Relative weight for invalid-participant-token failures.')
  parser.add_argument('--failure-weight-invalid-access-token', type=_non_negative_int, default=1, help='Relative weight for invalid-access-token failures.')
  parser.add_argument('--failure-weight-bad-resource-path', type=_non_negative_int, default=1, help='Relative weight for bad-resource-path failures.')
  parser.add_argument('--failure-weight-bad-token-grant', type=_non_negative_int, default=1, help='Relative weight for bad-token-grant failures.')
  parser.add_argument('--failure-stage-missing-participant-header', default='both', choices=['token', 'resource', 'both'], help='Where to inject missing-participant-header failures.')
  parser.add_argument('--failure-stage-invalid-participant-token', default='both', choices=['token', 'resource', 'both'], help='Where to inject invalid-participant-token failures.')
  parser.add_argument('--failure-stage-invalid-access-token', default='resource', choices=['token', 'resource', 'both'], help='Where to inject invalid-access-token failures.')
  parser.add_argument('--failure-stage-bad-resource-path', default='resource', choices=['token', 'resource', 'both'], help='Where to inject bad-resource-path failures.')
  parser.add_argument('--failure-stage-bad-token-grant', default='token', choices=['token', 'resource', 'both'], help='Where to inject bad-token-grant failures.')
  parser.add_argument('--pair-profiles', dest='pair_profile_path', type=Path, help='Optional JSON file that overrides failure settings for specific auth/resource pairs.')
  args = parser.parse_args(argv)

  if not args.db_url:
    parser.error('--db-url is required when PRISM_DATABASE_URL is not set')

  total_ratio = args.success_ratio + args.failure_ratio
  if total_ratio <= 0:
    parser.error('success-ratio and failure-ratio cannot both be zero')
  if args.renew_ratio < 0 or args.renew_ratio > 100:
    parser.error('renew-ratio must be between 0 and 100')

  raw_modes = [segment.strip() for segment in args.failure_modes.split(',') if segment.strip()]
  allowed_modes: set[str] = {
    'missing-participant-header',
    'invalid-participant-token',
    'invalid-access-token',
    'bad-resource-path',
    'bad-token-grant',
  }
  if not raw_modes or any(mode not in allowed_modes for mode in raw_modes):
    parser.error(f'failure-modes must be chosen from {", ".join(sorted(allowed_modes))}')

  failure_weights: dict[FailureMode, int] = {
    'missing-participant-header': args.failure_weight_missing_participant_header,
    'invalid-participant-token': args.failure_weight_invalid_participant_token,
    'invalid-access-token': args.failure_weight_invalid_access_token,
    'bad-resource-path': args.failure_weight_bad_resource_path,
    'bad-token-grant': args.failure_weight_bad_token_grant,
  }
  if args.failure_ratio > 0 and sum(failure_weights[mode] for mode in raw_modes) <= 0:
    parser.error('enabled failure modes must have at least one positive failure weight when failure-ratio > 0')

  failure_stages: dict[FailureMode, FailureStage] = {
    'missing-participant-header': args.failure_stage_missing_participant_header,
    'invalid-participant-token': args.failure_stage_invalid_participant_token,
    'invalid-access-token': args.failure_stage_invalid_access_token,
    'bad-resource-path': args.failure_stage_bad_resource_path,
    'bad-token-grant': args.failure_stage_bad_token_grant,
  }

  pair_profiles = load_pair_profiles(args.pair_profile_path) if args.pair_profile_path else {}

  return StressConfig(
    db_url=args.db_url,
    prism_origin=args.prism_origin,
    users_file=args.users,
    concurrency=args.concurrency,
    duration_seconds=args.duration_seconds,
    ramp_up_seconds=args.ramp_up_seconds,
    loop_delay_seconds=args.loop_delay_seconds,
    resource_path=args.resource_path,
    bad_resource_path=args.bad_resource_path,
    resource_calls_per_workflow=args.resource_calls_per_workflow,
    auth_server_filter=args.auth_server_filter,
    resource_server_filter=args.resource_server_filter,
    include_direct=args.include_direct,
    success_ratio=args.success_ratio,
    failure_ratio=args.failure_ratio,
    renew_ratio=args.renew_ratio,
    report_path=args.report_path,
    html_report_path=args.html_report_path,
    discover_only=args.discover_only,
    dry_run=args.dry_run,
    verbose=args.verbose,
    failure_modes=tuple(raw_modes),  # type: ignore[arg-type]
    failure_weights=failure_weights,
    failure_stages=failure_stages,
    pair_profile_path=args.pair_profile_path,
    pair_profiles=pair_profiles,
  )


def load_users(path: Path) -> list[UserCredential]:
  raw = json.loads(path.read_text(encoding='utf-8'))
  if not isinstance(raw, list) or not raw:
    raise ValueError('users file must contain a non-empty JSON array')

  users: list[UserCredential] = []
  for index, item in enumerate(raw):
    if not isinstance(item, dict):
      raise ValueError(f'users[{index}] must be an object')
    username = item.get('username')
    password = item.get('password')
    if not isinstance(username, str) or not username:
      raise ValueError(f'users[{index}].username must be a non-empty string')
    if not isinstance(password, str) or not password:
      raise ValueError(f'users[{index}].password must be a non-empty string')
    users.append(UserCredential(username=username, password=password))
  return users


def load_pair_profiles(path: Path) -> dict[str, dict[str, Any]]:
  raw = json.loads(path.read_text(encoding='utf-8'))
  if not isinstance(raw, dict):
    raise ValueError('pair profiles file must be a JSON object keyed by "<auth> -> <resource>"')

  profiles: dict[str, dict[str, Any]] = {}
  for pair_name, profile in raw.items():
    if not isinstance(pair_name, str) or not pair_name:
      raise ValueError('pair profile keys must be non-empty strings')
    if not isinstance(profile, dict):
      raise ValueError(f'pair profile "{pair_name}" must be an object')
    profiles[pair_name] = profile
  return profiles
