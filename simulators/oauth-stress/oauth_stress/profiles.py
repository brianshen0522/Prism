from __future__ import annotations

from typing import Any

from .config import FailureMode, StressConfig


def profile_for_target(config: StressConfig, target_name: str) -> dict[str, Any]:
  return config.pair_profiles.get(target_name, {})


def merged_failure_settings(config: StressConfig, target_name: str) -> tuple[int, int, dict[FailureMode, int], dict[FailureMode, str], tuple[FailureMode, ...]]:
  success_ratio = config.success_ratio
  failure_ratio = config.failure_ratio
  weights = dict(config.failure_weights)
  stages = dict(config.failure_stages)
  modes = tuple(config.failure_modes)
  profile = profile_for_target(config, target_name)

  if isinstance(profile.get('success_ratio'), int):
    success_ratio = max(profile['success_ratio'], 0)
  if isinstance(profile.get('failure_ratio'), int):
    failure_ratio = max(profile['failure_ratio'], 0)

  profile_modes = profile.get('failure_modes')
  if isinstance(profile_modes, list) and profile_modes:
    filtered = tuple(mode for mode in profile_modes if mode in weights)
    if filtered:
      modes = filtered  # type: ignore[assignment]

  profile_weights = profile.get('failure_weights')
  if isinstance(profile_weights, dict):
    for mode, weight in profile_weights.items():
      if mode in weights and isinstance(weight, int) and weight >= 0:
        weights[mode] = weight

  profile_stages = profile.get('failure_stages')
  if isinstance(profile_stages, dict):
    for mode, stage in profile_stages.items():
      if mode in stages and stage in {'token', 'resource', 'both'}:
        stages[mode] = stage

  return success_ratio, failure_ratio, weights, stages, modes


def target_paths(config: StressConfig, target_name: str) -> tuple[str, str]:
  profile = profile_for_target(config, target_name)
  resource_path = profile.get('resource_path')
  bad_resource_path = profile.get('bad_resource_path')
  return (
    resource_path if isinstance(resource_path, str) and resource_path.startswith('/') else config.resource_path,
    bad_resource_path if isinstance(bad_resource_path, str) and bad_resource_path.startswith('/') else config.bad_resource_path,
  )


def direct_failure_capability_warnings(config: StressConfig, direct_target_names: list[str]) -> list[str]:
  warnings: list[str] = []
  for target_name in direct_target_names:
    profile = profile_for_target(config, target_name)
    profile_modes = profile.get('failure_modes')
    modes = tuple(mode for mode in profile_modes if isinstance(profile_modes, list) and mode in config.failure_weights) if isinstance(profile_modes, list) else config.failure_modes
    stages = dict(config.failure_stages)
    profile_stages = profile.get('failure_stages')
    if isinstance(profile_stages, dict):
      for mode, stage in profile_stages.items():
        if mode in stages and stage in {'token', 'resource', 'both'}:
          stages[mode] = stage
    ineffective = [mode for mode in modes if stages.get(mode) == 'token']
    if ineffective:
      warnings.append(
        f'{target_name} has token-stage-only failure modes that do not affect direct workflows: {", ".join(sorted(ineffective))}',
      )
  return warnings
