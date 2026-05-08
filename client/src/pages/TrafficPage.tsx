import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Radio, RadioTower, SlidersHorizontal, X } from 'lucide-react';
import {
  clearAllTraffic,
  fetchConnections,
  fetchConnectionFilterOptions,
  fetchDashboardServers,
  fetchOAuthFilterOptions,
  fetchOAuthPipelines,
  fetchTrafficAccessPolicy,
  fetchUsers,
  type ConnectionSummary,
  type OAuthPipelineListItem,
} from '../lib/api';
import { useWebSocket, type WSMessage } from '../lib/ws';
import { useAuthStore } from '../store/auth';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ConnectionInspectPanel } from '../components/ConnectionInspectPanel';
import { PageHeader, PageShell } from '../components/PageLayout';
import { EmptyState, FilterCard, MobileSheet, TableCard, TableScroller } from '../components/PagePrimitives';
import { Skeleton } from '../components/ui/skeleton';
import {
  SortTh,
  ConnectionFilterBuilder,
  MultiSelect,
  createPresetFilterCondition,
  createEmptyFilterCondition,
  isFilterConditionActive,
  type FilterCondition,
} from '../components/TrafficComponents';
import { fmtDate, fmtDuration, fmtBytes, statusColor, methodColor, httpStatusColor } from '../lib/utils';

const LIMIT = 50;

function createGlobalRequiredConditions(): FilterCondition[] {
  return [
    createPresetFilterCondition('server_id'),
    createPresetFilterCondition('status'),
  ];
}

function syncStatusCodeRequired(conditions: FilterCondition[]): FilterCondition[] {
  const statusCondition = conditions.find((condition) => condition.field === 'status');
  const needsStatusCode = statusCondition?.values.includes('completed') ?? false;
  const existingStatusCode = conditions.find((condition) => condition.field === 'res_status_code');

  if (needsStatusCode && !existingStatusCode) {
    return [...conditions, createPresetFilterCondition('res_status_code')];
  }

  if (!needsStatusCode && existingStatusCode) {
    return conditions.filter((condition) => condition.field !== 'res_status_code');
  }

  return conditions;
}

// ─── Connection row ───────────────────────────────────────────────────────────

function TrafficRow({ c, isNew, selected, onSelect }: {
  c: ConnectionSummary;
  isNew: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <tr
      className={`cursor-pointer transition-colors
        ${selected ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}
        ${isNew && !selected ? 'animate-pulse-once' : ''}
      `}
      onClick={() => onSelect(c.id)}
    >
      <td className={`sticky left-0 z-10 px-4 py-2.5 text-xs whitespace-nowrap ${selected ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-white dark:bg-gray-900'} text-gray-400 dark:text-gray-500`}>{fmtDate(c.req_timestamp)}</td>
      <td
        className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap truncate"
        title={c.user_id != null ? `${c.user_name ?? `User ${c.user_id}`} (#${c.user_id})` : undefined}
      >
        {c.user_id != null
          ? (c.user_name ?? `User ${c.user_id}`)
          : <span className="text-gray-300 dark:text-gray-600">anon</span>}
      </td>
      <td className="px-4 py-2.5"><Badge className={methodColor(c.req_method)}>{c.req_method}</Badge></td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 max-w-xs truncate" title={c.req_host ? `${c.req_host}${c.req_url}` : c.req_url}>
        <div className="flex items-center gap-2">
          <span className="truncate">
            {c.req_host && <span className="text-gray-400 dark:text-gray-500">{c.req_host}</span>}{c.req_url}
          </span>
          {c.is_system_heartbeat && (
            <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
              heartbeat
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[100px]">{c.server_name ?? '—'}</td>
      <td className="px-4 py-2.5"><Badge className={statusColor(c.status)}>{c.status}</Badge></td>
      <td className="px-4 py-2.5">
        {c.res_status_code
          ? <Badge className={httpStatusColor(c.res_status_code)}>{c.res_status_code}</Badge>
          : <span className="text-gray-300 text-xs">—</span>}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 text-right whitespace-nowrap">{fmtBytes(c.req_body_size)}</td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 text-right whitespace-nowrap">{fmtBytes(c.res_body_size)}</td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 text-right">{fmtDuration(c.duration_ms)}</td>
    </tr>
  );
}

function OAuthPipelineRow({ pipeline, onSelect }: { pipeline: OAuthPipelineListItem; onSelect: (id: string) => void }) {
  return (
    <tr
      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      onClick={() => onSelect(pipeline.id)}
    >
      <td className="sticky left-0 z-10 bg-white dark:bg-gray-900 px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
        {pipeline.started_at ? fmtDate(pipeline.started_at) : '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
        {pipeline.participant_user?.name ?? pipeline.participant_user?.username ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[140px]">
        {pipeline.authentication_server?.name ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]">
        {pipeline.resource_servers.length > 0
          ? pipeline.resource_servers.map((server) => server.name).join(', ')
          : '—'}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">
        {pipeline.access_token_fingerprint}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[180px] truncate" title={pipeline.diagnostics_summary}>
        <div className="space-y-1">
          <div>{pipeline.diagnostics_summary}</div>
          {(pipeline.refreshed_from || pipeline.has_descendants) && (
            <div className="flex flex-wrap items-center gap-1">
              {pipeline.refreshed_from && (
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  refreshed from {pipeline.refreshed_from.accessTokenPreview}
                </Badge>
              )}
              {pipeline.has_descendants && (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                  {pipeline.descendant_count} descendant{pipeline.descendant_count === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-right text-gray-500 dark:text-gray-400">
        {pipeline.resource_call_count}
      </td>
      <td className="px-4 py-2.5">
        <Badge className={pipeline.complete ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
          {pipeline.complete ? 'complete' : 'incomplete'}
        </Badge>
      </td>
      <td className="px-4 py-2.5">
        <Badge className={pipeline.legal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
          {pipeline.legal ? 'legal' : 'illegal'}
        </Badge>
      </td>
      <td className="px-4 py-2.5">
        <Badge className={pipeline.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
          {pipeline.success ? 'success' : 'failed'}
        </Badge>
      </td>
    </tr>
  );
}

function OAuthPipelineMobileCard({ pipeline, onSelect }: { pipeline: OAuthPipelineListItem; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pipeline.id)}
      className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {pipeline.started_at ? fmtDate(pipeline.started_at) : '—'}
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {pipeline.participant_user?.name ?? pipeline.participant_user?.username ?? 'Unknown participant'}
          </p>
        </div>
        <Badge className={pipeline.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
          {pipeline.success ? 'success' : 'failed'}
        </Badge>
      </div>

      <div className="mt-3 space-y-2 text-xs text-gray-500 dark:text-gray-400">
        <p><span className="text-gray-400 dark:text-gray-500">Auth:</span> {pipeline.authentication_server?.name ?? '—'}</p>
        <p><span className="text-gray-400 dark:text-gray-500">Resources:</span> {pipeline.resource_servers.length > 0 ? pipeline.resource_servers.map((server) => server.name).join(', ') : '—'}</p>
        <p className="font-mono text-gray-700 dark:text-gray-300 break-all">{pipeline.access_token_fingerprint}</p>
        <p>{pipeline.diagnostics_summary}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge className={pipeline.complete ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
          {pipeline.complete ? 'complete' : 'incomplete'}
        </Badge>
        <Badge className={pipeline.legal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
          {pipeline.legal ? 'legal' : 'illegal'}
        </Badge>
        <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
          {pipeline.resource_call_count} calls
        </Badge>
      </div>
    </button>
  );
}

// ─── TrafficPage ──────────────────────────────────────────────────────────────

export function TrafficPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const [live, setLive] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [requiredConditions, setRequiredConditions] = useState<FilterCondition[]>(createGlobalRequiredConditions);
  const [conditions, setConditions] = useState<FilterCondition[]>([createEmptyFilterCondition()]);
  const [debouncedConditions, setDebouncedConditions] = useState<FilterCondition[]>([]);
  const [oauthAccessToken, setOauthAccessToken] = useState(() => searchParams.get('oauth_access_token') ?? '');
  const [debouncedOauthAccessToken, setDebouncedOauthAccessToken] = useState('');
  const [oauthParticipantUserIds, setOauthParticipantUserIds] = useState<string[]>(() => (searchParams.get('oauth_participant_user_id') ?? '').split(',').filter(Boolean));
  const [oauthAuthServerIds, setOauthAuthServerIds] = useState<string[]>(() => (searchParams.get('oauth_authentication_server_id') ?? '').split(',').filter(Boolean));
  const [oauthResourceServerIds, setOauthResourceServerIds] = useState<string[]>(() => (searchParams.get('oauth_resource_server_id') ?? '').split(',').filter(Boolean));
  const [oauthLegal, setOauthLegal] = useState<'all' | 'legal' | 'illegal'>(() => {
    const value = searchParams.get('oauth_legal');
    return value === 'legal' || value === 'illegal' ? value : 'all';
  });
  const [oauthSuccess, setOauthSuccess] = useState<'all' | 'success' | 'failed'>(() => {
    const value = searchParams.get('oauth_success');
    return value === 'success' || value === 'failed' ? value : 'all';
  });
  const [showHeartbeatTraffic, setShowHeartbeatTraffic] = useState(() => searchParams.get('show_heartbeat') === 'true');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedConditions(conditions), 300);
    return () => clearTimeout(t);
  }, [conditions]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedOauthAccessToken(oauthAccessToken.trim()), 300);
    return () => clearTimeout(t);
  }, [oauthAccessToken]);

  useEffect(() => {
    setSearchParams((prev) => {
      if (showHeartbeatTraffic) prev.set('show_heartbeat', 'true');
      else prev.delete('show_heartbeat');

      if (oauthAccessToken.trim()) prev.set('oauth_access_token', oauthAccessToken.trim());
      else prev.delete('oauth_access_token');

      if (oauthParticipantUserIds.length > 0) prev.set('oauth_participant_user_id', oauthParticipantUserIds.join(','));
      else prev.delete('oauth_participant_user_id');

      if (oauthAuthServerIds.length > 0) prev.set('oauth_authentication_server_id', oauthAuthServerIds.join(','));
      else prev.delete('oauth_authentication_server_id');

      if (oauthResourceServerIds.length > 0) prev.set('oauth_resource_server_id', oauthResourceServerIds.join(','));
      else prev.delete('oauth_resource_server_id');

      if (oauthLegal !== 'all') prev.set('oauth_legal', oauthLegal);
      else prev.delete('oauth_legal');

      if (oauthSuccess !== 'all') prev.set('oauth_success', oauthSuccess);
      else prev.delete('oauth_success');

      return prev;
    });
  }, [showHeartbeatTraffic, oauthAccessToken, oauthParticipantUserIds, oauthAuthServerIds, oauthResourceServerIds, oauthLegal, oauthSuccess, setSearchParams]);

  const view = (searchParams.get('view') ?? 'raw') as 'raw' | 'oauth';
  const sort      = searchParams.get('sort')  ?? 'req_timestamp';
  const order     = (searchParams.get('order') ?? 'desc') as 'asc' | 'desc';

  const { data: trafficAccessPolicy } = useQuery({
    queryKey: ['traffic-access-policy', currentUser?.sub, currentUser?.role],
    queryFn: fetchTrafficAccessPolicy,
    enabled: !!currentUser,
  });
  const canViewAllTraffic = trafficAccessPolicy?.can_view_all_traffic ?? false;
  const trafficScope = canViewAllTraffic ? 'all' : 'mine';
  const handleRequiredChange = (next: FilterCondition[]) => setRequiredConditions(syncStatusCodeRequired(next));

  const handleSort = (col: string) =>
    setSearchParams((prev) => {
      if (prev.get('sort') === col) prev.set('order', prev.get('order') === 'asc' ? 'desc' : 'asc');
      else { prev.set('sort', col); prev.set('order', 'desc'); }
      return prev;
    });

  const hasActiveFilters =
    requiredConditions.some(isFilterConditionActive) ||
    conditions.some(isFilterConditionActive) ||
    showHeartbeatTraffic ||
    sort !== 'req_timestamp' || order !== 'desc';

  useEffect(() => {
    setSelectedId(null);
  }, [view]);

  useEffect(() => {
    if (canViewAllTraffic) return;
    setConditions((current) => current.filter((condition) => condition.field !== 'user_id'));
    setOauthParticipantUserIds([]);
  }, [canViewAllTraffic]);

  const resetAll = () => {
    setRequiredConditions(createGlobalRequiredConditions());
    setConditions([createEmptyFilterCondition()]);
    setSearchParams((prev) => {
      prev.delete('sort');
      prev.delete('order');
      prev.delete('show_heartbeat');
      return prev;
    });
    setShowHeartbeatTraffic(false);
  };

  const { data: servers = [] } = useQuery({ queryKey: ['dashboard-servers'], queryFn: fetchDashboardServers });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: fetchUsers, enabled: canViewAllTraffic });
  const { data: filterOptions } = useQuery({
    queryKey: ['connection-filter-options', trafficScope],
    queryFn: () => fetchConnectionFilterOptions({ scope: trafficScope }),
    enabled: view === 'raw',
  });
  const { data: oauthFilterOptions } = useQuery({
    queryKey: ['oauth-filter-options', trafficScope, currentUser?.sub],
    queryFn: fetchOAuthFilterOptions,
    enabled: view === 'oauth',
  });

  const activeDebouncedConditions = [...requiredConditions, ...debouncedConditions].filter(isFilterConditionActive);
  const filtersString = activeDebouncedConditions.length > 0 ? JSON.stringify(activeDebouncedConditions) : undefined;
  const serverOptions = servers.map((server) => ({ value: server.id, label: server.name }));
  const statusCodeOptions = (filterOptions?.status_codes ?? []).map((code) => ({ value: String(code), label: String(code) }));
  const userOptions = users.map((user) => ({
    value: String(user.id),
    label: user.name !== user.username ? `${user.name} (${user.username})` : user.username,
  }));

  const queryKey = [
    'connections-global',
    trafficScope, filtersString ?? '', showHeartbeatTraffic ? 'heartbeat' : 'default', sort, order,
  ];

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch, isFetching } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchConnections({
      page: pageParam, limit: LIMIT,
      filters: filtersString,
      scope: trafficScope,
      include_system_heartbeat: showHeartbeatTraffic,
      sort, order,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.data.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
  });

  const {
    data: oauthData,
    isLoading: oauthLoading,
    isFetchingNextPage: oauthFetchingNextPage,
    hasNextPage: oauthHasNextPage,
    fetchNextPage: oauthFetchNextPage,
    refetch: refetchOAuth,
    isFetching: oauthFetching,
  } = useInfiniteQuery({
    queryKey: [
      'oauth-pipelines',
      trafficScope,
      debouncedOauthAccessToken,
      oauthParticipantUserIds.join(','),
      oauthAuthServerIds.join(','),
      oauthResourceServerIds.join(','),
      oauthLegal,
      oauthSuccess,
    ],
    queryFn: ({ pageParam }) => fetchOAuthPipelines({
      page: pageParam,
      limit: LIMIT,
      access_token: debouncedOauthAccessToken || undefined,
      participant_user_id: oauthParticipantUserIds,
      authentication_server_id: oauthAuthServerIds,
      resource_server_id: oauthResourceServerIds,
      legal: oauthLegal,
      success: oauthSuccess,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.data.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
    enabled: view === 'oauth',
  });

  const allConnections = data?.pages.flatMap(p => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const allOAuthPipelines = oauthData?.pages.flatMap((p) => p.data) ?? [];
  const oauthTotal = oauthData?.pages[0]?.total ?? 0;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        if (view === 'raw' && hasNextPage && !isFetchingNextPage) fetchNextPage();
        if (view === 'oauth' && oauthHasNextPage && !oauthFetchingNextPage) oauthFetchNextPage();
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [view, hasNextPage, isFetchingNextPage, fetchNextPage, oauthHasNextPage, oauthFetchingNextPage, oauthFetchNextPage]);

  const handleWsMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'connection:new' || msg.type === 'connection:completed' || msg.type === 'connection:error') {
      const payload = msg.payload as { id: string } | undefined;
      if (payload?.id) {
        setNewIds((prev) => new Set([...prev, payload.id]));
        setTimeout(() => setNewIds((prev) => { const n = new Set(prev); n.delete(payload.id); return n; }), 3000);
      }
      qc.invalidateQueries({ queryKey });
    }
  }, [qc, queryKey]);

  const wsChannel = canViewAllTraffic ? 'traffic:all' : (currentUser ? `traffic:user:${currentUser.sub}` : '');
  useWebSocket({ channels: wsChannel ? [wsChannel] : [], onMessage: handleWsMessage, enabled: !!wsChannel && live && view === 'raw' });

  const clearTrafficMut = useMutation({
    mutationFn: clearAllTraffic,
    onSuccess: async () => {
      setSelectedId(null);
      setNewIds(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['connections-global'] }),
        qc.invalidateQueries({ queryKey: ['connection-filter-options'] }),
        qc.invalidateQueries({ queryKey: ['connection'] }),
        qc.invalidateQueries({ queryKey: ['oauth-pipelines'] }),
        qc.invalidateQueries({ queryKey: ['oauth-filter-options'] }),
        qc.invalidateQueries({ queryKey: ['oauth-pipeline'] }),
      ]);
    },
  });

  return (
    <PageShell width="wide">
      <div className="mx-auto flex w-full gap-4 items-start">
      <div className="min-w-0 flex-1 space-y-4">
        <PageHeader
          title="Traffic"
          description={
            view === 'raw' && data
              ? `${allConnections.length.toLocaleString()} / ${total.toLocaleString()} connections`
              : view === 'oauth' && oauthData
                ? `${allOAuthPipelines.length.toLocaleString()} / ${oauthTotal.toLocaleString()} OAuth pipelines`
                : 'Inspect live traffic, drill into connection details, and switch between raw traffic and OAuth pipeline views.'
          }
          actions={(
            <>
            <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
              <button
                type="button"
                onClick={() => setSearchParams((prev) => {
                  prev.set('view', 'raw');
                  return prev;
                })}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${view === 'raw'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                Raw Traffic
              </button>
              <button
                type="button"
                onClick={() => setSearchParams((prev) => {
                  prev.set('view', 'oauth');
                  return prev;
                })}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${view === 'oauth'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                OAuth Pipelines
              </button>
            </div>

            {view === 'raw' && hasActiveFilters && (
              <Button variant="secondary" size="sm" onClick={resetAll}>
                <X className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
            <Button variant="secondary" size="sm" className="md:hidden" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </Button>
            {view === 'raw' && (
              <Button variant={live ? 'primary' : 'secondary'} size="sm" onClick={() => setLive((v) => { if (!v) refetch(); return !v; })}>
                {live ? <RadioTower className="h-3.5 w-3.5 animate-pulse" /> : <Radio className="h-3.5 w-3.5" />}
                {live ? 'Live' : 'Live off'}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => view === 'raw' ? refetch() : refetchOAuth()}
              loading={view === 'raw' ? (isFetching && !isFetchingNextPage) : oauthFetching}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            {currentUser?.role === 'admin' && (
              <Button
                variant="danger"
                size="sm"
                loading={clearTrafficMut.isPending}
                onClick={async () => {
                  if (!confirm('Clear all captured traffic and OAuth pipelines? This cannot be undone.')) return;
                  await clearTrafficMut.mutateAsync();
                  if (view === 'raw') await refetch();
                  else await refetchOAuth();
                }}
              >
                Clear Traffic
              </Button>
            )}
            </>
          )}
        />

        {view === 'raw' && (
          <FilterCard className="hidden md:block">
            <ConnectionFilterBuilder
              requiredConditions={requiredConditions}
              conditions={conditions}
              serverOptions={serverOptions}
              statusCodeOptions={statusCodeOptions}
              userOptions={userOptions}
              allowUserFilter={canViewAllTraffic}
              onRequiredChange={handleRequiredChange}
              onChange={setConditions}
            />
            <div className="mt-4 flex items-center gap-2 border-t border-gray-200 pt-4 text-sm dark:border-gray-700">
              <input
                id="show_heartbeat_traffic_global"
                type="checkbox"
                checked={showHeartbeatTraffic}
                onChange={(e) => setShowHeartbeatTraffic(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor="show_heartbeat_traffic_global" className="text-gray-700 dark:text-gray-300">
                Show system heartbeat traffic
              </label>
            </div>
          </FilterCard>
        )}
        {view === 'oauth' && (
          <FilterCard className="hidden md:block">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Access token
                </label>
                <input
                  value={oauthAccessToken}
                  onChange={(e) => setOauthAccessToken(e.target.value)}
                  placeholder="Full token or fingerprint"
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              {canViewAllTraffic && (
                <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Participant user
                    </label>
                    <MultiSelect
                      placeholder="users"
                      options={(oauthFilterOptions?.participant_users ?? []).map((user) => ({
                        value: String(user.id),
                        label: user.name !== user.username ? `${user.name} (${user.username})` : user.username,
                      }))}
                      selected={oauthParticipantUserIds}
                      onChange={setOauthParticipantUserIds}
                      filterable
                      searchPlaceholder="Filter users..."
                    />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Authentication server
                </label>
                <MultiSelect
                  placeholder="auth servers"
                  options={(oauthFilterOptions?.authentication_servers ?? []).map((server) => ({
                    value: server.id,
                    label: server.name,
                  }))}
                  selected={oauthAuthServerIds}
                  onChange={setOauthAuthServerIds}
                  filterable
                  searchPlaceholder="Filter auth servers..."
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Resource server
                </label>
                <MultiSelect
                  placeholder="resource servers"
                  options={(oauthFilterOptions?.resource_servers ?? []).map((server) => ({
                    value: server.id,
                    label: server.name,
                  }))}
                  selected={oauthResourceServerIds}
                  onChange={setOauthResourceServerIds}
                  filterable
                  searchPlaceholder="Filter resource servers..."
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Legal
                </label>
                <select
                  value={oauthLegal}
                  onChange={(e) => setOauthLegal(e.target.value as typeof oauthLegal)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="all">All</option>
                  <option value="legal">Legal</option>
                  <option value="illegal">Illegal</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Success
                </label>
                <select
                  value={oauthSuccess}
                  onChange={(e) => setOauthSuccess(e.target.value as typeof oauthSuccess)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="all">All</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOauthAccessToken('');
                  setOauthParticipantUserIds([]);
                  setOauthAuthServerIds([]);
                  setOauthResourceServerIds([]);
                  setOauthLegal('all');
                  setOauthSuccess('all');
                }}
              >
                <X className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </FilterCard>
        )}

        <MobileSheet
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title={view === 'raw' ? 'Raw Traffic Filters' : 'OAuth Pipeline Filters'}
          description="Adjust filters and close the sheet to return to the list."
        >
          {view === 'raw' ? (
            <div className="space-y-4">
              <ConnectionFilterBuilder
                requiredConditions={requiredConditions}
                conditions={conditions}
                serverOptions={serverOptions}
                statusCodeOptions={statusCodeOptions}
                userOptions={userOptions}
                allowUserFilter={canViewAllTraffic}
                onRequiredChange={handleRequiredChange}
                onChange={setConditions}
              />
              <div className="flex items-center gap-2 border-t border-gray-200 pt-4 text-sm dark:border-gray-700">
                <input
                  id="show_heartbeat_traffic_global_mobile"
                  type="checkbox"
                  checked={showHeartbeatTraffic}
                  onChange={(e) => setShowHeartbeatTraffic(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <label htmlFor="show_heartbeat_traffic_global_mobile" className="text-gray-700 dark:text-gray-300">
                  Show system heartbeat traffic
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Access token
                </label>
                <input
                  value={oauthAccessToken}
                  onChange={(e) => setOauthAccessToken(e.target.value)}
                  placeholder="Full token or fingerprint"
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              {canViewAllTraffic && (
                <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Participant user
                    </label>
                    <MultiSelect
                      placeholder="users"
                      options={(oauthFilterOptions?.participant_users ?? []).map((user) => ({
                        value: String(user.id),
                        label: user.name !== user.username ? `${user.name} (${user.username})` : user.username,
                      }))}
                      selected={oauthParticipantUserIds}
                      onChange={setOauthParticipantUserIds}
                      filterable
                      searchPlaceholder="Filter users..."
                    />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Authentication server
                </label>
                <MultiSelect
                  placeholder="auth servers"
                  options={(oauthFilterOptions?.authentication_servers ?? []).map((server) => ({
                    value: server.id,
                    label: server.name,
                  }))}
                  selected={oauthAuthServerIds}
                  onChange={setOauthAuthServerIds}
                  filterable
                  searchPlaceholder="Filter auth servers..."
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Resource server
                </label>
                <MultiSelect
                  placeholder="resource servers"
                  options={(oauthFilterOptions?.resource_servers ?? []).map((server) => ({
                    value: server.id,
                    label: server.name,
                  }))}
                  selected={oauthResourceServerIds}
                  onChange={setOauthResourceServerIds}
                  filterable
                  searchPlaceholder="Filter resource servers..."
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Legal
                </label>
                <select
                  value={oauthLegal}
                  onChange={(e) => setOauthLegal(e.target.value as typeof oauthLegal)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="all">All</option>
                  <option value="legal">Legal</option>
                  <option value="illegal">Illegal</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Success
                </label>
                <select
                  value={oauthSuccess}
                  onChange={(e) => setOauthSuccess(e.target.value as typeof oauthSuccess)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="all">All</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOauthAccessToken('');
                  setOauthParticipantUserIds([]);
                  setOauthAuthServerIds([]);
                  setOauthResourceServerIds([]);
                  setOauthLegal('all');
                  setOauthSuccess('all');
                }}
              >
                <X className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          )}
        </MobileSheet>

        <TableCard>
          <TableScroller>
            {view === 'raw' ? (
              isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
              ) : !allConnections.length ? (
              <EmptyState
                title="No connections match the current filters"
                description={showHeartbeatTraffic
                  ? 'No raw traffic matched the current filters, including system heartbeat traffic.'
                  : 'System heartbeat traffic is currently hidden. Enable it in Filters if you want to inspect heartbeat requests.'}
              />
              ) : (
                <>
                  <table className="min-w-[1400px] w-full table-fixed text-sm">
                    <colgroup>
                      <col className="w-[168px]" />
                      <col className="w-[168px]" />
                      <col className="w-[96px]" />
                      <col />
                      <col className="w-[140px]" />
                      <col className="w-[116px]" />
                      <col className="w-[92px]" />
                      <col className="w-[104px]" />
                      <col className="w-[104px]" />
                      <col className="w-[104px]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        <SortTh col="req_timestamp"  label="Time"     sort={sort} order={order} onSort={handleSort} />
                        <th className="px-4 py-3 font-medium">Participant</th>
                        <th className="px-4 py-3 font-medium">Method</th>
                        <th className="px-4 py-3 font-medium">URL</th>
                        <th className="px-4 py-3 font-medium">Server</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <SortTh col="res_status_code" label="HTTP"    sort={sort} order={order} onSort={handleSort} />
                        <SortTh col="req_body_size" label="Req size" sort={sort} order={order} onSort={handleSort} align="right" />
                        <SortTh col="res_body_size" label="Res size" sort={sort} order={order} onSort={handleSort} align="right" />
                        <SortTh col="duration_ms"    label="Duration" sort={sort} order={order} onSort={handleSort} align="right" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                      {allConnections.map((c) => (
                        <TrafficRow
                          key={c.id}
                          c={c}
                          isNew={newIds.has(c.id)}
                          selected={c.id === selectedId}
                          onSelect={(id) => setSelectedId(prev => prev === id ? null : id)}
                        />
                      ))}
                    </tbody>
                  </table>
                  <div ref={sentinelRef} className="py-4 flex justify-center">
                    {isFetchingNextPage && (
                      <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />Loading more…
                      </div>
                    )}
                    {!hasNextPage && allConnections.length > 0 && !isLoading && (
                      <p className="text-xs text-gray-300 dark:text-gray-600">All {total.toLocaleString()} connections loaded</p>
                    )}
                  </div>
                </>
              )
            ) : oauthLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !allOAuthPipelines.length ? (
              <EmptyState title="No OAuth pipelines found yet" />
            ) : (
              <>
                <div className="space-y-3 p-4 md:hidden">
                  {allOAuthPipelines.map((pipeline) => (
                    <OAuthPipelineMobileCard
                      key={pipeline.id}
                      pipeline={pipeline}
                      onSelect={(id) => navigate(`/oauth/pipelines/${id}`, { state: { fromSearch: `?${searchParams.toString()}` } })}
                    />
                  ))}
                </div>
                <table className="hidden min-w-[1320px] w-full table-fixed text-sm md:table">
                  <colgroup>
                    <col className="w-[168px]" />
                    <col className="w-[168px]" />
                    <col className="w-[168px]" />
                    <col className="w-[220px]" />
                    <col className="w-[220px]" />
                    <col />
                    <col className="w-[92px]" />
                    <col className="w-[112px]" />
                    <col className="w-[96px]" />
                    <col className="w-[96px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      <th className="px-4 py-3 font-medium">Started</th>
                      <th className="px-4 py-3 font-medium">Participant</th>
                      <th className="px-4 py-3 font-medium">Auth server</th>
                      <th className="px-4 py-3 font-medium">Resource servers</th>
                      <th className="px-4 py-3 font-medium">Access token</th>
                      <th className="px-4 py-3 font-medium">Summary</th>
                      <th className="px-4 py-3 font-medium text-right">Calls</th>
                      <th className="px-4 py-3 font-medium">Complete</th>
                      <th className="px-4 py-3 font-medium">Legal</th>
                      <th className="px-4 py-3 font-medium">Success</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {allOAuthPipelines.map((pipeline) => (
                      <OAuthPipelineRow
                        key={pipeline.id}
                        pipeline={pipeline}
                        onSelect={(id) => navigate(`/oauth/pipelines/${id}`, { state: { fromSearch: `?${searchParams.toString()}` } })}
                      />
                    ))}
                  </tbody>
                </table>
                <div ref={sentinelRef} className="py-4 flex justify-center">
                  {oauthFetchingNextPage && (
                    <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />Loading more…
                    </div>
                  )}
                  {!oauthHasNextPage && allOAuthPipelines.length > 0 && !oauthLoading && (
                    <p className="text-xs text-gray-300 dark:text-gray-600">All {oauthTotal.toLocaleString()} pipelines loaded</p>
                  )}
                </div>
              </>
            )}
          </TableScroller>
        </TableCard>
      </div>

      {view === 'raw' && (
        <ConnectionInspectPanel
          id={selectedId}
          onClose={() => setSelectedId(null)}
          description="Click a traffic row to inspect its raw request and response."
        />
      )}
      </div>
    </PageShell>
  );
}
