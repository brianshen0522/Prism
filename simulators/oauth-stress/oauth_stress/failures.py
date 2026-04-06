from __future__ import annotations

from typing import Protocol, Any


class ParticipantTokenStepResult(Protocol):
  status_code: int | None
  payload: dict[str, Any] | None
  error: str | None


def classify_participant_token_failure(result: ParticipantTokenStepResult) -> str:
  if result.error:
    return 'participant-token-timeout-or-network'
  if result.status_code is not None and result.status_code >= 400:
    return f'participant-token-http-{result.status_code}'
  if not result.payload:
    return 'participant-token-empty-response'
  if not result.payload.get('token'):
    return 'participant-token-missing-token'
  return 'participant-token-failed'
