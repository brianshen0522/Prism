from __future__ import annotations

import unittest
from types import SimpleNamespace

from oauth_stress.config import StressConfig
from oauth_stress.failures import classify_participant_token_failure
from oauth_stress.profiles import direct_failure_capability_warnings, target_paths


class WorkflowHelperTests(unittest.TestCase):
  def _config(self) -> StressConfig:
    return StressConfig(
      db_url='postgresql://example',
      prism_origin='http://localhost:3000',
      users_file=None,  # type: ignore[arg-type]
      concurrency=1,
      duration_seconds=1,
      ramp_up_seconds=0,
      loop_delay_seconds=0.0,
      resource_path='/default',
      bad_resource_path='/bad-default',
      resource_calls_per_workflow=2,
      auth_server_filter=None,
      resource_server_filter=None,
      include_direct=True,
      success_ratio=80,
      failure_ratio=20,
      renew_ratio=0,
      report_path=None,
      html_report_path=None,
      discover_only=False,
      dry_run=False,
      verbose=False,
      failure_modes=('missing-participant-header', 'bad-resource-path'),
      failure_weights={
        'missing-participant-header': 1,
        'invalid-participant-token': 0,
        'invalid-access-token': 0,
        'bad-resource-path': 1,
        'bad-token-grant': 0,
      },
      failure_stages={
        'missing-participant-header': 'token',
        'invalid-participant-token': 'resource',
        'invalid-access-token': 'resource',
        'bad-resource-path': 'resource',
        'bad-token-grant': 'token',
      },
      pair_profile_path=None,
      pair_profiles={
        'Direct -> API X': {
          'resource_path': '/override',
          'bad_resource_path': '/override-bad',
          'failure_stages': {'missing-participant-header': 'token'},
        },
      },
    )

  def test_target_paths_use_profile_override(self) -> None:
    resource_path, bad_resource_path = target_paths(self._config(), 'Direct -> API X')
    self.assertEqual(resource_path, '/override')
    self.assertEqual(bad_resource_path, '/override-bad')

  def test_direct_failure_warning_reports_token_only_modes(self) -> None:
    warnings = direct_failure_capability_warnings(self._config(), ['Direct -> API X'])
    self.assertEqual(len(warnings), 1)
    self.assertIn('token-stage-only failure modes', warnings[0])

  def test_classify_participant_token_failure_http_status(self) -> None:
    reason = classify_participant_token_failure(
      SimpleNamespace(ok=False, status_code=401, latency_ms=100.0, payload={'error': 'Invalid credentials'}, error=None)
    )
    self.assertEqual(reason, 'participant-token-http-401')

  def test_classify_participant_token_failure_timeout_or_network(self) -> None:
    reason = classify_participant_token_failure(
      SimpleNamespace(ok=False, status_code=None, latency_ms=30000.0, payload=None, error='timed out')
    )
    self.assertEqual(reason, 'participant-token-timeout-or-network')

  def test_classify_participant_token_failure_missing_token(self) -> None:
    reason = classify_participant_token_failure(
      SimpleNamespace(ok=True, status_code=200, latency_ms=50.0, payload={'header_name': 'X-Participant-Token'}, error=None)
    )
    self.assertEqual(reason, 'participant-token-missing-token')
