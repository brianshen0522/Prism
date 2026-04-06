from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class StepResult:
  ok: bool
  status_code: int | None
  latency_ms: float
  payload: dict[str, Any] | None
  error: str | None = None


class StressHttpClient:
  def __init__(self, timeout_seconds: float = 30.0) -> None:
    self._clients = {
      True: httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True, verify=True),
      False: httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True, verify=False),
    }

  async def aclose(self) -> None:
    await self._clients[True].aclose()
    await self._clients[False].aclose()

  async def post_json(
    self,
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
    verify: bool = True,
  ) -> StepResult:
    started = time.perf_counter()
    try:
      response = await self._clients[verify].post(url, json=payload, headers=headers)
      latency_ms = (time.perf_counter() - started) * 1000
      return StepResult(
        ok=response.status_code < 400,
        status_code=response.status_code,
        latency_ms=latency_ms,
        payload=_safe_json(response),
      )
    except Exception as exc:  # pragma: no cover - network failures are runtime dependent
      return StepResult(
        ok=False,
        status_code=None,
        latency_ms=(time.perf_counter() - started) * 1000,
        payload=None,
        error=str(exc),
      )

  async def get(
    self,
    url: str,
    headers: dict[str, str] | None = None,
    verify: bool = True,
  ) -> StepResult:
    started = time.perf_counter()
    try:
      response = await self._clients[verify].get(url, headers=headers)
      latency_ms = (time.perf_counter() - started) * 1000
      return StepResult(
        ok=response.status_code < 400,
        status_code=response.status_code,
        latency_ms=latency_ms,
        payload=_safe_json(response),
      )
    except Exception as exc:  # pragma: no cover - network failures are runtime dependent
      return StepResult(
        ok=False,
        status_code=None,
        latency_ms=(time.perf_counter() - started) * 1000,
        payload=None,
        error=str(exc),
      )


def _safe_json(response: httpx.Response) -> dict[str, Any] | None:
  try:
    data = response.json()
    return data if isinstance(data, dict) else {'value': data}
  except Exception:
    text = response.text.strip()
    if not text:
      return None
    try:
      return {'raw': text, 'parsed': json.loads(text)}
    except Exception:
      return {'raw': text}
