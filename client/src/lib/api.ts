import { useAuthStore, REFRESH_TOKEN_KEY } from '../store/auth';

const BASE = `${import.meta.env.BASE_URL}api`;

// Decode a JWT payload without verification (client-side display only)
function decodeJwt(token: string) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function authUserFromToken(accessToken: string, institution?: { id: number; name: string; keyword?: string | null } | null) {
  const payload = decodeJwt(accessToken);
  if (!payload) return null;

  const institutionId = institution?.id ?? payload.institutionId;
  const institutionName = institution?.name ?? payload.institutionName;
  if (typeof institutionId !== 'number' || typeof institutionName !== 'string') return null;

  return {
    sub: payload.sub,
    username: payload.username,
    role: payload.role,
    institutionId,
    institutionName,
    institutionKeyword: institution?.keyword ?? null,
  };
}

async function refreshAccessToken(): Promise<string | null> {
  const rt = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!rt) return null;

  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: rt }),
  });

  if (!res.ok) {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    useAuthStore.getState().clearAuth();
    return null;
  }

  const data = await res.json();
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);

  const user = authUserFromToken(data.access_token, data.institution);
  if (user) {
    useAuthStore.getState().setAuth(data.access_token, user);
  }
  if (data.institution_changed === true) {
    useAuthStore.getState().markParticipantTokenStale();
  }

  return data.access_token as string;
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = useAuthStore.getState().accessToken;

  const doFetch = (t: string | null) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...(init.headers ?? {}),
      },
    });

  let res = await doFetch(token);

  if (res.status === 401) {
    token = await refreshAccessToken();
    if (token) res = await doFetch(token);
  }

  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? 'Login failed');
  }
  const data = await res.json();
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
  const user = authUserFromToken(data.access_token, data.institution);
  if (user) {
    useAuthStore.getState().setAuth(data.access_token, user);
  }
  return data;
}

export async function logout() {
  const rt = localStorage.getItem(REFRESH_TOKEN_KEY);
  await apiFetch('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: rt ?? undefined }),
  });
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  useAuthStore.getState().clearAuth();
}

export async function tryRestoreSession(): Promise<boolean> {
  const rt = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!rt) return false;
  const token = await refreshAccessToken();
  return token !== null;
}

// ─── Connections ──────────────────────────────────────────────────────────────

export interface ConnectionSummary {
  id: string;
  user_id: number | null;
  user_name: string | null;
  institution_id: number | null;
  institution_name: string | null;
  server_id: string;
  server_name: string | null;
  status: 'pending' | 'completed' | 'error';
  req_method: string;
  req_url: string;
  req_host: string | null;
  req_timestamp: string;
  req_body_size: number | null;
  res_status_code: number | null;
  res_body_size: number | null;
  duration_ms: number | null;
  participant_token_present: boolean;
  participant_token_valid: boolean | null;
  participant_token_invalid_reason: 'expired' | 'revoked' | null;
  is_system_heartbeat: boolean;
}

export interface ConnectionDetail extends ConnectionSummary {
  req_headers: Record<string, string | string[]>;
  req_body: string | null;
  req_body_truncated: boolean;
  res_timestamp: string | null;
  res_headers: Record<string, string | string[]> | null;
  res_body: string | null;
  res_body_truncated: boolean;
  share_token?: string | null;
}

export interface ConnectionsPage {
  data: ConnectionSummary[];
  total: number;
  page: number;
  limit: number;
}

export function fetchConnections(params: {
  page?: number;
  limit?: number;
  server_id?: string | string[];
  status?: string | string[];
  method?: string | string[];
  user_id?: string;
  institution_id?: string;
  from?: string;
  to?: string;
  filters?: string;
  filter_logic?: 'and' | 'or';
  /** JSON-encoded array of {term, scopes[]} — scopes empty means all fields */
  sq?: string;
  sq_logic?: 'and' | 'or';
  /** 'all' lets non-privileged users see all traffic (not just their own) */
  scope?: 'mine' | 'all';
  include_system_heartbeat?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const asStr = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v.join(',') : (v ?? '');
  const sv = asStr(params.server_id); if (sv) q.set('server_id', sv);
  const st = asStr(params.status);    if (st) q.set('status', st);
  const mt = asStr(params.method);    if (mt) q.set('method', mt);
  if (params.user_id) q.set('user_id', params.user_id);
  if (params.institution_id) q.set('institution_id', params.institution_id);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.filters) q.set('filters', params.filters);
  if (params.filter_logic) q.set('filter_logic', params.filter_logic);
  if (params.sq) q.set('sq', params.sq);
  if (params.sq_logic) q.set('sq_logic', params.sq_logic);
  if (params.scope) q.set('scope', params.scope);
  if (params.include_system_heartbeat) q.set('include_system_heartbeat', 'true');
  if (params.sort) q.set('sort', params.sort);
  if (params.order) q.set('order', params.order);
  return json<ConnectionsPage>(`/connections?${q}`);
}

export function fetchConnection(id: string) {
  return json<ConnectionDetail>(`/connections/${id}`);
}

export interface UserSummary {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'monitor' | 'oauth2' | 'user';
}

export function fetchUsers(params?: { institution_id?: string[] }) {
  const q = new URLSearchParams();
  if (params?.institution_id?.length) q.set('institution_id', params.institution_id.join(','));
  const suffix = q.toString() ? `?${q}` : '';
  return json<UserSummary[]>(`/users${suffix}`);
}

export interface AdminUserInstitution {
  id: number;
  name: string;
  keyword: string | null;
  activated: boolean;
}

export interface AdminUserParticipantToken {
  exists: boolean;
  valid: boolean;
  expires_at: string | null;
  institution_id: number | null;
  institution_mismatch: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  firstname: string | null;
  lastname: string | null;
  name: string;
  email: string | null;
  role: 'admin' | 'monitor' | 'oauth2' | 'user';
  activated: boolean;
  blocked: boolean;
  last_login: string | null;
  creation_date: string | null;
  institution: AdminUserInstitution | null;
  participant_token: AdminUserParticipantToken;
  connection_count: number;
  last_connection_at: string | null;
}

export function fetchAdminUsers() {
  return json<AdminUser[]>('/admin/users');
}

export interface InstitutionOption {
  id: number;
  name: string;
  keyword: string | null;
}

export function fetchInstitutions() {
  return json<InstitutionOption[]>('/institutions');
}

export interface ConnectionFilterOptions {
  status_codes: number[];
}

export function fetchConnectionFilterOptions(params?: { scope?: 'mine' | 'all' }) {
  const q = new URLSearchParams();
  if (params?.scope) q.set('scope', params.scope);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return json<ConnectionFilterOptions>(`/connections/filter-options${suffix}`);
}

export interface TrafficAccessPolicy {
  restrict_user_traffic_to_own: boolean;
  can_view_all_traffic: boolean;
}

export function fetchTrafficAccessPolicy() {
  return json<TrafficAccessPolicy>('/settings/traffic-access');
}

export function clearAllTraffic() {
  return json<{
    deleted_resource_calls: number;
    deleted_pipelines: number;
    deleted_connections: number;
  }>('/admin/connections/clear', {
    method: 'POST',
  });
}

// ─── OAuth Pipelines ──────────────────────────────────────────────────────────

export interface OAuthPipelineListItem {
  id: string;
  started_at: string | null;
  participant_user: {
    id: number;
    username: string;
    name: string;
  } | null;
  participant_institution_id: number | null;
  participant_institution: {
    id: number;
    name: string;
    keyword: string | null;
  } | null;
  authentication_server: {
    id: string;
    name: string;
  } | null;
  resource_servers: Array<{
    id: string;
    name: string;
  }>;
  access_token_fingerprint: string;
  resource_call_count: number;
  complete: boolean;
  legal: boolean;
  success: boolean;
  refreshed_from: {
    id: string;
    accessTokenPreview: string;
  } | null;
  has_descendants: boolean;
  descendant_count: number;
  diagnostics: string[];
  diagnostics_summary: string;
}

export interface OAuthPipelineListResponse {
  data: OAuthPipelineListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface OAuthValidationStep {
  connection_id: string | null;
  raw_validation_connection_path?: string;
  authentication_server: {
    id: string;
    name: string;
  } | null;
  status_code: number | null;
  endpoint_matched: boolean;
  body_check_passed: boolean;
  success: boolean;
  ui_status: 'ok' | 'warning' | 'error' | 'missing';
}

export interface OAuthResourceCallStep {
  resource_connection_id: string;
  raw_resource_connection_path: string;
  resource_server: {
    id: string;
    name: string;
  };
  method: string;
  url: string;
  status_code: number | null;
  participant_token_present: boolean;
  participant_token_linked: boolean;
  success: boolean;
  ui_status: 'ok' | 'warning' | 'error' | 'missing';
  req_timestamp: string;
  validation_expected: boolean;
  validation: OAuthValidationStep | null;
  diagnostics: string;
}

export interface OAuthPipelineDetailResponse {
  summary: {
    id: string;
    started_at: string | null;
    participant_user: {
      id: number;
      username: string;
      name: string;
    } | null;
    participant_institution_id: number | null;
    participant_institution: {
      id: number;
      name: string;
      keyword: string | null;
    } | null;
    authentication_server: {
      id: string;
      name: string;
    } | null;
    access_token: {
      fingerprint: string;
      full?: string;
    };
    complete: boolean;
    legal: boolean;
    success: boolean;
    resource_call_count: number;
    validation_call_count: number;
    resource_servers: Array<{
      id: string;
      name: string;
    }>;
    diagnostics: string[];
    diagnostics_summary: string;
  };
  token_issue: {
    connection_id: string | null;
    raw_connection_path: string | null;
    status_code: number | null;
    participant_token_present: boolean;
    participant_token_linked: boolean;
    grant_type: string | null;
    is_refresh_grant: boolean;
    refresh_token_supplied: boolean;
    refresh_token_rotated: boolean;
    refresh_token_fingerprint: string | null;
    issued_refresh_token_fingerprint: string | null;
    endpoint_matched: boolean;
    access_token_extracted: boolean;
    success: boolean;
    ui_status: 'ok' | 'warning' | 'error' | 'missing';
    req_timestamp: string | null;
  };
  resource_calls: OAuthResourceCallStep[];
  access_token_full?: string | null;
  refresh_token_full?: string | null;
  issued_refresh_token_full?: string | null;
  share_token?: string | null;
  connection_share_tokens?: Record<string, string>;
  refresh_chain: {
    previous_pipeline: {
      id: string;
      started_at: string | null;
      access_token_fingerprint: string;
      authentication_server: {
        id: string;
        name: string;
      } | null;
      grant_type: string | null;
    } | null;
    next_pipelines: Array<{
      id: string;
      started_at: string | null;
      access_token_fingerprint: string;
      authentication_server: {
        id: string;
        name: string;
      } | null;
      grant_type: string | null;
    }>;
  };
}

export interface OAuthFilterOptions {
  participant_users: Array<{
    id: number;
    username: string;
    name: string;
  }>;
  participant_institutions: Array<{
    id: number;
    name: string;
    keyword: string | null;
  }>;
  authentication_servers: Array<{
    id: string;
    name: string;
  }>;
  resource_servers: Array<{
    id: string;
    name: string;
  }>;
}

export function fetchOAuthPipelines(params: {
  page?: number;
  limit?: number;
  access_token?: string;
  participant_user_id?: string | string[];
  participant_institution_id?: string | string[];
  legal?: 'all' | 'legal' | 'illegal';
  success?: 'all' | 'success' | 'failed';
  authentication_server_id?: string | string[];
  resource_server_id?: string | string[];
}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const asStr = (v: string | string[] | undefined) => Array.isArray(v) ? v.join(',') : (v ?? '');
  if (params.access_token) q.set('access_token', params.access_token);
  const pu = asStr(params.participant_user_id); if (pu) q.set('participant_user_id', pu);
  const pi = asStr(params.participant_institution_id); if (pi) q.set('participant_institution_id', pi);
  if (params.legal) q.set('legal', params.legal);
  if (params.success) q.set('success', params.success);
  const auth = asStr(params.authentication_server_id); if (auth) q.set('authentication_server_id', auth);
  const resource = asStr(params.resource_server_id); if (resource) q.set('resource_server_id', resource);
  return json<OAuthPipelineListResponse>(`/oauth/pipelines?${q}`);
}

export function fetchOAuthPipeline(id: string) {
  return json<OAuthPipelineDetailResponse>(`/oauth/pipelines/${id}`);
}

export function fetchOAuthFilterOptions() {
  return json<OAuthFilterOptions>('/oauth/filter-options');
}

// ─── Participant Token ────────────────────────────────────────────────────────

export interface ParticipantToken {
  token: string;
  expires_at: string;
  created_at: string;
  header_name: string;
  institution_id: number | null;
}

export interface ParticipantTokenValidation {
  token: string;
  valid: boolean;
  expires_at: string | null;
  header_name: string;
  institution_id: number | null;
  belongs_to_current_organization: boolean;
  belongs_to_current_user: boolean;
  reason: 'valid' | 'expired' | 'revoked' | 'not_found';
}

export interface ParticipantTokenCredentials {
  username: string;
  password: string;
}

export interface IntegrationGuideListResponse {
  participant_token: {
    header_name: string;
    token: string | null;
    masked_token: string | null;
    expires_at: string | null;
  };
  overview: {
    total_servers: number;
    direct_servers: number;
    oauth_pairs: number;
  };
  items: Array<{
    id: string;
    kind: 'direct-server' | 'oauth-pair';
    title: string;
    description: string | null;
    role: 'generic' | 'resource';
    public_base_url: string;
    target_url: string;
    auth_required: boolean;
    authentication_server: {
      id: string;
      name: string;
      public_base_url: string;
      token_endpoint: string | null;
    } | null;
    summary: string;
  }>;
}

export interface IntegrationGuideDetailResponse {
  participant_token: IntegrationGuideListResponse['participant_token'];
  item: IntegrationGuideListResponse['items'][number];
  detail: {
    notes: string[];
    steps: Array<{
      id: string;
      title: string;
      description: string;
      method: string | null;
      url: string | null;
      headers: Array<{ name: string; value: string }>;
      curl: string | null;
      kind: 'participant-token' | 'token-request' | 'resource-call' | 'note';
    }>;
  };
}

export function fetchParticipantToken() {
  return json<ParticipantToken>('/token');
}

export function regenParticipantToken() {
  return json<ParticipantToken>('/token/regen', { method: 'POST' });
}

export function fetchCurrentParticipantToken() {
  return json<ParticipantToken>('/token/current');
}

export function fetchCurrentParticipantTokenWithCredentials(credentials: ParticipantTokenCredentials) {
  return json<ParticipantToken>('/token/current', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export function renewParticipantToken() {
  return json<ParticipantToken>('/token/renew', { method: 'POST' });
}

export function renewParticipantTokenWithCredentials(credentials: ParticipantTokenCredentials) {
  return json<ParticipantToken>('/token/renew', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export function validateParticipantToken(token?: string) {
  return json<ParticipantTokenValidation>('/token/validate', {
    method: 'POST',
    body: JSON.stringify(token ? { token } : {}),
  });
}

export function validateParticipantTokenWithCredentials(
  credentials: ParticipantTokenCredentials,
  token?: string,
) {
  return json<ParticipantTokenValidation>('/token/validate', {
    method: 'POST',
    body: JSON.stringify(token ? { ...credentials, token } : credentials),
  });
}

export function fetchIntegrationGuide() {
  return json<IntegrationGuideListResponse>('/integration-guide');
}

export function fetchIntegrationGuideDetail(id: string) {
  return json<IntegrationGuideDetailResponse>(`/integration-guide/${id}`);
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalRequests: number;
  requestsLastWindow: number;
  errorRate: number;
  activeServers: number;
  windowMinutes: number;
}

export interface ChartPoint {
  hour: string;
  count: number;
  errors: number;
}

export interface ServerOption {
  id: string;
  name: string;
  proxy_port: number;
  is_active: boolean;
}

export function fetchDashboardStats() {
  return json<DashboardStats>('/dashboard/stats');
}

export interface ChartData {
  hours: number;
  bucketMinutes: number;
  data: ChartPoint[];
}

export function fetchDashboardChart() {
  return json<ChartData>('/dashboard/chart');
}

export function fetchDashboardServers() {
  return json<ServerOption[]>('/dashboard/servers');
}

// ─── Admin: Servers ───────────────────────────────────────────────────────────

export interface AdminServer {
  id: string;
  name: string;
  description: string | null;
  target_url: string;
  is_https: boolean;
  ssl_verify: boolean;
  proxy_port: number;
  is_active: boolean;
  body_size_limit_kb: number | null;
  server_role: 'generic' | 'authentication' | 'resource';
  oauth_auth_server_id: string | null;
  oauth_token_endpoint: string | null;
  oauth_validation_endpoint: string | null;
  oauth_validation_success_path: string | null;
  oauth_validation_success_value: string | null;
  target_test_method: 'GET' | 'HEAD';
  target_test_timeout_seconds: number;
  heartbeat_enabled: boolean;
  heartbeat_url: string | null;
  heartbeat_path: string | null;
  heartbeat_method: 'GET' | 'HEAD';
  heartbeat_interval_seconds: number;
  heartbeat_expected_status: number;
  heartbeat_timeout_seconds: number;
  heartbeat_tls_verify: boolean;
  created_by: number;
  created_at: string;
  is_running: boolean;
  backend_status: ProbeStatus;
  proxy_status: ProbeStatus;
  backend_history: ProbeHistoryPoint[];
  proxy_history: ProbeHistoryPoint[];
}

export interface ProbeStatus {
  ok: boolean;
  lamp: 'green' | 'amber' | 'red' | 'gray';
  checkedAt: string;
  responseTimeMs: number | null;
  statusCode: number | null;
  error: string | null;
  details?: string | null;
}

export interface ProbeHistoryPoint {
  lamp: 'green' | 'amber' | 'red' | 'gray';
  checkedAt: string;
}

export interface CreateServerBody {
  name: string;
  description?: string | null;
  target_url: string;
  is_https?: boolean;
  ssl_verify?: boolean;
  proxy_port?: number;
  body_size_limit_kb?: number | null;
  server_role?: 'generic' | 'authentication' | 'resource';
  oauth_auth_server_id?: string | null;
  oauth_token_endpoint?: string | null;
  oauth_validation_endpoint?: string | null;
  oauth_validation_success_path?: string | null;
  oauth_validation_success_value?: string | null;
  target_test_method?: 'GET' | 'HEAD';
  target_test_timeout_seconds?: number;
  heartbeat_enabled?: boolean;
  heartbeat_url?: string | null;
  heartbeat_path?: string | null;
  heartbeat_method?: 'GET' | 'HEAD';
  heartbeat_interval_seconds?: number;
  heartbeat_expected_status?: number;
  heartbeat_timeout_seconds?: number;
  heartbeat_tls_verify?: boolean;
}

export interface UpdateServerBody {
  name?: string;
  description?: string | null;
  target_url?: string;
  is_https?: boolean;
  ssl_verify?: boolean;
  is_active?: boolean;
  body_size_limit_kb?: number | null;
  server_role?: 'generic' | 'authentication' | 'resource';
  oauth_auth_server_id?: string | null;
  oauth_token_endpoint?: string | null;
  oauth_validation_endpoint?: string | null;
  oauth_validation_success_path?: string | null;
  oauth_validation_success_value?: string | null;
  target_test_method?: 'GET' | 'HEAD';
  target_test_timeout_seconds?: number;
  heartbeat_enabled?: boolean;
  heartbeat_url?: string | null;
  heartbeat_path?: string | null;
  heartbeat_method?: 'GET' | 'HEAD';
  heartbeat_interval_seconds?: number;
  heartbeat_expected_status?: number;
  heartbeat_timeout_seconds?: number;
  heartbeat_tls_verify?: boolean;
}

export function fetchAdminServers() {
  return json<AdminServer[]>('/admin/servers');
}

export function createServer(body: CreateServerBody) {
  return json<AdminServer>('/admin/servers', { method: 'POST', body: JSON.stringify(body) });
}

export function updateServer(id: string, body: UpdateServerBody) {
  return json<AdminServer>(`/admin/servers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteServer(id: string) {
  const res = await apiFetch(`/admin/servers/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
}

export function startServer(id: string) {
  return json<AdminServer>(`/admin/servers/${id}/start`, { method: 'POST' });
}

export function stopServer(id: string) {
  return json<AdminServer>(`/admin/servers/${id}/stop`, { method: 'POST' });
}

export function restartServer(id: string) {
  return json<AdminServer>(`/admin/servers/${id}/restart`, { method: 'POST' });
}

export function testServerTarget(id: string) {
  return json<ProbeStatus>(`/admin/servers/${id}/test-target`, { method: 'POST' });
}

export function testServerHeartbeat(id: string) {
  return json<ProbeStatus>(`/admin/servers/${id}/test-heartbeat`, { method: 'POST' });
}

export function testServerHeartbeatDraft(
  id: string,
  body: Pick<UpdateServerBody, 'target_url' | 'server_role' | 'oauth_validation_endpoint' | 'heartbeat_enabled' | 'heartbeat_url' | 'heartbeat_path' | 'heartbeat_method' | 'heartbeat_expected_status' | 'heartbeat_timeout_seconds' | 'heartbeat_tls_verify'>,
) {
  return json<ProbeStatus>(`/admin/servers/${id}/test-heartbeat-draft`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function testServerTargetDraft(body: Pick<CreateServerBody, 'target_url' | 'ssl_verify' | 'target_test_method' | 'target_test_timeout_seconds'>) {
  return json<ProbeStatus>('/admin/servers/test-target', { method: 'POST', body: JSON.stringify(body) });
}

export interface ImportResult {
  created: number;
  warnings: string[];
  servers: AdminServer[];
}

export function importServers(payload: unknown) {
  return json<ImportResult>('/admin/servers/import', { method: 'POST', body: JSON.stringify(payload) });
}

// ─── Admin: Settings ──────────────────────────────────────────────────────────

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export function fetchSettings() {
  return json<Setting[]>('/admin/settings');
}

export function upsertSetting(key: string, value: string) {
  return json<Setting>(`/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function deleteSetting(key: string) {
  const res = await apiFetch(`/admin/settings/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
}

// ─── Public (unauthenticated) view endpoints ──────────────────────────────────

async function publicJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchPublicConnection(shareToken: string) {
  return publicJson<ConnectionDetail>(`/public/connections/${shareToken}`);
}

export function fetchPublicOAuthPipeline(shareToken: string) {
  return publicJson<OAuthPipelineDetailResponse>(`/public/oauth/pipelines/${shareToken}`);
}
