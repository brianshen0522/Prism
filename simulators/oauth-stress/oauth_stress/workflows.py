from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass
from itertools import cycle
from typing import Any, Union
from urllib.parse import urljoin

from .client import StepResult, StressHttpClient
from .config import FailureMode, StressConfig, UserCredential
from .discovery import DirectServer, OAuthPair
from .failures import classify_participant_token_failure
from .profiles import direct_failure_capability_warnings, merged_failure_settings, target_paths
from .reporting import ReportCollector


@dataclass(frozen=True)
class RuntimeSelection:
  target: Union[OAuthPair, DirectServer]
  user: UserCredential
  workflow_kind: str
  failure_mode: FailureMode | None
  failure_stage: str | None

  @property
  def pair(self) -> OAuthPair:
    assert isinstance(self.target, OAuthPair)
    return self.target


def choose_pair_name(pair: OAuthPair) -> str:
  return f'{pair.auth_server.name} -> {pair.resource_server.name}'


def choose_target_name(target: Union[OAuthPair, DirectServer]) -> str:
  if isinstance(target, OAuthPair):
    return choose_pair_name(target)
  return f'Direct -> {target.name}'


async def tracked_post_json(
  client: StressHttpClient,
  collector: ReportCollector,
  pair_name: str,
  url: str,
  payload: dict[str, Any],
  headers: dict[str, str] | None = None,
  verify: bool = True,
) -> StepResult:
  collector.request_started(pair_name)
  try:
    return await client.post_json(url, payload, headers=headers, verify=verify)
  finally:
    collector.request_finished(pair_name)


async def tracked_get(
  client: StressHttpClient,
  collector: ReportCollector,
  pair_name: str,
  url: str,
  headers: dict[str, str] | None = None,
  verify: bool = True,
) -> StepResult:
  collector.request_started(pair_name)
  try:
    return await client.get(url, headers=headers, verify=verify)
  finally:
    collector.request_finished(pair_name)


def select_workflow_kind(config: StressConfig, pair_name: str, rng: random.Random) -> tuple[str, FailureMode | None, str | None]:
  success_ratio, failure_ratio, weights_by_mode, stages_by_mode, modes = merged_failure_settings(config, pair_name)
  total = success_ratio + failure_ratio
  if total <= 0:
    success_ratio = config.success_ratio
    failure_ratio = config.failure_ratio
    total = success_ratio + failure_ratio
  if total <= 0:
    return 'success', None, None
  pick = rng.uniform(0, total)
  if pick <= success_ratio:
    return 'success', None, None
  weighted_modes = [mode for mode in modes if weights_by_mode.get(mode, 0) > 0]
  if not weighted_modes:
    return 'success', None, None
  weights = [weights_by_mode[mode] for mode in weighted_modes]
  mode = rng.choices(weighted_modes, weights=weights, k=1)[0]
  return 'failure', mode, stages_by_mode.get(mode, 'both')


async def run_load(
  config: StressConfig,
  pairs: list[OAuthPair],
  direct_servers: list[DirectServer],
  users: list[UserCredential],
  collector: ReportCollector,
) -> None:
  targets: list[Union[OAuthPair, DirectServer]] = list(pairs)
  if config.include_direct:
    targets.extend(direct_servers)

  if not targets:
    collector.mark_skipped_pair('no usable OAuth pairs or direct servers discovered')
    return

  client = StressHttpClient()
  stop_at = time.monotonic() + config.duration_seconds
  target_cycle = cycle(targets)
  user_cycle = cycle(users)

  async def worker(worker_index: int) -> None:
    rng = random.Random(worker_index + int(time.time()))
    if config.ramp_up_seconds > 0:
      await asyncio.sleep((config.ramp_up_seconds / max(config.concurrency, 1)) * worker_index)
    while time.monotonic() < stop_at:
      target = next(target_cycle)
      user = next(user_cycle)
      pair_name = choose_target_name(target)
      workflow_kind, failure_mode, failure_stage = select_workflow_kind(config, pair_name, rng)
      selection = RuntimeSelection(target=target, user=user, workflow_kind=workflow_kind, failure_mode=failure_mode, failure_stage=failure_stage)
      collector.workflow_started(pair_name)
      try:
        ok, reason = await execute_workflow(config, client, selection, collector, rng)
      finally:
        collector.workflow_finished(pair_name)
      collector.record_workflow(workflow_kind if workflow_kind == 'success' or not failure_mode else f'failure:{failure_mode}', ok, pair_name, reason)
      if config.loop_delay_seconds > 0:
        await asyncio.sleep(config.loop_delay_seconds)

  async def reporter() -> None:
    while time.monotonic() < stop_at:
      await asyncio.sleep(5)
      print(collector.summary_line(), flush=True)

  workers = [asyncio.create_task(worker(index)) for index in range(config.concurrency)]
  reporter_task = asyncio.create_task(reporter())
  try:
    await asyncio.gather(*workers)
  finally:
    reporter_task.cancel()
    await client.aclose()


async def execute_workflow(
  config: StressConfig,
  client: StressHttpClient,
  selection: RuntimeSelection,
  collector: ReportCollector,
  rng: random.Random,
) -> tuple[bool, str | None]:
  if isinstance(selection.target, DirectServer):
    return await execute_direct_workflow(config, client, selection, collector)

  participant = await get_participant_token(config, client, selection.user, collector, selection.pair)
  if not participant.ok or not participant.payload or not participant.payload.get('token'):
    return False, classify_participant_token_failure(participant)

  participant_token = str(participant.payload['token'])
  participant_header_name = str(participant.payload.get('header_name') or 'X-Participant-Token')

  token_grant = await request_access_token(
    config,
    client,
    selection,
    collector,
    participant_header_name,
    participant_token,
  )
  if not token_grant.ok or not token_grant.payload:
    return _expected_result_for_failure(selection.failure_mode, token_grant, 'token-request-failed')

  access_token = token_grant.payload.get('access_token')
  refresh_token = token_grant.payload.get('refresh_token')
  if not isinstance(access_token, str) or not access_token:
    return _expected_result_for_failure(selection.failure_mode, token_grant, 'missing-access-token')

  for _ in range(config.resource_calls_per_workflow):
    resource_result = await call_resource(
      config,
      client,
      selection,
      collector,
      participant_header_name,
      participant_token,
      access_token,
    )
    if selection.workflow_kind == 'failure':
      return (not resource_result.ok), selection.failure_mode or 'expected-failure'
    if not resource_result.ok:
      return False, 'resource-call-failed'

  if refresh_token and rng.randint(1, 100) <= config.renew_ratio:
    refresh_result = await request_refresh_token(
      config,
      client,
      selection,
      collector,
      participant_header_name,
      participant_token,
      refresh_token,
    )
    if refresh_result.ok and refresh_result.payload and isinstance(refresh_result.payload.get('access_token'), str):
      refreshed_access_token = str(refresh_result.payload['access_token'])
      for _ in range(config.resource_calls_per_workflow):
        refreshed_resource = await call_resource(
          config,
          client,
          selection,
          collector,
          participant_header_name,
          participant_token,
          refreshed_access_token,
        )
        if not refreshed_resource.ok:
          return False, 'refresh-resource-call-failed'
    else:
      return False, 'refresh-token-failed'

  return True, None


async def get_participant_token(
  config: StressConfig,
  client: StressHttpClient,
  user: UserCredential,
  collector: ReportCollector,
  pair: OAuthPair,
) -> StepResult:
  pair_name = choose_pair_name(pair)
  result = await tracked_post_json(
    client,
    collector,
    pair_name,
    f'{config.prism_origin}/api/token/current',
    {'username': user.username, 'password': user.password},
  )
  collector.record_step('participant_token', result.ok, result.latency_ms, pair_name)
  return result


async def execute_direct_workflow(
  config: StressConfig,
  client: StressHttpClient,
  selection: RuntimeSelection,
  collector: ReportCollector,
) -> tuple[bool, str | None]:
  direct = selection.target
  assert isinstance(direct, DirectServer)
  target_name = choose_target_name(direct)
  participant = await tracked_post_json(
    client,
    collector,
    target_name,
    f'{config.prism_origin}/api/token/current',
    {'username': selection.user.username, 'password': selection.user.password},
  )
  collector.record_step('participant_token', participant.ok, participant.latency_ms, target_name)
  if not participant.ok or not participant.payload or not participant.payload.get('token'):
    return False, classify_participant_token_failure(participant)

  participant_token = str(participant.payload['token'])
  participant_header_name = str(participant.payload.get('header_name') or 'X-Participant-Token')
  headers = {participant_header_name: participant_token}
  resource_path, bad_resource_path = target_paths(config, target_name)

  if selection.workflow_kind == 'failure':
    if selection.failure_stage in {'resource', 'both'} and selection.failure_mode == 'missing-participant-header':
      headers.pop(participant_header_name, None)
    elif selection.failure_stage in {'resource', 'both'} and selection.failure_mode == 'invalid-participant-token':
      headers[participant_header_name] = 'invalid-participant-token'
    elif selection.failure_stage in {'resource', 'both'} and selection.failure_mode == 'bad-resource-path':
      resource_path = bad_resource_path

  result = await tracked_get(
    client,
    collector,
    target_name,
    urljoin(direct.base_url, resource_path.lstrip('/')),
    headers=headers,
    verify=direct.tls_verify,
  )
  collector.record_step('direct_call', result.ok, result.latency_ms, choose_target_name(direct))
  if selection.workflow_kind == 'failure':
    return (not result.ok), selection.failure_mode or 'expected-failure'
  if not result.ok:
    return False, 'direct-call-failed'
  return True, None

async def request_access_token(
  config: StressConfig,
  client: StressHttpClient,
  selection: RuntimeSelection,
  collector: ReportCollector,
  participant_header_name: str,
  participant_token: str,
) -> StepResult:
  headers = {
    'Content-Type': 'application/json',
    participant_header_name: participant_token,
  }
  body: dict[str, Any] = {'grant_type': 'client_credentials'}
  if selection.workflow_kind == 'failure':
    if selection.failure_stage in {'token', 'both'} and selection.failure_mode == 'missing-participant-header':
      headers.pop(participant_header_name, None)
    elif selection.failure_stage in {'token', 'both'} and selection.failure_mode == 'invalid-participant-token':
      headers[participant_header_name] = 'invalid-participant-token'
    elif selection.failure_stage in {'token', 'both'} and selection.failure_mode == 'bad-token-grant':
      body = {'grant_type': 'invalid_grant'}

  pair_name = choose_pair_name(selection.pair)
  result = await tracked_post_json(
    client,
    collector,
    pair_name,
    selection.pair.auth_server.token_endpoint or selection.pair.auth_server.base_url,
    body,
    headers=headers,
    verify=selection.pair.auth_server.tls_verify,
  )
  collector.record_step('token_request', result.ok, result.latency_ms, pair_name)
  return result


async def call_resource(
  config: StressConfig,
  client: StressHttpClient,
  selection: RuntimeSelection,
  collector: ReportCollector,
  participant_header_name: str,
  participant_token: str,
  access_token: str,
) -> StepResult:
  target_name = choose_pair_name(selection.pair)
  resource_path, bad_resource_path = target_paths(config, target_name)
  headers = {
    'Authorization': f'Bearer {access_token}',
    participant_header_name: participant_token,
  }

  if selection.workflow_kind == 'failure':
    if selection.failure_stage in {'resource', 'both'} and selection.failure_mode == 'missing-participant-header':
      headers.pop(participant_header_name, None)
    elif selection.failure_stage in {'resource', 'both'} and selection.failure_mode == 'invalid-participant-token':
      headers[participant_header_name] = 'invalid-participant-token'
    elif selection.failure_stage in {'resource', 'both'} and selection.failure_mode == 'invalid-access-token':
      headers['Authorization'] = 'Bearer invalid-access-token'
    elif selection.failure_stage in {'resource', 'both'} and selection.failure_mode == 'bad-resource-path':
      resource_path = bad_resource_path

  result = await tracked_get(
    client,
    collector,
    target_name,
    urljoin(selection.pair.resource_server.base_url, resource_path.lstrip('/')),
    headers=headers,
    verify=selection.pair.resource_server.tls_verify,
  )
  collector.record_step('resource_call', result.ok, result.latency_ms, choose_pair_name(selection.pair))
  return result


async def request_refresh_token(
  config: StressConfig,
  client: StressHttpClient,
  selection: RuntimeSelection,
  collector: ReportCollector,
  participant_header_name: str,
  participant_token: str,
  refresh_token: str,
) -> StepResult:
  pair_name = choose_pair_name(selection.pair)
  result = await tracked_post_json(
    client,
    collector,
    pair_name,
    selection.pair.auth_server.token_endpoint or selection.pair.auth_server.base_url,
    {
      'grant_type': 'refresh_token',
      'refresh_token': refresh_token,
    },
    headers={
      'Content-Type': 'application/json',
      participant_header_name: participant_token,
    },
    verify=selection.pair.auth_server.tls_verify,
  )
  collector.record_step('refresh_token', result.ok, result.latency_ms, pair_name)
  return result


def _expected_result_for_failure(
  failure_mode: FailureMode | None,
  result: StepResult,
  default_reason: str,
) -> tuple[bool, str]:
  if failure_mode:
    return (not result.ok), failure_mode
  return False, default_reason
