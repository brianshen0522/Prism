import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Play, Square, RotateCcw, Pencil, Trash2,
  Upload, Download, ChevronDown, Lock, Unlock, Activity, ChevronRight, RadioTower, MoreHorizontal,
} from 'lucide-react';
import {
  fetchAdminServers, createServer, updateServer, deleteServer,
  startServer, stopServer, restartServer, importServers,
  testServerTarget, testServerTargetDraft, testServerHeartbeat, testServerHeartbeatDraft,
  type AdminServer, type CreateServerBody, type UpdateServerBody, type ProbeHistoryPoint, type ProbeStatus,
} from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { PageHeader, PageShell } from '../components/PageLayout';
import { EmptyState, TableCard, TableScroller } from '../components/PagePrimitives';
import { Badge } from '../components/ui/badge';
import { Dialog } from '../components/ui/dialog';
import { Skeleton } from '../components/ui/skeleton';
import { fmtDate } from '../lib/utils';

// ─── Server status badges ─────────────────────────────────────────────────────

function lampClasses(lamp: ProbeStatus['lamp']) {
  if (lamp === 'green') return 'bg-green-500';
  if (lamp === 'amber') return 'bg-amber-500';
  if (lamp === 'red') return 'bg-red-500';
  return 'bg-gray-400';
}

function probeMeta(status: ProbeStatus) {
  if (status.error) return status.error;
  const parts = [
    status.statusCode ? `HTTP ${status.statusCode}` : null,
    status.responseTimeMs != null ? `${status.responseTimeMs} ms` : null,
    status.details ?? null,
  ].filter(Boolean);
  return parts.join(' · ') || 'Not tested yet';
}

function probeCheckedAt(status: ProbeStatus) {
  if (status.error === 'Heartbeat not enabled') return 'Heartbeat disabled';
  if (status.lamp === 'gray') return 'Not checked yet';
  return `Last checked ${fmtDate(status.checkedAt)}`;
}

function TimelineBar({ points }: { points: ProbeHistoryPoint[] }) {
  const segmentCount = 24;
  const padded = points.length >= segmentCount
    ? points.slice(-segmentCount)
    : [...Array.from({ length: segmentCount - points.length }, () => null), ...points];
  return (
    <div
      className="grid w-full items-center gap-1"
      style={{ gridTemplateColumns: `repeat(${segmentCount}, minmax(0, 1fr))` }}
    >
      {padded.map((point, index) => (
        <span
          key={`${point?.checkedAt ?? 'empty'}-${index}`}
          title={point ? `${point.lamp} · ${fmtDate(point.checkedAt)}` : 'No data'}
          className={`block h-6 w-full rounded-full ${point ? lampClasses(point.lamp) : 'bg-gray-200 dark:bg-gray-700'}`}
        />
      ))}
    </div>
  );
}

function StatusSummary({
  label,
  status,
  history,
}: {
  label: string;
  status: ProbeStatus;
  history: ProbeHistoryPoint[];
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800/80">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${lampClasses(status.lamp)}`} />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{label}</span>
        </div>
        <span className="truncate text-[10px] text-gray-500 dark:text-gray-400">{probeCheckedAt(status)}</span>
      </div>
      <div className="mt-1.5">
        <TimelineBar points={history} />
      </div>
      <p className="mt-1.5 line-clamp-1 text-[10px] text-gray-500 dark:text-gray-400">{probeMeta(status)}</p>
    </div>
  );
}

function StatusCell({ server }: { server: AdminServer }) {
  return (
    <div className="grid min-w-[420px] gap-2 xl:grid-cols-2">
      <StatusSummary label="Backend" status={server.backend_status} history={server.backend_history} />
      <StatusSummary label="Proxy" status={server.proxy_status} history={server.proxy_history} />
    </div>
  );
}

function RuntimeBadges({ server, compact = false }: { server: AdminServer; compact?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Badge className={server.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
        {server.is_active ? 'active' : 'inactive'}
      </Badge>
      <Badge className={server.is_running ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-400'}>
        {server.is_running ? 'running' : 'stopped'}
      </Badge>
      {!compact && (
        <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
          :{server.proxy_port}
        </Badge>
      )}
      {!compact && (
        <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
          {server.body_size_limit_kb ? `${server.body_size_limit_kb} KB` : '∞'}
        </Badge>
      )}
      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
        {server.server_role}
      </Badge>
    </div>
  );
}

type BackendProtocol = 'http' | 'https';

function parseBackendTarget(url: string | null | undefined) {
  try {
    const parsed = new URL(url || 'https://');
    return {
      protocol: parsed.protocol === 'http:' ? 'http' as const : 'https' as const,
      host: parsed.hostname,
      port: parsed.port,
    };
  } catch {
    return {
      protocol: 'https' as const,
      host: '',
      port: '',
    };
  }
}

function isValidHostname(value: string) {
  if (!value || value.length > 253) return false;
  if (value.includes('/') || value.includes('?') || value.includes('#') || value.includes('@')) return false;
  const labels = value.split('.');
  return labels.every((label) => /^[A-Za-z0-9-]{1,63}$/.test(label) && !label.startsWith('-') && !label.endsWith('-'));
}

function isValidIpv4(value: string) {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isValidIpv6(value: string) {
  const normalized = value.replace(/^\[(.*)\]$/, '$1');
  return /^[0-9A-Fa-f:]+$/.test(normalized) && normalized.includes(':');
}

function isValidBackendHost(value: string) {
  const trimmed = value.trim();
  return isValidHostname(trimmed) || isValidIpv4(trimmed) || isValidIpv6(trimmed);
}

function normalizeBackendHost(value: string) {
  const trimmed = value.trim();
  if (isValidIpv6(trimmed) && !trimmed.startsWith('[')) return `[${trimmed}]`;
  return trimmed;
}

function buildBackendUrl(protocol: BackendProtocol, host: string, port: string) {
  const normalizedHost = normalizeBackendHost(host);
  const trimmedPort = port.trim();
  return `${protocol}://${normalizedHost}${trimmedPort ? `:${trimmedPort}` : ''}`;
}

function isValidPort(value: string) {
  if (!value.trim()) return true;
  if (!/^\d+$/.test(value.trim())) return false;
  const port = Number(value.trim());
  return port >= 1 && port <= 65535;
}

function normalizePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function buildHeartbeatUrl(protocol: BackendProtocol, host: string, port: string, path: string) {
  return `${buildBackendUrl(protocol, host, port)}${normalizePath(path)}`;
}

function defaultHeartbeatPathForRole(role: AdminServer['server_role']) {
  return role === 'authentication' ? '/health' : '/';
}

function getSuggestedProxyPort(servers: AdminServer[], start = 7001, end = 7100) {
  const used = new Set(servers.map((server) => server.proxy_port));
  for (let port = start; port <= end; port += 1) {
    if (!used.has(port)) return port;
  }
  return null;
}

// ─── Row actions ──────────────────────────────────────────────────────────────

function RowActions({
  server,
  locked,
  onEdit,
  onDelete,
}: {
  server: AdminServer;
  locked: boolean;
  onEdit: (s: AdminServer) => void;
  onDelete: (s: AdminServer) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const qc = useQueryClient();
  const mut = (fn: (id: string) => Promise<AdminServer>) =>
    useMutation({
      mutationFn: () => fn(server.id),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-servers'] }),
    });

  const startMut = mut(startServer);
  const stopMut = mut(stopServer);
  const restartMut = mut(restartServer);
  const testMut = useMutation({
    mutationFn: () => testServerTarget(server.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-servers'] }),
  });
  const heartbeatMut = useMutation({
    mutationFn: () => testServerHeartbeat(server.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-servers'] }),
  });

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setMenuOpen(false);
      closeTimerRef.current = null;
    }, 180);
  };

  return (
    <div className="flex w-[108px] items-center justify-end gap-1">
      <Button
        variant="ghost" size="sm" title="Test target"
        loading={testMut.isPending}
        disabled={false}
        onClick={() => testMut.mutate()}
        className="text-gray-500 hover:text-violet-600"
      >
        <Activity className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost" size="sm" title="Run heartbeat now"
        loading={heartbeatMut.isPending}
        disabled={!server.heartbeat_enabled}
        onClick={() => heartbeatMut.mutate()}
        className="text-gray-500 hover:text-emerald-600 disabled:hover:text-gray-500"
      >
        <RadioTower className="h-3.5 w-3.5" />
      </Button>
      <div
        className="relative"
        onMouseEnter={() => {
          clearCloseTimer();
          setMenuOpen(true);
        }}
        onMouseLeave={scheduleClose}
      >
        <Button
          variant="ghost"
          size="sm"
          title="More actions"
          onClick={() => setMenuOpen((open) => !open)}
          className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-30 pt-1">
            <div
              className="w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
            >
              {server.is_running ? (
                <>
                  <button
                    type="button"
                    disabled={locked || stopMut.isPending}
                    onClick={() => {
                      clearCloseTimer();
                      setMenuOpen(false);
                      stopMut.mutate();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </button>
                  <button
                    type="button"
                    disabled={locked || restartMut.isPending}
                    onClick={() => {
                      clearCloseTimer();
                      setMenuOpen(false);
                      restartMut.mutate();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restart
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={locked || startMut.isPending}
                  onClick={() => {
                    clearCloseTimer();
                    setMenuOpen(false);
                    startMut.mutate();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  <Play className="h-3.5 w-3.5" />
                  Start
                </button>
              )}
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  clearCloseTimer();
                  setMenuOpen(false);
                  onEdit(server);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  clearCloseTimer();
                  setMenuOpen(false);
                  onDelete(server);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ServerMobileCard({
  server,
  locked,
  onEdit,
  onDelete,
}: {
  server: AdminServer;
  locked: boolean;
  onEdit: (s: AdminServer) => void;
  onDelete: (s: AdminServer) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{server.name}</p>
          {server.description && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{server.description}</p>
          )}
          <p className="mt-1 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{server.target_url}</p>
          <RuntimeBadges server={server} />
        </div>
        <StatusCell server={server} />
      </div>

      <div className="mt-3">
        <RowActions server={server} locked={locked} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

// ─── Server form ──────────────────────────────────────────────────────────────

interface ServerFormProps {
  initial?: AdminServer | null;
  allServers: AdminServer[];
  onSave: (data: CreateServerBody | UpdateServerBody) => Promise<void>;
  onClose: () => void;
  saving: boolean;
  error?: string;
}

function ServerForm({ initial, allServers, onSave, onClose, saving, error }: ServerFormProps) {
  const qc = useQueryClient();
  const parsedTarget = parseBackendTarget(initial?.target_url);
  const parsedUserAccess = parseBackendTarget(initial?.heartbeat_url);
  const suggestedProxyPort = initial ? initial.proxy_port : getSuggestedProxyPort(allServers);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [targetProtocol, setTargetProtocol] = useState<BackendProtocol>(parsedTarget.protocol);
  const [targetHost, setTargetHost] = useState(parsedTarget.host);
  const [targetPort, setTargetPort] = useState(parsedTarget.port);
  const [sslVerify, setSslVerify] = useState(parsedTarget.protocol === 'https' ? (initial?.ssl_verify ?? true) : true);
  const [proxyPort, setProxyPort] = useState(initial?.proxy_port?.toString() ?? (suggestedProxyPort ? String(suggestedProxyPort) : ''));
  const [bodyLimit, setBodyLimit] = useState(initial?.body_size_limit_kb?.toString() ?? '');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [serverRole, setServerRole] = useState<AdminServer['server_role']>(initial?.server_role ?? 'generic');
  const [oauthAuthServerId, setOauthAuthServerId] = useState(initial?.oauth_auth_server_id ?? '');
  const [oauthTokenEndpoint, setOauthTokenEndpoint] = useState(initial?.oauth_token_endpoint ?? '');
  const [oauthValidationEndpoint, setOauthValidationEndpoint] = useState(initial?.oauth_validation_endpoint ?? '');
  const [oauthValidationSuccessPath, setOauthValidationSuccessPath] = useState(initial?.oauth_validation_success_path ?? 'active');
  const [oauthValidationSuccessValue, setOauthValidationSuccessValue] = useState(initial?.oauth_validation_success_value ?? 'true');
  const [targetTestMethod, setTargetTestMethod] = useState<'GET' | 'HEAD'>(initial?.target_test_method ?? 'GET');
  const [targetTestTimeoutSeconds, setTargetTestTimeoutSeconds] = useState(String(initial?.target_test_timeout_seconds ?? 10));
  const [heartbeatExpanded, setHeartbeatExpanded] = useState(false);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(initial?.heartbeat_enabled ?? false);
  const [userAccessProtocol, setUserAccessProtocol] = useState<BackendProtocol>(parsedUserAccess.protocol);
  const [userAccessHost, setUserAccessHost] = useState(parsedUserAccess.host);
  const [userAccessPort, setUserAccessPort] = useState(parsedUserAccess.port);
  const [heartbeatPath, setHeartbeatPath] = useState(initial?.heartbeat_path ?? defaultHeartbeatPathForRole(initial?.server_role ?? 'generic'));
  const [heartbeatMethod, setHeartbeatMethod] = useState<'GET' | 'HEAD'>(initial?.heartbeat_method ?? 'GET');
  const [heartbeatIntervalSeconds, setHeartbeatIntervalSeconds] = useState(String(initial?.heartbeat_interval_seconds ?? 60));
  const [heartbeatExpectedStatus, setHeartbeatExpectedStatus] = useState(String(initial?.heartbeat_expected_status ?? 200));
  const [heartbeatTimeoutSeconds, setHeartbeatTimeoutSeconds] = useState(String(initial?.heartbeat_timeout_seconds ?? 10));
  const [heartbeatTlsVerify, setHeartbeatTlsVerify] = useState(parsedUserAccess.protocol === 'https' ? (initial?.heartbeat_tls_verify ?? true) : true);
  const targetHostValid = isValidBackendHost(targetHost);
  const targetPortValid = isValidPort(targetPort);
  const userAccessHostValid = !userAccessHost.trim() || isValidBackendHost(userAccessHost);
  const userAccessPortValid = isValidPort(userAccessPort);
  const targetUrl = targetHostValid && targetPortValid ? buildBackendUrl(targetProtocol, targetHost, targetPort) : '';
  const targetTestMut = useMutation({
    mutationFn: () => testServerTargetDraft({
      target_url: targetUrl,
      ssl_verify: targetProtocol === 'https' ? sslVerify : true,
      target_test_method: targetTestMethod,
      target_test_timeout_seconds: parseInt(targetTestTimeoutSeconds, 10) || 10,
    }),
  });
  const heartbeatTestMut = useMutation({
    mutationFn: () => {
      if (!initial?.id) throw new Error('Save the server before running a heartbeat test.');
      return testServerHeartbeatDraft(initial.id, {
        target_url: targetUrl || undefined,
        server_role: serverRole,
        oauth_validation_endpoint: serverRole === 'authentication' && oauthValidationEndpoint.trim() ? oauthValidationEndpoint.trim() : null,
        heartbeat_enabled: heartbeatEnabled,
        heartbeat_url: userAccessHost.trim()
          ? buildBackendUrl(userAccessProtocol, userAccessHost, userAccessPort)
          : null,
        heartbeat_path: heartbeatPath.trim() ? normalizePath(heartbeatPath) : defaultHeartbeatPathForRole(serverRole),
        heartbeat_method: heartbeatMethod,
        heartbeat_expected_status: parseInt(heartbeatExpectedStatus, 10) || 200,
        heartbeat_timeout_seconds: parseInt(heartbeatTimeoutSeconds, 10) || 10,
        heartbeat_tls_verify: userAccessProtocol === 'https' ? heartbeatTlsVerify : true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-servers'] });
    },
  });

  const isEditing = !!initial;
  const authServers = allServers.filter((server) => server.server_role === 'authentication' && server.id !== initial?.id);
  const resolveDefaultHeartbeatUrl = () => {
    if (userAccessHost.trim()) {
      return buildBackendUrl(userAccessProtocol, userAccessHost, userAccessPort);
    }
    if (targetUrl) return targetUrl;
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetHostValid || !targetPortValid || !userAccessHostValid || !userAccessPortValid) return;
    const isHttps = targetProtocol === 'https';
    const builtTargetUrl = buildBackendUrl(targetProtocol, targetHost, targetPort);
    const body: CreateServerBody & UpdateServerBody = {
      name,
      description: description.trim() ? description.trim() : null,
      target_url: builtTargetUrl,
      is_https: isHttps,
      ssl_verify: isHttps ? sslVerify : true,
      body_size_limit_kb: bodyLimit ? parseInt(bodyLimit, 10) : null,
      server_role: serverRole,
      oauth_auth_server_id: serverRole === 'resource' && oauthAuthServerId ? oauthAuthServerId : null,
      oauth_token_endpoint: serverRole === 'authentication' && oauthTokenEndpoint.trim() ? oauthTokenEndpoint.trim() : null,
      oauth_validation_endpoint: serverRole === 'authentication' && oauthValidationEndpoint.trim() ? oauthValidationEndpoint.trim() : null,
      oauth_validation_success_path: serverRole === 'authentication' && oauthValidationSuccessPath.trim() ? oauthValidationSuccessPath.trim() : null,
      oauth_validation_success_value: serverRole === 'authentication' && oauthValidationSuccessValue.trim() ? oauthValidationSuccessValue.trim() : null,
      target_test_method: targetTestMethod,
      target_test_timeout_seconds: parseInt(targetTestTimeoutSeconds, 10) || 10,
      heartbeat_enabled: heartbeatEnabled,
      heartbeat_url: userAccessHost.trim()
        ? buildBackendUrl(userAccessProtocol, userAccessHost, userAccessPort)
        : (heartbeatEnabled ? resolveDefaultHeartbeatUrl() : null),
      heartbeat_path: heartbeatPath.trim() ? normalizePath(heartbeatPath) : defaultHeartbeatPathForRole(serverRole),
      heartbeat_method: heartbeatMethod,
      heartbeat_interval_seconds: parseInt(heartbeatIntervalSeconds, 10) || 60,
      heartbeat_expected_status: parseInt(heartbeatExpectedStatus, 10) || 200,
      heartbeat_timeout_seconds: parseInt(heartbeatTimeoutSeconds, 10) || 10,
      heartbeat_tls_verify: userAccessProtocol === 'https' ? heartbeatTlsVerify : true,
    };
    if (!isEditing && proxyPort) body.proxy_port = parseInt(proxyPort, 10);
    if (isEditing) body.is_active = isActive;
    await onSave(body);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">Core settings</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Define the backend identity, protocol, and where Prism should forward traffic.
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Name *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="FHIR Server A" required />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short note about what this server is for."
                  rows={3}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Role *</label>
                  <select
                    value={serverRole}
                    onChange={(e) => setServerRole(e.target.value as AdminServer['server_role'])}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="generic">Generic</option>
                    <option value="authentication">Authentication server</option>
                    <option value="resource">Resource server</option>
                  </select>
                </div>

                {isEditing && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Runtime</label>
                    <div className="flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-800">
                      <input
                        id="is_active"
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">Backend target</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Enter only the backend host information. Prism assembles the final target URL for you.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Backend server *</label>
        <div className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_120px]">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Protocol</label>
            <select
              value={targetProtocol}
              onChange={(e) => setTargetProtocol(e.target.value as BackendProtocol)}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Host name or IP</label>
            <Input
              value={targetHost}
              onChange={(e) => setTargetHost(e.target.value)}
              placeholder="fhir.example.com or 10.0.0.8"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Port</label>
            <Input
              value={targetPort}
              onChange={(e) => setTargetPort(e.target.value.replace(/[^\d]/g, ''))}
              placeholder={targetProtocol === 'https' ? '443' : '80'}
              inputMode="numeric"
              maxLength={5}
            />
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Enter only the backend host name or IP. Paths, query strings, credentials, and other URL fragments are not allowed.
        </p>
        {!targetHostValid && targetHost.trim() && (
          <p className="text-xs text-red-600 dark:text-red-400">
            Enter only a valid host name, IPv4 address, or IPv6 address. Do not include http://, https://, paths, query strings, or credentials.
          </p>
        )}
        {!targetPortValid && targetPort.trim() && (
          <p className="text-xs text-red-600 dark:text-red-400">
            Port must be a number between 1 and 65535.
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Port is optional. Leave it blank to use the protocol default: {targetProtocol === 'https' ? '443' : '80'}.
        </p>
        {targetHostValid && targetPortValid && (
          <p className="font-mono text-xs text-blue-600 dark:text-blue-400">{buildBackendUrl(targetProtocol, targetHost, targetPort)}</p>
        )}
              </div>

              {targetProtocol === 'https' && (
                <div className="flex items-center gap-2">
                  <input
                    id="ssl_verify"
                    type="checkbox"
                    checked={sslVerify}
                    onChange={(e) => setSslVerify(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="ssl_verify" className="text-sm text-gray-700 dark:text-gray-300">Verify SSL certificate</label>
                </div>
              )}

              {!isEditing && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Proxy port <span className="text-gray-400 dark:text-gray-500 font-normal">(defaults to the lowest available port)</span>
                  </label>
                  <Input
                    value={proxyPort}
                    onChange={(e) => setProxyPort(e.target.value)}
                    placeholder={suggestedProxyPort ? String(suggestedProxyPort) : '7001'}
                    type="number"
                    min={1024}
                    max={65535}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    If you keep this value, Prism will use the lowest available proxy port in the allowed range. For example, if the range is 7001 to 7100 and 7001 plus 7002 are already used, the next default port will be 7003.
                  </p>
                  {suggestedProxyPort && (
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      Suggested port: {suggestedProxyPort}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Body storage limit (KB) <span className="text-gray-400 dark:text-gray-500 font-normal">(blank = unlimited)</span>
                </label>
                <Input
                  value={bodyLimit}
                  onChange={(e) => setBodyLimit(e.target.value)}
                  placeholder="e.g. 512"
                  type="number"
                  min={1}
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">User access URL</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                This is the final URL that end users actually access. Heartbeat uses this base URL and appends the heartbeat path.
              </p>
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_120px]">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Protocol</label>
                  <select
                    value={userAccessProtocol}
                    onChange={(e) => setUserAccessProtocol(e.target.value as BackendProtocol)}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Host name or IP</label>
                  <Input
                    value={userAccessHost}
                    onChange={(e) => setUserAccessHost(e.target.value)}
                    placeholder="Leave blank to reuse the backend target"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Port</label>
                  <Input
                    value={userAccessPort}
                    onChange={(e) => setUserAccessPort(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder={userAccessProtocol === 'https' ? '443' : '80'}
                    inputMode="numeric"
                    maxLength={5}
                  />
                </div>
              </div>
              {!userAccessHostValid && userAccessHost.trim() && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Enter only a valid host name, IPv4 address, or IPv6 address for the user access URL.
                </p>
              )}
              {!userAccessPortValid && userAccessPort.trim() && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  User access port must be a number between 1 and 65535.
                </p>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Leave this blank if users access the same host and port as the backend target. HTTPS enables TLS verification for heartbeat checks.
              </p>
              {userAccessProtocol === 'https' && (
                <div className="flex items-center gap-2">
                  <input
                    id="heartbeat_tls_verify"
                    type="checkbox"
                    checked={heartbeatTlsVerify}
                    onChange={(e) => setHeartbeatTlsVerify(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="heartbeat_tls_verify" className="text-sm text-gray-700 dark:text-gray-300">Verify TLS certificate</label>
                </div>
              )}
              {userAccessHostValid && userAccessPortValid && userAccessHost.trim() && (
                <p className="font-mono text-xs text-blue-600 dark:text-blue-400">
                  {buildBackendUrl(userAccessProtocol, userAccessHost, userAccessPort)}
                </p>
              )}
            </div>
          </div>

          {serverRole === 'authentication' && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
              <div>
                <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">OAuth Authentication Settings</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Used to detect token issuance and validation traffic for OAuth pipelines.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Token endpoint</label>
                <Input value={oauthTokenEndpoint} onChange={(e) => setOauthTokenEndpoint(e.target.value)} placeholder="/oauth/token" />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Validation endpoint</label>
                <Input value={oauthValidationEndpoint} onChange={(e) => setOauthValidationEndpoint(e.target.value)} placeholder="/oauth/introspect" />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Validation success JSON path</label>
                  <Input value={oauthValidationSuccessPath} onChange={(e) => setOauthValidationSuccessPath(e.target.value)} placeholder="active" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Expected value</label>
                  <Input value={oauthValidationSuccessValue} onChange={(e) => setOauthValidationSuccessValue(e.target.value)} placeholder="true" />
                </div>
              </div>
            </div>
          )}

          {serverRole === 'resource' && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
              <div>
                <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">OAuth Resource Settings</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Optionally link this resource server to its authentication server to improve pipeline matching.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Authentication server</label>
                <select
                  value={oauthAuthServerId}
                  onChange={(e) => setOauthAuthServerId(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Auto-detect</option>
                  {authServers.map((server) => (
                    <option key={server.id} value={server.id}>{server.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">Connection Test</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Test the backend server directly without going through the proxy listener.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Test method</label>
            <select
              value={targetTestMethod}
              onChange={(e) => setTargetTestMethod(e.target.value as 'GET' | 'HEAD')}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="GET">GET</option>
              <option value="HEAD">HEAD</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Timeout (seconds)</label>
            <Input value={targetTestTimeoutSeconds} onChange={(e) => setTargetTestTimeoutSeconds(e.target.value)} type="number" min={1} max={120} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={targetTestMut.isPending}
            disabled={!targetHostValid || !targetPortValid}
            onClick={() => targetTestMut.mutate()}
          >
            <Activity className="h-3.5 w-3.5" />
            Test target
          </Button>
          {targetTestMut.data && (
            <div className="min-w-0 text-right text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center justify-end gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${lampClasses(targetTestMut.data.lamp)}`} />
                <span>{probeMeta(targetTestMut.data)}</span>
              </div>
              <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {probeCheckedAt(targetTestMut.data)}
              </div>
            </div>
          )}
        </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
        <button
          type="button"
          onClick={() => setHeartbeatExpanded((value) => !value)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">Heartbeat</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Periodically test the end-user URL through the proxy chain.
            </p>
          </div>
          <ChevronRight className={`h-4 w-4 text-gray-500 transition-transform ${heartbeatExpanded ? 'rotate-90' : ''}`} />
        </button>

        {heartbeatExpanded && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                id="heartbeat_enabled"
                type="checkbox"
                checked={heartbeatEnabled}
                onChange={(e) => setHeartbeatEnabled(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor="heartbeat_enabled" className="text-sm text-gray-700 dark:text-gray-300">Enable heartbeat</label>
            </div>

            <fieldset disabled={!heartbeatEnabled} className="space-y-3 disabled:opacity-50">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Heartbeat path</label>
              <Input
                value={heartbeatPath}
                onChange={(e) => setHeartbeatPath(e.target.value)}
                placeholder={serverRole === 'authentication' ? '/health' : '/'}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Authentication servers default to `/health`. Other servers default to `/`.
              </p>
              {(userAccessHost.trim() || targetUrl) && (
                <p className="font-mono text-xs text-blue-600 dark:text-blue-400">
                  {buildHeartbeatUrl(
                    userAccessHost.trim() ? userAccessProtocol : targetProtocol,
                    userAccessHost.trim() ? userAccessHost : targetHost,
                    userAccessHost.trim() ? userAccessPort : targetPort,
                    heartbeatPath || defaultHeartbeatPathForRole(serverRole),
                  )}
                </p>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Method</label>
                <select
                  value={heartbeatMethod}
                  onChange={(e) => setHeartbeatMethod(e.target.value as 'GET' | 'HEAD')}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="GET">GET</option>
                  <option value="HEAD">HEAD</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Expected status</label>
                <Input value={heartbeatExpectedStatus} onChange={(e) => setHeartbeatExpectedStatus(e.target.value)} type="number" min={100} max={599} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Interval (seconds)</label>
                <Input value={heartbeatIntervalSeconds} onChange={(e) => setHeartbeatIntervalSeconds(e.target.value)} type="number" min={10} max={86400} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Timeout (seconds)</label>
                <Input value={heartbeatTimeoutSeconds} onChange={(e) => setHeartbeatTimeoutSeconds(e.target.value)} type="number" min={1} max={120} />
              </div>
            </div>

            </fieldset>

            <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Manual heartbeat test</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {!heartbeatEnabled
                    ? 'Enable heartbeat first to edit these settings and run manual checks.'
                    : isEditing
                    ? 'Run one heartbeat immediately with the saved server configuration.'
                    : 'Save the server first, then you can run heartbeat manually from this panel.'}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={heartbeatTestMut.isPending}
                disabled={!isEditing || !heartbeatEnabled}
                onClick={() => heartbeatTestMut.mutate()}
              >
                <RadioTower className="h-3.5 w-3.5" />
                Run heartbeat now
              </Button>
            </div>

            {(heartbeatTestMut.data || (isEditing && initial?.proxy_status)) && (
              <div className="min-w-0 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${lampClasses((heartbeatTestMut.data ?? initial?.proxy_status)!.lamp)}`} />
                  <span>{probeMeta((heartbeatTestMut.data ?? initial?.proxy_status)!)}</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  {probeCheckedAt((heartbeatTestMut.data ?? initial?.proxy_status)!)}
                </div>
              </div>
            )}
          </div>
        )}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded px-3 py-2">{error}</p>}

      <div className="sticky bottom-0 -mx-6 border-t border-gray-100 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEditing ? 'Save changes' : 'Create server'}</Button>
        </div>
      </div>
    </form>
  );
}

// ─── Import dialog ────────────────────────────────────────────────────────────

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<{ created: number; warnings: string[] } | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const mut = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const payload = JSON.parse(text);
      return importServers(payload);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin-servers'] });
      setResult({ created: data.created, warnings: data.warnings });
    },
    onError: (err) => setError((err as Error).message),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult(null);
    mut.mutate(file);
  };

  const handleClose = () => {
    setResult(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Import servers (JSON)">
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select a Prism JSON export file. Port conflicts are auto-resolved.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFile}
          className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 dark:file:bg-blue-900/30 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50"
        />

        {mut.isPending && <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">Importing…</p>}

        {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded px-3 py-2">{error}</p>}

        {result && (
          <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 p-3 space-y-2">
            <p className="text-sm font-medium text-green-800 dark:text-green-400">{result.created} server{result.created !== 1 ? 's' : ''} imported</p>
            {result.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">⚠ {w}</p>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={handleClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Export dropdown ──────────────────────────────────────────────────────────

function ExportMenu() {
  const [open, setOpen] = useState(false);

  const download = async (format: 'json' | 'csv') => {
    setOpen(false);
    const { useAuthStore } = await import('../store/auth');
    const token = useAuthStore.getState().accessToken;
    const path = `/api/admin/servers/export${format === 'csv' ? '/csv' : ''}`;
    const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format === 'csv' ? 'prism-servers.csv' : 'prism-servers.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        <Download className="h-3.5 w-3.5" />
        Export
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-36 rounded-md bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 py-1">
            <button
              onClick={() => download('json')}
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              JSON
            </button>
            <button
              onClick={() => download('csv')}
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ServersPage ──────────────────────────────────────────────────────────────

export function ServersPage() {
  const qc = useQueryClient();
  const [locked, setLocked] = useState(true);
  const [formServer, setFormServer] = useState<AdminServer | null | 'new'>('new' as any);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [formError, setFormError] = useState('');

  const toggleLock = () => setLocked((v) => !v);

  const { data: servers, isLoading } = useQuery({
    queryKey: ['admin-servers'],
    queryFn: fetchAdminServers,
    refetchInterval: 10_000,
  });

  const createMut = useMutation({
    mutationFn: (body: CreateServerBody) => createServer(body),
    onSuccess: (server) => {
      qc.setQueryData<AdminServer[] | undefined>(['admin-servers'], (current) =>
        current ? [...current, server].sort((a, b) => a.proxy_port - b.proxy_port) : [server],
      );
      qc.invalidateQueries({ queryKey: ['admin-servers'] });
      setShowForm(false);
      setFormError('');
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateServerBody }) => updateServer(id, body),
    onSuccess: (server) => {
      qc.setQueryData<AdminServer[] | undefined>(['admin-servers'], (current) =>
        current
          ? current
            .map((item) => (item.id === server.id ? server : item))
            .sort((a, b) => a.proxy_port - b.proxy_port)
          : [server],
      );
      qc.invalidateQueries({ queryKey: ['admin-servers'] });
      setShowForm(false);
      setFormError('');
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-servers'] }),
  });

  const editing = showForm && formServer && formServer !== 'new' ? formServer as AdminServer : null;

  const handleSave = async (body: CreateServerBody | UpdateServerBody) => {
    if (editing) {
      await updateMut.mutateAsync({ id: editing.id, body: body as UpdateServerBody });
    } else {
      await createMut.mutateAsync(body as CreateServerBody);
    }
  };

  const handleDelete = (s: AdminServer) => {
    if (confirm(`Delete "${s.name}"? This will stop the proxy listener and remove all connection history.`)) {
      deleteMut.mutate(s.id);
    }
  };

  return (
    <PageShell width="wide">
      <PageHeader
        title="Servers"
        description={servers
          ? `${servers.length} server${servers.length !== 1 ? 's' : ''} · ${servers.filter((s) => s.is_running).length} running`
          : 'Manage proxy targets, runtime state, and OAuth server classification.'}
        actions={(
          <>
          <Button
            variant={locked ? 'primary' : 'secondary'}
            size="sm"
            onClick={toggleLock}
            title={locked ? 'Unlock to allow changes' : 'Lock to prevent changes'}
            className={locked ? 'bg-amber-500 hover:bg-amber-600 border-amber-500' : ''}
          >
            {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            {locked ? 'Locked' : 'Lock'}
          </Button>

          <Button
            variant="secondary" size="sm"
            disabled={locked}
            onClick={() => { setShowImport(true); }}
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>

          <ExportMenu />

          <Button
            size="sm"
            disabled={locked}
            onClick={() => { setFormServer('new' as any); setFormError(''); setShowForm(true); }}
          >
            <Plus className="h-4 w-4" />
            Add server
          </Button>
          </>
        )}
      />

      {/* Lock banner */}
      {locked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-400">
          <Lock className="h-4 w-4 shrink-0" />
          <span>Server configuration is locked. Click <strong>Locked</strong> to unlock and allow changes.</span>
        </div>
      )}

      {/* Table */}
      <TableCard>
        <TableScroller>
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : !servers?.length ? (
            <EmptyState title="No servers configured yet" description="Add a server to start proxying traffic." />
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {servers.map((s) => (
                  <ServerMobileCard
                    key={s.id}
                    server={s}
                    locked={locked}
                    onEdit={(sv) => { setFormServer(sv); setFormError(''); setShowForm(true); }}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
              <table className="hidden w-full table-fixed text-sm md:table">
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[17%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-auto" />
                  <col className="w-[132px]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Target URL</th>
                    <th className="px-4 py-3 font-medium">Port</th>
                    <th className="px-4 py-3 font-medium">Limit</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {servers.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 align-top">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900 dark:text-gray-100" title={s.name}>{s.name}</p>
                          {s.description && (
                            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" title={s.description}>
                              {s.description}
                            </p>
                          )}
                          <RuntimeBadges server={s} compact />
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs text-gray-600 dark:text-gray-400" title={s.target_url}>
                        <div className="truncate">{s.target_url}</div>
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs text-gray-600 dark:text-gray-400">{s.proxy_port}</td>
                      <td className="px-4 py-3 align-top text-xs text-gray-500 dark:text-gray-400">
                        {s.body_size_limit_kb ? `${s.body_size_limit_kb} KB` : '∞'}
                      </td>
                      <td className="px-4 py-3 align-top"><StatusCell server={s} /></td>
                      <td className="px-4 py-3 align-top">
                        <RowActions
                          server={s}
                          locked={locked}
                          onEdit={(sv) => { setFormServer(sv); setFormError(''); setShowForm(true); }}
                          onDelete={handleDelete}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </TableScroller>
      </TableCard>

      {/* Create / Edit dialog */}
      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? `Edit "${editing.name}"` : 'Add server'}
        className="h-[min(92vh,980px)] w-[min(96vw,1500px)] max-w-none"
      >
        <ServerForm
          initial={editing}
          allServers={servers ?? []}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending || updateMut.isPending}
          error={formError}
        />
      </Dialog>

      {/* Import dialog */}
      <ImportDialog open={showImport} onClose={() => setShowImport(false)} />
    </PageShell>
  );
}
