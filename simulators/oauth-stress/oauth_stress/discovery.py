from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import urljoin

import psycopg
from psycopg.rows import dict_row


DEFAULT_PARTICIPANT_HEADER = 'X-Participant-Token'


@dataclass(frozen=True)
class AuthServer:
  id: str
  name: str
  base_url: str
  tls_verify: bool
  token_endpoint: str | None
  validation_endpoint: str | None


@dataclass(frozen=True)
class ResourceServer:
  id: str
  name: str
  base_url: str
  tls_verify: bool
  linked_auth_server_id: str | None


@dataclass(frozen=True)
class DirectServer:
  id: str
  name: str
  base_url: str
  tls_verify: bool
  role: str


@dataclass(frozen=True)
class OAuthPair:
  id: str
  auth_server: AuthServer
  resource_server: ResourceServer


@dataclass(frozen=True)
class DiscoveryResult:
  participant_header_name: str
  auth_servers: list[AuthServer]
  resource_servers: list[ResourceServer]
  direct_servers: list[DirectServer]
  pairs: list[OAuthPair]
  skipped: list[dict[str, str]]
  pair_profile_matches: list[dict[str, Any]]
  pair_profile_warnings: list[str]

  def as_dict(self) -> dict[str, Any]:
    return {
      'participant_header_name': self.participant_header_name,
      'auth_servers': [asdict(server) for server in self.auth_servers],
      'resource_servers': [asdict(server) for server in self.resource_servers],
      'direct_servers': [asdict(server) for server in self.direct_servers],
      'pairs': [asdict(pair) for pair in self.pairs],
      'skipped': self.skipped,
      'pair_profile_matches': self.pair_profile_matches,
      'pair_profile_warnings': self.pair_profile_warnings,
    }


def _normalize_base_url(value: str | None) -> str | None:
  if not value:
    return None
  return value.rstrip('/') + '/'


def _join(base_url: str, path: str | None) -> str | None:
  if not path:
    return None
  return urljoin(base_url, path)


def discover_from_db(
  db_url: str,
  auth_server_filter: str | None = None,
  resource_server_filter: str | None = None,
  pair_profiles: dict[str, dict[str, Any]] | None = None,
) -> DiscoveryResult:
  with psycopg.connect(db_url, row_factory=dict_row) as conn:
    with conn.cursor() as cur:
      cur.execute(
        '''
        select
          id,
          name,
          target_url,
          server_role,
          is_active,
          oauth_auth_server_id,
          oauth_token_endpoint,
          oauth_validation_endpoint,
          heartbeat_url,
          heartbeat_tls_verify
        from backend_servers
        where is_active = true
        order by name asc
        ''',
      )
      server_rows = cur.fetchall()

      cur.execute(
        "select value from system_settings where key = 'participant_token_header'",
      )
      header_row = cur.fetchone()

  participant_header_name = header_row['value'] if header_row and header_row.get('value') else DEFAULT_PARTICIPANT_HEADER

  auth_servers: dict[str, AuthServer] = {}
  resource_servers: list[ResourceServer] = []
  direct_servers: list[DirectServer] = []
  skipped: list[dict[str, str]] = []

  for row in server_rows:
    role = row['server_role']
    base_url = _normalize_base_url(row.get('heartbeat_url') or row.get('target_url'))
    if role == 'authentication':
      if auth_server_filter and row['name'] != auth_server_filter:
        continue
      if not base_url:
        skipped.append({'name': row['name'], 'reason': 'missing user-facing base URL'})
        continue
      auth_servers[row['id']] = AuthServer(
        id=row['id'],
        name=row['name'],
        base_url=base_url,
        tls_verify=bool(row.get('heartbeat_tls_verify', True)),
        token_endpoint=_join(base_url, row.get('oauth_token_endpoint')),
        validation_endpoint=_join(base_url, row.get('oauth_validation_endpoint')),
      )
      continue

    if role == 'resource':
      if resource_server_filter and row['name'] != resource_server_filter:
        continue
      if not base_url:
        skipped.append({'name': row['name'], 'reason': 'missing user-facing base URL'})
        continue
      resource_servers.append(
        ResourceServer(
          id=row['id'],
          name=row['name'],
          base_url=base_url,
          tls_verify=bool(row.get('heartbeat_tls_verify', True)),
          linked_auth_server_id=row.get('oauth_auth_server_id'),
        ),
      )
      continue

    if role == 'generic':
      if resource_server_filter and row['name'] != resource_server_filter:
        continue
      if not base_url:
        skipped.append({'name': row['name'], 'reason': 'missing user-facing base URL'})
        continue
      direct_servers.append(
        DirectServer(
          id=row['id'],
          name=row['name'],
          base_url=base_url,
          tls_verify=bool(row.get('heartbeat_tls_verify', True)),
          role=role,
        ),
      )

  pairs: list[OAuthPair] = []
  for resource in resource_servers:
    if not resource.linked_auth_server_id:
      skipped.append({'name': resource.name, 'reason': 'resource server has no linked authentication server'})
      continue
    auth = auth_servers.get(resource.linked_auth_server_id)
    if not auth:
      skipped.append({'name': resource.name, 'reason': 'linked authentication server is missing or inactive'})
      continue
    if auth_server_filter and auth.name != auth_server_filter:
      continue
    if not auth.token_endpoint:
      skipped.append({'name': resource.name, 'reason': f'authentication server "{auth.name}" has no token endpoint configured'})
      continue
    pairs.append(
      OAuthPair(
        id=f'{auth.id}:{resource.id}',
        auth_server=auth,
        resource_server=resource,
      ),
    )

  pair_profile_matches: list[dict[str, Any]] = []
  pair_profile_warnings: list[str] = []
  for pair_name in sorted((pair_profiles or {}).keys()):
    matched = next((pair for pair in pairs if f'{pair.auth_server.name} -> {pair.resource_server.name}' == pair_name), None)
    if matched:
      pair_profile_matches.append({
        'pair': pair_name,
        'auth_server': matched.auth_server.name,
        'resource_server': matched.resource_server.name,
      })
    else:
      pair_profile_warnings.append(f'pair profile "{pair_name}" did not match any discovered OAuth pair')

  return DiscoveryResult(
    participant_header_name=participant_header_name,
    auth_servers=sorted(auth_servers.values(), key=lambda server: server.name.lower()),
    resource_servers=sorted(resource_servers, key=lambda server: server.name.lower()),
    direct_servers=sorted(direct_servers, key=lambda server: server.name.lower()),
    pairs=sorted(pairs, key=lambda pair: (pair.auth_server.name.lower(), pair.resource_server.name.lower())),
    skipped=skipped,
    pair_profile_matches=pair_profile_matches,
    pair_profile_warnings=pair_profile_warnings,
  )
