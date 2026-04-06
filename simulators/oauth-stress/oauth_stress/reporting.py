from __future__ import annotations

import html
import json
import math
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from statistics import median
from typing import Any


UPSTREAM_FAILURE_REASONS = {
  'token-request-failed',
  'resource-call-failed',
  'refresh-token-failed',
  'refresh-resource-call-failed',
  'missing-access-token',
  'direct-call-failed',
}


def _percentile(values: list[float], p: float) -> float | None:
  if not values:
    return None
  ordered = sorted(values)
  if len(ordered) == 1:
    return ordered[0]
  rank = (len(ordered) - 1) * p
  lower = math.floor(rank)
  upper = math.ceil(rank)
  if lower == upper:
    return ordered[lower]
  lower_value = ordered[lower]
  upper_value = ordered[upper]
  return lower_value + (upper_value - lower_value) * (rank - lower)


@dataclass
class StepStats:
  attempts: int = 0
  successes: int = 0
  failures: int = 0
  latencies_ms: list[float] = field(default_factory=list)

  def record(self, ok: bool, latency_ms: float) -> None:
    self.attempts += 1
    self.latencies_ms.append(latency_ms)
    if ok:
      self.successes += 1
    else:
      self.failures += 1

  def as_dict(self) -> dict[str, Any]:
    return {
      'attempts': self.attempts,
      'successes': self.successes,
      'failures': self.failures,
      'p50_ms': _percentile(self.latencies_ms, 0.50),
      'p95_ms': _percentile(self.latencies_ms, 0.95),
      'p99_ms': _percentile(self.latencies_ms, 0.99),
      'median_ms': median(self.latencies_ms) if self.latencies_ms else None,
    }


class ReportCollector:
  def __init__(self) -> None:
    self.started_at = time.time()
    self.workflow_attempts = 0
    self.workflow_successes = 0
    self.workflow_failures = 0
    self.workflow_kinds: Counter[str] = Counter()
    self.failure_reasons: Counter[str] = Counter()
    self.skipped_pairs: Counter[str] = Counter()
    self.step_stats: dict[str, StepStats] = defaultdict(StepStats)
    self.per_pair: dict[str, Counter[str]] = defaultdict(Counter)
    self.category_breakdown: dict[str, Counter[str]] = defaultdict(Counter)
    self.expected_failure_reasons: Counter[str] = Counter()
    self.unexpected_failure_reasons: Counter[str] = Counter()
    self.upstream_failure_reasons: Counter[str] = Counter()
    self.unexpected_upstream_failure_reasons: Counter[str] = Counter()
    self.failure_workflow_wrong_reason_reasons: Counter[str] = Counter()
    self.failure_workflows_unexpected_successes: Counter[str] = Counter()
    self.current_workflows_in_flight = 0
    self.peak_workflows_in_flight = 0
    self.current_pair_in_flight: Counter[str] = Counter()
    self.peak_pair_in_flight: Counter[str] = Counter()
    self.current_requests_in_flight = 0
    self.peak_requests_in_flight = 0
    self.current_pair_requests_in_flight: Counter[str] = Counter()
    self.peak_pair_requests_in_flight: Counter[str] = Counter()

  def workflow_started(self, pair_name: str) -> None:
    self.current_workflows_in_flight += 1
    if self.current_workflows_in_flight > self.peak_workflows_in_flight:
      self.peak_workflows_in_flight = self.current_workflows_in_flight
    self.current_pair_in_flight[pair_name] += 1
    if self.current_pair_in_flight[pair_name] > self.peak_pair_in_flight[pair_name]:
      self.peak_pair_in_flight[pair_name] = self.current_pair_in_flight[pair_name]

  def workflow_finished(self, pair_name: str) -> None:
    if self.current_workflows_in_flight > 0:
      self.current_workflows_in_flight -= 1
    if self.current_pair_in_flight[pair_name] > 0:
      self.current_pair_in_flight[pair_name] -= 1

  def request_started(self, pair_name: str) -> None:
    self.current_requests_in_flight += 1
    if self.current_requests_in_flight > self.peak_requests_in_flight:
      self.peak_requests_in_flight = self.current_requests_in_flight
    self.current_pair_requests_in_flight[pair_name] += 1
    if self.current_pair_requests_in_flight[pair_name] > self.peak_pair_requests_in_flight[pair_name]:
      self.peak_pair_requests_in_flight[pair_name] = self.current_pair_requests_in_flight[pair_name]

  def request_finished(self, pair_name: str) -> None:
    if self.current_requests_in_flight > 0:
      self.current_requests_in_flight -= 1
    if self.current_pair_requests_in_flight[pair_name] > 0:
      self.current_pair_requests_in_flight[pair_name] -= 1

  def record_step(self, step_name: str, ok: bool, latency_ms: float, pair_name: str | None = None) -> None:
    self.step_stats[step_name].record(ok, latency_ms)
    if pair_name:
      self.per_pair[pair_name][f'{step_name}_attempts'] += 1
      if ok:
        self.per_pair[pair_name][f'{step_name}_successes'] += 1
      else:
        self.per_pair[pair_name][f'{step_name}_failures'] += 1

  def record_workflow(self, workflow_kind: str, ok: bool, pair_name: str, reason: str | None = None) -> None:
    self.workflow_attempts += 1
    self.workflow_kinds[workflow_kind] += 1
    self.per_pair[pair_name]['workflow_attempts'] += 1
    is_failure_workflow = workflow_kind.startswith('failure:')
    intended_failure = workflow_kind.split(':', 1)[1] if is_failure_workflow and ':' in workflow_kind else None
    if ok:
      self.workflow_successes += 1
      self.per_pair[pair_name]['workflow_successes'] += 1
      if is_failure_workflow and intended_failure:
        self.failure_workflows_unexpected_successes[intended_failure] += 1
        self.per_pair[pair_name][f'unexpected_success::{intended_failure}'] += 1
    else:
      self.workflow_failures += 1
      self.per_pair[pair_name]['workflow_failures'] += 1
      if reason:
        self.failure_reasons[reason] += 1
        self.per_pair[pair_name][f'failure::{reason}'] += 1
        if reason in UPSTREAM_FAILURE_REASONS:
          self.upstream_failure_reasons[reason] += 1
          self.per_pair[pair_name][f'upstream_failure::{reason}'] += 1
          if not is_failure_workflow:
            self.unexpected_upstream_failure_reasons[reason] += 1
            self.per_pair[pair_name][f'unexpected_upstream_failure::{reason}'] += 1
        elif is_failure_workflow:
          if intended_failure and reason == intended_failure:
            self.expected_failure_reasons[reason] += 1
            self.per_pair[pair_name][f'expected_failure::{reason}'] += 1
          else:
            self.failure_workflow_wrong_reason_reasons[reason] += 1
            self.per_pair[pair_name][f'failure_workflow_wrong_reason::{reason}'] += 1
        else:
          self.unexpected_failure_reasons[reason] += 1
          self.per_pair[pair_name][f'unexpected_failure::{reason}'] += 1
    category = 'direct' if pair_name.startswith('Direct -> ') else 'oauth'
    self.category_breakdown[category]['workflow_attempts'] += 1
    if ok:
      self.category_breakdown[category]['workflow_successes'] += 1
    else:
      self.category_breakdown[category]['workflow_failures'] += 1

  def mark_skipped_pair(self, reason: str) -> None:
    self.skipped_pairs[reason] += 1

  def summary_line(self) -> str:
    pair_bits = []
    for pair_name, counter in sorted(
      self.per_pair.items(),
      key=lambda item: item[1].get('workflow_attempts', 0),
      reverse=True,
    )[:3]:
      pair_bits.append(
        f'{pair_name}:'
        f'{counter.get("workflow_successes", 0)}/'
        f'{counter.get("workflow_failures", 0)}'
      )
    return (
      f'workflows={self.workflow_attempts} '
      f'peak={self.peak_workflows_in_flight} '
      f'peak_requests={self.peak_requests_in_flight} '
      f'success={self.workflow_successes} '
      f'failed={self.workflow_failures} '
      f'fail_reasons={dict(self.failure_reasons)} '
      f'top_pairs=[{"; ".join(pair_bits)}]'
    )

  def as_dict(self) -> dict[str, Any]:
    expected_failures = sum(self.expected_failure_reasons.values())
    unexpected_failures = sum(self.unexpected_failure_reasons.values())
    unexpected_successes = sum(self.failure_workflows_unexpected_successes.values())
    upstream_failures = sum(self.upstream_failure_reasons.values())
    unexpected_upstream_failures = sum(self.unexpected_upstream_failure_reasons.values())
    wrong_reason_failures = sum(self.failure_workflow_wrong_reason_reasons.values())
    success_workflow_attempts = int(self.workflow_kinds.get('success', 0))
    success_workflow_successes = max(self.workflow_successes - unexpected_successes, 0)
    success_workflow_failures = unexpected_failures + unexpected_upstream_failures
    raw_success_rate = (success_workflow_successes / success_workflow_attempts * 100) if success_workflow_attempts else 0.0
    adjusted_attempts = max(success_workflow_attempts - unexpected_upstream_failures, 0)
    adjusted_failures = unexpected_failures
    adjusted_successes = success_workflow_successes
    adjusted_success_rate = (adjusted_successes / adjusted_attempts * 100) if adjusted_attempts else 0.0
    designed_failure_attempts = self.workflow_attempts - success_workflow_attempts
    return {
      'started_at_epoch': self.started_at,
      'finished_at_epoch': time.time(),
      'workflow_attempts': self.workflow_attempts,
      'workflow_successes': self.workflow_successes,
      'workflow_failures': self.workflow_failures,
      'workflow_kinds': dict(self.workflow_kinds),
      'peak_workflows_in_flight': self.peak_workflows_in_flight,
      'peak_pair_in_flight': dict(self.peak_pair_in_flight),
      'peak_requests_in_flight': self.peak_requests_in_flight,
      'peak_pair_requests_in_flight': dict(self.peak_pair_requests_in_flight),
      'failure_reasons': dict(self.failure_reasons),
      'expected_failure_reasons': dict(self.expected_failure_reasons),
      'unexpected_failure_reasons': dict(self.unexpected_failure_reasons),
      'upstream_failure_reasons': dict(self.upstream_failure_reasons),
      'unexpected_upstream_failure_reasons': dict(self.unexpected_upstream_failure_reasons),
      'failure_workflow_wrong_reason_reasons': dict(self.failure_workflow_wrong_reason_reasons),
      'failure_workflows_unexpected_successes': dict(self.failure_workflows_unexpected_successes),
      'workflow_classification': {
        'expected_failures': expected_failures,
        'unexpected_failures': unexpected_failures,
        'upstream_failures_excluded': upstream_failures,
        'unexpected_upstream_failures': unexpected_upstream_failures,
        'failure_workflows_wrong_reason': wrong_reason_failures,
        'failure_workflows_unexpected_successes': unexpected_successes,
      },
      'prism_adjusted': {
        'workflow_attempts': adjusted_attempts,
        'workflow_successes': adjusted_successes,
        'workflow_failures': adjusted_failures,
        'success_rate_pct': adjusted_success_rate,
      },
      'success_path': {
        'workflow_attempts': success_workflow_attempts,
        'workflow_successes': success_workflow_successes,
        'workflow_failures': success_workflow_failures,
        'raw_success_rate_pct': raw_success_rate,
        'prism_adjusted_attempts': adjusted_attempts,
        'prism_adjusted_failures': adjusted_failures,
        'prism_adjusted_success_rate_pct': adjusted_success_rate,
      },
      'designed_failure_summary': {
        'workflow_attempts': designed_failure_attempts,
        'matched_expected_failures': expected_failures,
        'wrong_reason_failures': wrong_reason_failures,
        'unexpected_successes': unexpected_successes,
        'upstream_failures': upstream_failures - unexpected_upstream_failures,
      },
      'skipped_pairs': dict(self.skipped_pairs),
      'steps': {name: stats.as_dict() for name, stats in sorted(self.step_stats.items())},
      'categories': {name: dict(counter) for name, counter in sorted(self.category_breakdown.items())},
      'per_pair': {name: dict(counter) for name, counter in sorted(self.per_pair.items())},
    }

  def write_json(self, path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding='utf-8')

  def write_html(self, path: Path, payload: dict[str, Any]) -> None:
    path.write_text(render_html_report(payload), encoding='utf-8')


def render_html_report(payload: dict[str, Any]) -> str:
  config = payload.get('config', {})
  discovery = payload.get('discovery', {})
  results = payload.get('results', {})
  steps = results.get('steps', {})
  per_pair = results.get('per_pair', {})
  categories = results.get('categories', {})
  failure_reasons = results.get('failure_reasons', {})
  expected_failure_reasons = results.get('expected_failure_reasons', {})
  unexpected_failure_reasons = results.get('unexpected_failure_reasons', {})
  upstream_failure_reasons = results.get('upstream_failure_reasons', {})
  unexpected_upstream_failure_reasons = results.get('unexpected_upstream_failure_reasons', {})
  failure_workflow_wrong_reason_reasons = results.get('failure_workflow_wrong_reason_reasons', {})
  unexpected_successes = results.get('failure_workflows_unexpected_successes', {})
  workflow_classification = results.get('workflow_classification', {})
  workflow_kinds = results.get('workflow_kinds', {})
  prism_adjusted = results.get('prism_adjusted', {})
  success_path = results.get('success_path', {})
  designed_failure_summary = results.get('designed_failure_summary', {})

  workflow_attempts = int(results.get('workflow_attempts', 0))
  workflow_successes = int(results.get('workflow_successes', 0))
  workflow_failures = int(results.get('workflow_failures', 0))
  raw_success_rate = float(success_path.get('raw_success_rate_pct', 0.0) or 0.0)
  adjusted_success_rate = float(prism_adjusted.get('success_rate_pct', 0.0) or 0.0)
  adjusted_attempts = int(success_path.get('prism_adjusted_attempts', prism_adjusted.get('workflow_attempts', 0)) or 0)
  adjusted_failures = int(success_path.get('prism_adjusted_failures', prism_adjusted.get('workflow_failures', 0)) or 0)
  success_workflow_attempts = int(success_path.get('workflow_attempts', 0) or 0)
  success_workflow_successes = int(success_path.get('workflow_successes', 0) or 0)
  success_workflow_failures = int(success_path.get('workflow_failures', 0) or 0)
  discovered_pairs = len(discovery.get('pairs', []))
  discovered_direct = len(discovery.get('direct_servers', []))
  users_count = config.get('users_count', 0)
  concurrency = config.get('concurrency', 0)
  peak_concurrency = int(results.get('peak_workflows_in_flight', 0) or 0)
  peak_requests = int(results.get('peak_requests_in_flight', 0) or 0)
  duration_seconds = int(config.get('duration_seconds', 0) or 0)
  ramp_up_seconds = int(config.get('ramp_up_seconds', 0) or 0)
  steady_seconds = max(duration_seconds - ramp_up_seconds, 0)

  def num(value: Any) -> str:
    if value is None:
      return '—'
    if isinstance(value, float):
      return f'{value:.2f}'
    return str(value)

  def esc(value: Any) -> str:
    return html.escape(str(value))

  def kv_rows(mapping: dict[str, Any]) -> str:
    return ''.join(
      f'<tr><th>{esc(key)}</th><td>{esc(value)}</td></tr>'
      for key, value in mapping.items()
    ) or '<tr><td colspan="2">No data</td></tr>'

  def metric_card(title: str, value: Any, hint: str, tone: str = 'default') -> str:
    return (
      f'<section class="metric-card tone-{esc(tone)}">'
      f'<div class="metric-label">{esc(title)}</div>'
      f'<div class="metric-value">{esc(value)}</div>'
      f'<div class="metric-hint">{esc(hint)}</div>'
      '</section>'
    )

  def bar_chart(title: str, mapping: dict[str, Any], color_class: str = 'blue') -> str:
    max_value = max((int(value) for value in mapping.values()), default=0)
    rows = []
    for key, value in sorted(mapping.items(), key=lambda item: int(item[1]), reverse=True):
      percentage = (int(value) / max_value * 100) if max_value else 0
      rows.append(
        '<div class="bar-row">'
        f'<div class="bar-label">{esc(key)}</div>'
        '<div class="bar-track">'
        f'<div class="bar-fill {color_class}" style="width:{percentage:.2f}%"></div>'
        '</div>'
        f'<div class="bar-value">{esc(value)}</div>'
        '</div>'
      )
    body = ''.join(rows) or '<div class="empty">No data</div>'
    return f'<section class="panel"><h3>{esc(title)}</h3>{body}</section>'

  def step_success_cards() -> str:
    cards = []
    for name, stats in sorted(steps.items()):
      attempts = int(stats.get('attempts', 0) or 0)
      successes = int(stats.get('successes', 0) or 0)
      failures = int(stats.get('failures', 0) or 0)
      success_pct = (successes / attempts * 100) if attempts else 0
      failure_pct = (failures / attempts * 100) if attempts else 0
      cards.append(
        '<div class="step-card">'
        f'<div class="step-title">{esc(name)}</div>'
        '<div class="stack-track">'
        f'<div class="stack-fill green" style="width:{success_pct:.2f}%"></div>'
        f'<div class="stack-fill red" style="width:{failure_pct:.2f}%"></div>'
        '</div>'
        f'<div class="step-meta">success {successes}/{attempts} • p95 {num(stats.get("p95_ms"))} ms</div>'
        '</div>'
      )
    return ''.join(cards) or '<div class="empty">No step data</div>'

  def top_errors_table() -> str:
    rows = ''.join(
      '<tr>'
      f'<td>{esc(reason)}</td>'
      f'<td>{num(count)}</td>'
      '</tr>'
      for reason, count in sorted(failure_reasons.items(), key=lambda item: int(item[1]), reverse=True)
    )
    return rows or '<tr><td colspan="2">No failure reasons recorded</td></tr>'

  def simple_reason_table(mapping: dict[str, Any], empty_message: str) -> str:
    rows = ''.join(
      '<tr>'
      f'<td>{esc(reason)}</td>'
      f'<td>{num(count)}</td>'
      '</tr>'
      for reason, count in sorted(mapping.items(), key=lambda item: int(item[1]), reverse=True)
    )
    return rows or f'<tr><td colspan="2">{esc(empty_message)}</td></tr>'

  def phase_timeline() -> str:
    ramp_pct = (ramp_up_seconds / duration_seconds * 100) if duration_seconds else 0
    steady_pct = (steady_seconds / duration_seconds * 100) if duration_seconds else 0
    return (
      '<section class="panel" id="phases">'
      '<h2>Run phases</h2>'
      '<div class="phase-track">'
      f'<div class="phase-segment blue" style="width:{ramp_pct:.2f}%">Ramp-up</div>'
      f'<div class="phase-segment green" style="width:{steady_pct:.2f}%">Steady</div>'
      '</div>'
      '<div class="phase-meta">'
      f'<span>duration {duration_seconds}s</span>'
      f'<span>ramp-up {ramp_up_seconds}s</span>'
      f'<span>steady {steady_seconds}s</span>'
      f'<span>concurrency {concurrency}</span>'
      '</div>'
      '</section>'
    )

  step_rows = ''.join(
    '<tr>'
    f'<td>{esc(name)}</td>'
    f'<td>{num(stats.get("attempts"))}</td>'
    f'<td>{num(stats.get("successes"))}</td>'
    f'<td>{num(stats.get("failures"))}</td>'
    f'<td>{num(stats.get("p50_ms"))}</td>'
    f'<td>{num(stats.get("p95_ms"))}</td>'
    f'<td>{num(stats.get("p99_ms"))}</td>'
    '</tr>'
    for name, stats in sorted(steps.items())
  ) or '<tr><td colspan="7">No step data</td></tr>'

  pair_rows = ''.join(
    '<tr>'
    f'<td>{esc(pair_name)}</td>'
    f'<td>{num(stats.get("workflow_attempts", 0))}</td>'
    f'<td>{num(stats.get("workflow_successes", 0))}</td>'
    f'<td>{num(stats.get("workflow_failures", 0))}</td>'
    '</tr>'
    for pair_name, stats in sorted(
      per_pair.items(),
      key=lambda item: int(item[1].get('workflow_attempts', 0)),
      reverse=True,
    )
  ) or '<tr><td colspan="4">No per-pair data</td></tr>'

  categories_rows = ''.join(
    '<tr>'
    f'<td>{esc(name)}</td>'
    f'<td>{num(stats.get("workflow_attempts", 0))}</td>'
    f'<td>{num(stats.get("workflow_successes", 0))}</td>'
    f'<td>{num(stats.get("workflow_failures", 0))}</td>'
    '</tr>'
    for name, stats in sorted(categories.items())
  ) or '<tr><td colspan="4">No category data</td></tr>'

  raw_json = html.escape(json.dumps(payload, indent=2, sort_keys=True))

  return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Prism OAuth Stress Report</title>
  <style>
    :root {{
      --bg: #f6f7fb;
      --panel: #ffffff;
      --ink: #162033;
      --muted: #607087;
      --line: #dbe1ea;
      --blue: #2667ff;
      --green: #14866d;
      --red: #d64545;
      --amber: #ca8a04;
      --shadow: 0 14px 36px rgba(22, 32, 51, 0.08);
    }}
    * {{ box-sizing: border-box; }}
    html {{ scroll-behavior: smooth; }}
    body {{
      margin: 0;
      font-family: "Inter", "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #eef3ff 0%, var(--bg) 240px);
      color: var(--ink);
    }}
    .shell {{
      width: min(1700px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 56px;
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      gap: 24px;
      align-items: start;
    }}
    .toc {{
      position: sticky;
      top: 20px;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(10px);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 18px;
    }}
    .toc h2 {{
      margin: 0 0 10px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }}
    .toc a {{
      display: block;
      padding: 10px 12px;
      border-radius: 12px;
      color: var(--ink);
      text-decoration: none;
      font-size: 14px;
      margin-bottom: 6px;
    }}
    .toc a:hover {{
      background: #eef4ff;
      color: var(--blue);
    }}
    .page {{
      min-width: 0;
    }}
    .hero {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 28px 30px;
      margin-bottom: 24px;
    }}
    .eyebrow {{
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--blue);
      margin-bottom: 10px;
    }}
    h1 {{
      margin: 0 0 10px;
      font-size: clamp(32px, 4vw, 48px);
      line-height: 1.05;
    }}
    h2 {{
      margin: 0 0 16px;
      font-size: 22px;
    }}
    h3 {{
      margin: 0 0 16px;
      font-size: 20px;
    }}
    .hero p {{
      margin: 0;
      color: var(--muted);
      max-width: 920px;
      font-size: 16px;
      line-height: 1.6;
    }}
    .metrics {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin: 24px 0;
    }}
    .metric-card {{
      background: linear-gradient(180deg, #fff, #f9fbff);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 18px;
    }}
    .metric-card.tone-primary {{
      background: linear-gradient(180deg, #f4f8ff, #e9f0ff);
      border-color: #bfd0ff;
      box-shadow: inset 0 0 0 1px rgba(38, 103, 255, 0.08);
    }}
    .metric-card.tone-primary .metric-label,
    .metric-card.tone-primary .metric-value {{
      color: var(--blue);
    }}
    .metric-card.tone-neutral {{
      background: linear-gradient(180deg, #ffffff, #f4f6f9);
      border-color: #d5dbe6;
    }}
    .metric-card.tone-amber {{
      background: linear-gradient(180deg, #fffaf0, #fff2d8);
      border-color: #f0d28d;
      box-shadow: inset 0 0 0 1px rgba(202, 138, 4, 0.08);
    }}
    .metric-card.tone-amber .metric-label,
    .metric-card.tone-amber .metric-value {{
      color: var(--amber);
    }}
    .metric-label {{
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }}
    .metric-value {{
      font-size: 32px;
      line-height: 1.1;
      font-weight: 800;
      margin: 10px 0 4px;
    }}
    .metric-hint {{
      color: var(--muted);
      font-size: 13px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 20px;
      margin-bottom: 24px;
    }}
    .two-up {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }}
    .meta-grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 22px 24px;
      overflow: hidden;
      margin-bottom: 24px;
    }}
    .bar-row {{
      display: grid;
      grid-template-columns: minmax(120px, 220px) 1fr 72px;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
    }}
    .bar-label, .bar-value {{
      font-size: 14px;
    }}
    .bar-track {{
      position: relative;
      height: 12px;
      border-radius: 999px;
      background: #edf1f7;
      overflow: hidden;
    }}
    .bar-fill {{
      height: 100%;
      border-radius: 999px;
    }}
    .bar-fill.blue {{ background: linear-gradient(90deg, #4f7fff, #2667ff); }}
    .bar-fill.green {{ background: linear-gradient(90deg, #41c7a6, #14866d); }}
    .bar-fill.red {{ background: linear-gradient(90deg, #ff7a7a, #d64545); }}
    .bar-fill.amber {{ background: linear-gradient(90deg, #f8c456, #ca8a04); }}
    .step-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }}
    .step-card {{
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
      background: linear-gradient(180deg, #fff, #fafcff);
    }}
    .step-title {{
      font-weight: 700;
      margin-bottom: 10px;
    }}
    .stack-track {{
      display: flex;
      width: 100%;
      height: 12px;
      border-radius: 999px;
      background: #edf1f7;
      overflow: hidden;
      margin-bottom: 10px;
    }}
    .stack-fill {{
      height: 100%;
    }}
    .stack-fill.green {{ background: linear-gradient(90deg, #41c7a6, #14866d); }}
    .stack-fill.red {{ background: linear-gradient(90deg, #ff8787, #d64545); }}
    .step-meta {{
      color: var(--muted);
      font-size: 13px;
    }}
    .phase-track {{
      display: flex;
      width: 100%;
      min-height: 18px;
      border-radius: 999px;
      overflow: hidden;
      background: #edf1f7;
      margin-bottom: 14px;
    }}
    .phase-segment {{
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      font-size: 11px;
      color: white;
      font-weight: 700;
      white-space: nowrap;
    }}
    .phase-segment.blue {{ background: linear-gradient(90deg, #6091ff, #2667ff); }}
    .phase-segment.green {{ background: linear-gradient(90deg, #48cba9, #14866d); }}
    .phase-meta {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      color: var(--muted);
      font-size: 13px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }}
    th, td {{
      text-align: left;
      padding: 12px 10px;
      border-top: 1px solid var(--line);
      vertical-align: top;
    }}
    th {{
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
      border-top: 0;
      padding-top: 0;
    }}
    .meta-table th {{ width: 44%; }}
    pre {{
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      background: #0f172a;
      color: #dbeafe;
      padding: 18px;
      border-radius: 18px;
      font-size: 12px;
      line-height: 1.55;
      max-height: 460px;
      overflow: auto;
    }}
    .empty {{
      color: var(--muted);
      font-size: 14px;
    }}
    @media (max-width: 1100px) {{
      .shell {{
        grid-template-columns: 1fr;
      }}
      .toc {{
        position: static;
      }}
      .grid, .two-up, .meta-grid {{
        grid-template-columns: 1fr;
      }}
      .bar-row {{
        grid-template-columns: 1fr;
      }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <aside class="toc">
      <h2>Sections</h2>
      <a href="#overview">Overview</a>
      <a href="#phases">Run phases</a>
      <a href="#charts">Charts</a>
      <a href="#steps">Step performance</a>
      <a href="#pairs">Per-pair data</a>
      <a href="#config">Configuration</a>
      <a href="#raw-json">Raw JSON</a>
    </aside>
    <main class="page">
      <section class="hero" id="overview">
        <div class="eyebrow">Prism OAuth Stress Report</div>
        <h1>System capacity report</h1>
        <p>
          The main score below is based only on workflows that were supposed to succeed. Designed failure scenarios are tracked separately,
          and upstream auth/resource failures are split out so they do not distort the Prism capacity reading. One workflow is a multi-step
          sequence and may issue multiple requests, including multiple resource calls after refresh.
        </p>
        <div class="metrics">
          {metric_card('Workflow attempts', workflow_attempts, f'{workflow_successes} succeeded / {workflow_failures} failed')}
          {metric_card('System limit score', f'{adjusted_success_rate:.1f}%', f'{success_workflow_successes}/{adjusted_attempts} success workflows passed after excluding {workflow_classification.get("unexpected_upstream_failures", 0)} upstream failures', 'primary')}
          {metric_card('Success-workflow pass rate', f'{raw_success_rate:.1f}%', f'{success_workflow_successes}/{success_workflow_attempts} workflows that were expected to succeed', 'neutral')}
          {metric_card('Peak running workflows', peak_concurrency, 'observed maximum simultaneous workflows')}
          {metric_card('Peak running requests', peak_requests, 'observed maximum simultaneous HTTP requests across all workflows')}
          {metric_card('OAuth pairs', discovered_pairs, 'discovered from active Prism configuration')}
          {metric_card('Direct servers', discovered_direct, 'included when direct mode is enabled')}
          {metric_card('Designed failures matched', workflow_classification.get('expected_failures', 0), 'failure workflows that failed the way they were supposed to')}
          {metric_card('Unexpected failures', workflow_classification.get('unexpected_failures', 0), 'success workflows that still failed inside Prism')}
          {metric_card('Upstream failures excluded', workflow_classification.get('unexpected_upstream_failures', 0), 'success workflows that failed in auth/resource servers, removed from the main score', 'amber')}
          {metric_card('Failure workflows wrong reason', workflow_classification.get('failure_workflows_wrong_reason', 0), 'failure workflows that failed, but not for the intended reason')}
          {metric_card('Failure workflow successes', workflow_classification.get('failure_workflows_unexpected_successes', 0), 'failure workflows that unexpectedly passed')}
          {metric_card('Worker model', concurrency, 'simultaneous workers configured')}
        </div>
      </section>

      {phase_timeline()}

      <section class="grid" id="charts">
        {bar_chart('Workflow kinds', workflow_kinds, 'blue')}
        {bar_chart('Non-upstream failure reasons', {key: value for key, value in failure_reasons.items() if key not in UPSTREAM_FAILURE_REASONS}, 'red')}
      </section>

      <section class="two-up">
        {bar_chart('Category breakdown', {key: value.get('workflow_attempts', 0) for key, value in categories.items()}, 'green')}
        {bar_chart('Top pairs by attempts', {key: value.get('workflow_attempts', 0) for key, value in per_pair.items()}, 'amber')}
      </section>

      <section class="two-up">
        <section class="panel">
          <h2>Prism-adjusted capacity scoring</h2>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>{kv_rows({
              'success_workflows_total': success_workflow_attempts,
              'success_workflows_passed': success_workflow_successes,
              'success_workflows_failed': success_workflow_failures,
              'prism_scored_workflows': adjusted_attempts,
              'prism_scored_failures': adjusted_failures,
              'prism_scored_successes': success_workflow_successes,
              'system_limit_score_pct': f'{adjusted_success_rate:.2f}',
            })}</tbody>
          </table>
        </section>
        {bar_chart('Upstream failures excluded from success-workflow scoring', unexpected_upstream_failure_reasons, 'amber')}
      </section>

      <section class="panel" id="steps">
        <h2>Per-step success rate</h2>
        <div class="step-grid">{step_success_cards()}</div>
      </section>

      <section class="panel">
        <h2>Step latency and outcome table</h2>
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Attempts</th>
              <th>Successes</th>
              <th>Failures</th>
              <th>P50 ms</th>
              <th>P95 ms</th>
              <th>P99 ms</th>
            </tr>
          </thead>
          <tbody>{step_rows}</tbody>
        </table>
      </section>

      <section class="two-up" id="pairs">
        <section class="panel">
          <h2>Per-pair throughput</h2>
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Attempts</th>
                <th>Successes</th>
                <th>Failures</th>
              </tr>
            </thead>
          <tbody>{pair_rows}</tbody>
        </table>
      </section>
      <section class="panel">
          <h2>Category table</h2>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Attempts</th>
                <th>Successes</th>
                <th>Failures</th>
              </tr>
            </thead>
          <tbody>{categories_rows}</tbody>
        </table>
      </section>
    </section>

      <section class="panel">
        <h2>Peak concurrency by target</h2>
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Peak concurrent workflows</th>
              <th>Peak concurrent requests</th>
            </tr>
          </thead>
          <tbody>{''.join(
            '<tr>'
            f'<td>{esc(name)}</td>'
            f'<td>{num(value)}</td>'
            f'<td>{num(results.get("peak_pair_requests_in_flight", {}).get(name, 0))}</td>'
            '</tr>'
            for name, value in sorted(
              results.get('peak_pair_in_flight', {}).items(),
              key=lambda item: int(item[1]),
              reverse=True,
            )
          ) or '<tr><td colspan="3">No concurrency data</td></tr>'}</tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Top errors</h2>
        <table>
          <thead>
            <tr>
              <th>Error</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>{top_errors_table()}</tbody>
        </table>
      </section>

      <section class="two-up">
        <section class="panel">
          <h2>Designed failures that matched expectation</h2>
          <table>
            <thead>
              <tr>
                <th>Reason</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>{simple_reason_table(expected_failure_reasons, 'No expected failures')}</tbody>
          </table>
        </section>
        <section class="panel">
          <h2>Unexpected failures in success workflows</h2>
          <table>
            <thead>
              <tr>
                <th>Reason</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>{simple_reason_table(unexpected_failure_reasons, 'No unexpected failures')}</tbody>
          </table>
        </section>
      </section>

      <section class="panel">
        <h2>Failure workflows that failed for the wrong reason</h2>
        <table>
          <thead>
            <tr>
              <th>Reason</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>{simple_reason_table(failure_workflow_wrong_reason_reasons, 'No wrong-reason failures recorded')}</tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Upstream failures removed from the main score</h2>
        <table>
          <thead>
            <tr>
              <th>Reason</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>{simple_reason_table(unexpected_upstream_failure_reasons, 'No upstream failures were excluded from success workflows')}</tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Failure workflows that unexpectedly succeeded</h2>
        <table>
          <thead>
            <tr>
              <th>Failure mode</th>
              <th>Success count</th>
            </tr>
          </thead>
          <tbody>{simple_reason_table(unexpected_successes, 'No failure workflows unexpectedly succeeded')}</tbody>
        </table>
      </section>

      <section class="meta-grid" id="config">
        <section class="panel">
          <h2>Runtime configuration</h2>
          <table class="meta-table">
            <tbody>{kv_rows(config)}</tbody>
          </table>
        </section>
        <section class="panel">
          <h2>Run classification summary</h2>
          <table class="meta-table">
            <tbody>{kv_rows({
              'success_workflows_total': success_workflow_attempts,
              'success_workflows_passed': success_workflow_successes,
              'success_workflows_failed': success_workflow_failures,
              'designed_failure_workflows': designed_failure_summary.get('workflow_attempts', 0),
              'designed_failures_matched': designed_failure_summary.get('matched_expected_failures', 0),
              'designed_failures_wrong_reason': designed_failure_summary.get('wrong_reason_failures', 0),
              'designed_failures_unexpected_success': designed_failure_summary.get('unexpected_successes', 0),
              'designed_failures_upstream': designed_failure_summary.get('upstream_failures', 0),
            })}</tbody>
          </table>
        </section>
      </section>

      <section class="panel" id="raw-json">
        <h2>Raw report JSON</h2>
        <pre>{raw_json}</pre>
      </section>
    </main>
  </div>
</body>
</html>'''
