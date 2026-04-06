from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from oauth_stress.config import load_users, parse_args
from oauth_stress.discovery import discover_from_db
from oauth_stress.profiles import direct_failure_capability_warnings
from oauth_stress.reporting import ReportCollector
from oauth_stress.workflows import choose_target_name, run_load


def print_discovery(result: dict) -> None:
  print(json.dumps(result, indent=2, sort_keys=True))


def print_discovery_summary(result: dict) -> None:
  print('Discovery summary:')
  print(f'  participant header: {result["participant_header_name"]}')
  print(f'  auth servers: {len(result["auth_servers"])}')
  print(f'  resource servers: {len(result["resource_servers"])}')
  print(f'  direct servers: {len(result["direct_servers"])}')
  print(f'  oauth pairs: {len(result["pairs"])}')
  if result['pair_profile_matches']:
    print('  pair profile matches:')
    for match in result['pair_profile_matches']:
      print(f'    - {match["pair"]}')
  if result['pair_profile_warnings']:
    print('  pair profile warnings:')
    for warning in result['pair_profile_warnings']:
      print(f'    - {warning}')
  if result.get('runtime_warnings'):
    print('  runtime warnings:')
    for warning in result['runtime_warnings']:
      print(f'    - {warning}')
  if result['skipped']:
    print('  skipped:')
    for item in result['skipped']:
      print(f'    - {item["name"]}: {item["reason"]}')


def print_dry_run(config: dict, discovery: dict) -> None:
  print('Dry run plan:')
  print(f'  prism origin: {config["prism_origin"]}')
  print(f'  concurrency: {config["concurrency"]}')
  print(f'  duration_seconds: {config["duration_seconds"]}')
  print(f'  include_direct: {config["include_direct"]}')
  print(f'  success_ratio/failure_ratio: {config["success_ratio"]}/{config["failure_ratio"]}')
  print(f'  renew_ratio: {config["renew_ratio"]}')
  print(f'  users_count: {config["users_count"]}')
  print(f'  resource_path: {config["resource_path"]}')
  print(f'  bad_resource_path: {config["bad_resource_path"]}')
  print('  oauth pairs:')
  for pair in discovery['pairs']:
    print(f'    - {pair["auth_server"]["name"]} -> {pair["resource_server"]["name"]}')
  if config['include_direct']:
    print('  direct servers:')
    for server in discovery['direct_servers']:
      print(f'    - {server["name"]}')


async def async_main() -> int:
  config = parse_args()
  users = load_users(config.users_file)
  discovery = discover_from_db(
    config.db_url,
    auth_server_filter=config.auth_server_filter,
    resource_server_filter=config.resource_server_filter,
    pair_profiles=config.pair_profiles,
  )
  runtime_warnings = direct_failure_capability_warnings(
    config,
    [choose_target_name(server) for server in discovery.direct_servers] if config.include_direct else [],
  )
  discovery_payload = discovery.as_dict()
  discovery_payload['runtime_warnings'] = runtime_warnings

  if config.discover_only:
    print_discovery_summary(discovery_payload)
    print()
    print_discovery(discovery_payload)
    return 0

  planned_config = {
    'prism_origin': config.prism_origin,
    'concurrency': config.concurrency,
    'duration_seconds': config.duration_seconds,
    'ramp_up_seconds': config.ramp_up_seconds,
    'loop_delay_seconds': config.loop_delay_seconds,
    'resource_path': config.resource_path,
    'bad_resource_path': config.bad_resource_path,
    'include_direct': config.include_direct,
    'success_ratio': config.success_ratio,
    'failure_ratio': config.failure_ratio,
    'renew_ratio': config.renew_ratio,
    'failure_modes': list(config.failure_modes),
    'failure_stages': config.failure_stages,
    'pair_profile_path': str(config.pair_profile_path) if config.pair_profile_path else None,
    'html_report_path': str(config.html_report_path) if config.html_report_path else None,
    'users_count': len(users),
  }

  if config.dry_run:
    print_discovery_summary(discovery_payload)
    print()
    print_dry_run(planned_config, discovery_payload)
    return 0

  if not discovery.pairs and not (config.include_direct and discovery.direct_servers):
    print('Fatal error: no usable workload targets were discovered', file=sys.stderr)
    return 1

  collector = ReportCollector()
  await run_load(config, discovery.pairs, discovery.direct_servers, users, collector)
  report = {
    'config': planned_config,
    'discovery': discovery_payload,
    'results': collector.as_dict(),
  }

  print(json.dumps(report['results'], indent=2, sort_keys=True))
  html_report_path = config.html_report_path
  if not html_report_path and config.report_path:
    html_report_path = config.report_path.with_suffix('.html')
  if config.report_path:
    collector.write_json(config.report_path, report)
    print(f'\nReport written to {config.report_path}', flush=True)
  if html_report_path:
    collector.write_html(html_report_path, report)
    print(f'HTML report written to {html_report_path}', flush=True)
  return 0


def main() -> int:
  try:
    return asyncio.run(async_main())
  except KeyboardInterrupt:
    print('\nInterrupted.', file=sys.stderr)
    return 130
  except Exception as exc:
    print(f'Fatal error: {exc}', file=sys.stderr)
    return 1


if __name__ == '__main__':
  raise SystemExit(main())
