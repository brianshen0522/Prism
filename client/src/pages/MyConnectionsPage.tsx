import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Radio, RadioTower, X, ExternalLink } from 'lucide-react';
import {
  fetchConnections,
  fetchConnection,
  fetchConnectionFilterOptions,
  fetchDashboardServers,
  fetchOAuthPipelines,
  type ConnectionSummary,
  type OAuthPipelineListItem,
} from '../lib/api';
import { useWebSocket, type WSMessage } from '../lib/ws';
import { useAuthStore } from '../store/auth';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { ConnectionDetailContent, ConnectionDetailSkeleton } from '../components/ConnectionDetail';
import {
  SortTh,
  ConnectionFilterBuilder,
  createEmptyFilterCondition,
  createPresetFilterCondition,
  createScopeFilterCondition,
  isFilterConditionActive,
  type FilterCondition,
} from '../components/TrafficComponents';
import { fmtDate, fmtDuration, fmtBytes, statusColor, methodColor, httpStatusColor } from '../lib/utils';

const LIMIT = 50;

function createMyRequiredConditions(): FilterCondition[] {
  return [
    createScopeFilterCondition(),
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
      <td className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmtDate(c.req_timestamp)}</td>
      <td className="px-4 py-2.5"><Badge className={methodColor(c.req_method)}>{c.req_method}</Badge></td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 max-w-xs truncate" title={c.req_url}>{c.req_url}</td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[100px]">{c.server_name ?? '—'}</td>
      <td className="px-4 py-2.5"><Badge className={statusColor(c.status)}>{c.status}</Badge></td>
      <td className="px-4 py-2.5">
        {c.res_status_code
          ? <Badge className={httpStatusColor(c.res_status_code)}>{c.res_status_code}</Badge>
          : <span className="text-gray-300 text-xs">—</span>}
      </td>
      {!selected && <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 text-right whitespace-nowrap">{fmtBytes(c.req_body_size)}</td>}
      {!selected && <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 text-right whitespace-nowrap">{fmtBytes(c.res_body_size)}</td>}
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 text-right">{fmtDuration(c.duration_ms)}</td>
    </tr>
  );
}

function OAuthPipelineRow({ pipeline, onSelect }: { pipeline: OAuthPipelineListItem; onSelect: (id: string) => void }) {
  return (
    <tr className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={() => onSelect(pipeline.id)}>
      <td className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{pipeline.started_at ? fmtDate(pipeline.started_at) : '—'}</td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[140px]">{pipeline.authentication_server?.name ?? '—'}</td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]">
        {pipeline.resource_servers.length > 0 ? pipeline.resource_servers.map((server) => server.name).join(', ') : '—'}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">{pipeline.access_token_fingerprint}</td>
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
      <td className="px-4 py-2.5 text-xs text-right text-gray-500 dark:text-gray-400">{pipeline.resource_call_count}</td>
      <td className="px-4 py-2.5"><Badge className={pipeline.complete ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>{pipeline.complete ? 'complete' : 'incomplete'}</Badge></td>
      <td className="px-4 py-2.5"><Badge className={pipeline.legal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>{pipeline.legal ? 'legal' : 'illegal'}</Badge></td>
      <td className="px-4 py-2.5"><Badge className={pipeline.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>{pipeline.success ? 'success' : 'failed'}</Badge></td>
    </tr>
  );
}

// ─── MyConnectionsPage ────────────────────────────────────────────────────────

export function MyConnectionsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const [live, setLive] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [requiredConditions, setRequiredConditions] = useState<FilterCondition[]>(createMyRequiredConditions);
  const [conditions, setConditions] = useState<FilterCondition[]>([createEmptyFilterCondition()]);
  const [debouncedConditions, setDebouncedConditions] = useState<FilterCondition[]>([]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedConditions(conditions), 300);
    return () => clearTimeout(t);
  }, [conditions]);

  const view = (searchParams.get('view') ?? 'raw') as 'raw' | 'oauth';
  const sort      = searchParams.get('sort')  ?? 'req_timestamp';
  const order     = (searchParams.get('order') ?? 'desc') as 'asc' | 'desc';
  const scopeCondition = requiredConditions.find((condition) => condition.field === 'scope');
  const scope = (scopeCondition?.values[0] === 'all' ? 'all' : 'mine') as 'mine' | 'all';
  const handleRequiredChange = (next: FilterCondition[]) => setRequiredConditions(syncStatusCodeRequired(next));

  const handleSort = (col: string) =>
    setSearchParams((prev) => {
      if (prev.get('sort') === col) prev.set('order', prev.get('order') === 'asc' ? 'desc' : 'asc');
      else { prev.set('sort', col); prev.set('order', 'desc'); }
      return prev;
    });

  const hasActiveFilters =
    scope !== 'mine' ||
    requiredConditions.some((condition) => condition.field !== 'scope' && isFilterConditionActive(condition)) ||
    conditions.some((condition) => condition.field !== 'scope' && isFilterConditionActive(condition)) ||
    sort !== 'req_timestamp' || order !== 'desc';

  const resetAll = () => {
    setRequiredConditions(createMyRequiredConditions());
    setConditions([createEmptyFilterCondition()]);
    setSearchParams((prev) => {
      prev.delete('sort');
      prev.delete('order');
      return prev;
    });
  };

  const { data: servers = [] } = useQuery({ queryKey: ['dashboard-servers'], queryFn: fetchDashboardServers });
  const { data: filterOptions } = useQuery({
    queryKey: ['connection-filter-options', scope],
    queryFn: () => fetchConnectionFilterOptions({ scope }),
  });

  const activeDebouncedConditions = [...requiredConditions, ...debouncedConditions].filter(
    (condition) => condition.field !== 'scope' && isFilterConditionActive(condition),
  );
  const filtersString = activeDebouncedConditions.length > 0 ? JSON.stringify(activeDebouncedConditions) : undefined;
  const serverOptions = servers.map((server) => ({ value: server.id, label: server.name }));
  const statusCodeOptions = (filterOptions?.status_codes ?? []).map((code) => ({ value: String(code), label: String(code) }));

  const queryKey = [
    'connections-my',
    scope, filtersString ?? '', sort, order,
  ];

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch, isFetching } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchConnections({
      page: pageParam, limit: LIMIT,
      scope: scope === 'all' ? 'all' : undefined,
      filters: filtersString,
      sort, order,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.data.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
  });

  const allConnections = data?.pages.flatMap(p => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  useEffect(() => {
    setSelectedId(null);
  }, [view]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const wsChannel = currentUser ? `traffic:user:${currentUser.sub}` : '';

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

  useWebSocket({ channels: wsChannel ? [wsChannel] : [], onMessage: handleWsMessage, enabled: live && !!wsChannel && view === 'raw' });

  const {
    data: oauthPipelines,
    isLoading: oauthLoading,
    refetch: refetchOAuth,
    isFetching: oauthFetching,
  } = useQuery({
    queryKey: ['oauth-pipelines-my', currentUser?.sub],
    queryFn: () => fetchOAuthPipelines({
      page: 1,
      limit: LIMIT,
      participant_user_id: currentUser ? [String(currentUser.sub)] : undefined,
    }),
    enabled: view === 'oauth' && !!currentUser,
  });

  return (
    <div className="flex gap-4 items-start">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">My Connections</h1>
            {view === 'raw' && data && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {allConnections.length.toLocaleString()} / {total.toLocaleString()} connections
              </p>
            )}
            {view === 'oauth' && oauthPipelines && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {oauthPipelines.data.length.toLocaleString()} / {oauthPipelines.total.toLocaleString()} OAuth pipelines
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
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
            {view === 'raw' && (
              <Button variant={live ? 'primary' : 'secondary'} size="sm" onClick={() => setLive((v) => { if (!v) refetch(); return !v; })}>
                {live ? <RadioTower className="h-3.5 w-3.5 animate-pulse" /> : <Radio className="h-3.5 w-3.5" />}
                {live ? 'Live' : 'Live off'}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => view === 'raw' ? refetch() : refetchOAuth()} loading={view === 'raw' ? (isFetching && !isFetchingNextPage) : oauthFetching}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {view === 'raw' && (
          <ConnectionFilterBuilder
            requiredConditions={requiredConditions}
            conditions={conditions}
            serverOptions={serverOptions}
            statusCodeOptions={statusCodeOptions}
            userOptions={[]}
            allowUserFilter={false}
            allowScopeFilter
            onRequiredChange={handleRequiredChange}
            onChange={setConditions}
          />
        )}

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {view === 'raw' ? (
              isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
              ) : !allConnections.length ? (
              <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">No connections match the current filters</div>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        <SortTh col="req_timestamp"  label="Time"     sort={sort} order={order} onSort={handleSort} />
                        <th className="px-4 py-3 font-medium">Method</th>
                        <th className="px-4 py-3 font-medium">URL</th>
                        <th className="px-4 py-3 font-medium">Server</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <SortTh col="res_status_code" label="HTTP"    sort={sort} order={order} onSort={handleSort} />
                        {!selectedId && <SortTh col="req_body_size" label="Req size" sort={sort} order={order} onSort={handleSort} align="right" />}
                        {!selectedId && <SortTh col="res_body_size" label="Res size" sort={sort} order={order} onSort={handleSort} align="right" />}
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
            ) : !(oauthPipelines?.data.length) ? (
              <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">No OAuth pipelines found yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Started</th>
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
                  {oauthPipelines.data.map((pipeline) => (
                    <OAuthPipelineRow
                      key={pipeline.id}
                      pipeline={pipeline}
                      onSelect={(id) => navigate(`/oauth/pipelines/${id}`, { state: { fromPath: '/connections', fromSearch: `?${searchParams.toString()}` } })}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {view === 'raw' && selectedId && <DetailPanel id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: c, isLoading } = useQuery({
    queryKey: ['connection', id],
    queryFn: () => fetchConnection(id),
  });

  return (
    <div className="w-[480px] shrink-0 self-start sticky top-6">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex-1 min-w-0">
            {c && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={methodColor(c.req_method)}>{c.req_method}</Badge>
                <span className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate">{c.req_url}</span>
              </div>
            )}
          </div>
          <a href={`/connections/${id}`} target="_blank" rel="noreferrer"
            className="shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Open in new tab">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button onClick={onClose}
            className="shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(100vh-8rem)]">
          {isLoading ? <ConnectionDetailSkeleton /> : c ? <ConnectionDetailContent c={c} /> : null}
        </div>
      </div>
    </div>
  );
}
