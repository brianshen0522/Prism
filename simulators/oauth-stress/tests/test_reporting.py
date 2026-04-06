from __future__ import annotations

import unittest

from oauth_stress.reporting import ReportCollector


class ReportingTests(unittest.TestCase):
  def test_category_breakdown_separates_oauth_and_direct(self) -> None:
    collector = ReportCollector()
    collector.record_workflow('success', True, 'Auth A -> Resource A')
    collector.record_workflow('failure:bad-resource-path', False, 'Direct -> API X', 'bad-resource-path')
    payload = collector.as_dict()
    self.assertEqual(payload['categories']['oauth']['workflow_successes'], 1)
    self.assertEqual(payload['categories']['direct']['workflow_failures'], 1)

  def test_workflow_classification_splits_expected_and_unexpected_outcomes(self) -> None:
    collector = ReportCollector()
    collector.record_workflow('success', False, 'Auth A -> Resource A', 'resource-call-failed')
    collector.record_workflow('failure:invalid-access-token', False, 'Auth A -> Resource A', 'invalid-access-token')
    collector.record_workflow('failure:bad-resource-path', True, 'Auth A -> Resource A')
    payload = collector.as_dict()
    self.assertEqual(payload['workflow_classification']['expected_failures'], 1)
    self.assertEqual(payload['workflow_classification']['unexpected_failures'], 0)
    self.assertEqual(payload['workflow_classification']['upstream_failures_excluded'], 1)
    self.assertEqual(payload['workflow_classification']['failure_workflows_unexpected_successes'], 1)

  def test_upstream_failures_are_excluded_from_adjusted_metrics(self) -> None:
    collector = ReportCollector()
    collector.record_workflow('success', True, 'Auth A -> Resource A')
    collector.record_workflow('success', False, 'Auth A -> Resource A', 'token-request-failed')
    collector.record_workflow('success', False, 'Auth A -> Resource A', 'participant-token-failed')
    payload = collector.as_dict()
    self.assertEqual(payload['upstream_failure_reasons']['token-request-failed'], 1)
    self.assertEqual(payload['unexpected_failure_reasons']['participant-token-failed'], 1)
    self.assertEqual(payload['prism_adjusted']['workflow_attempts'], 2)
    self.assertEqual(payload['prism_adjusted']['workflow_failures'], 1)
    self.assertEqual(payload['prism_adjusted']['workflow_successes'], 1)

  def test_request_peak_tracking_is_reported_separately(self) -> None:
    collector = ReportCollector()
    collector.request_started('Auth A -> Resource A')
    collector.request_started('Auth A -> Resource A')
    collector.request_finished('Auth A -> Resource A')
    payload = collector.as_dict()
    self.assertEqual(payload['peak_requests_in_flight'], 2)
    self.assertEqual(payload['peak_pair_requests_in_flight']['Auth A -> Resource A'], 2)
