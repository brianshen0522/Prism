import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Radio, RadioTower, X, ExternalLink } from 'lucide-react';
import { fetchConnections, fetchConnection, fetchDashboardServers, type ConnectionSummary } from '../lib/api';
import { useWebSocket, type WSMessage } from '../lib/ws';
import { useAuthStore } from '../store/auth';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { ConnectionDetailContent, ConnectionDetailSkeleton } from '../components/ConnectionDetail';
import {
  SEL_CLS, HTTP_METHODS, MultiSelect, DateRangePicker, SortTh, Hl, rowMatchesSearch,
  SearchBuilder, SearchCondition, genCondId,
} from '../components/TrafficComponents';
import { fmtDate, fmtDuration, fmtBytes, statusColor, methodColor, httpStatusColor } from '../lib/utils';

// suppress unused warning
void SEL_CLS; void HTTP_METHODS;

const LIMIT = 50;
const INIT_CONDITIONS = (): SearchCondition[] => [{ id: genCondId(), term: '', scopes: [] }];

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  serverIds, methods, statuses, preset, from, to,
  servers,
  onServerIds, onMethods, onStatuses, onTimeChange,
}: {
  serverIds: string[]; methods: string[]; statuses: string[];
  preset: string; from: string; to: string;
  servers: { id: string; name: string }[];
  onServerIds: (v: string[]) => void;
  onMethods:   (v: string[]) => void;
  onStatuses:  (v: string[]) => void;
  onTimeChange: (preset: string, from: string, to: string) => void;
}) {
  const serverOpts = servers.map(s => ({ value: s.id, label: s.name }));
  const methodOpts = HTTP_METHODS.map(m => ({ value: m, label: m }));
  const statusOpts = [
    { value: 'completed', label: 'Completed' },
    { value: 'error',     label: 'Error' },
    { value: 'pending',   label: 'Pending' },
  ];

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <MultiSelect placeholder="Servers"  options={serverOpts} selected={serverIds} onChange={onServerIds} />
      <MultiSelect placeholder="Methods"  options={methodOpts} selected={methods}   onChange={onMethods} />
      <MultiSelect placeholder="Statuses" options={statusOpts} selected={statuses}  onChange={onStatuses} />
      <DateRangePicker preset={preset} from={from} to={to} onChange={onTimeChange} />
    </div>
  );
}

// ─── Connection row ───────────────────────────────────────────────────────────

function TrafficRow({ c, isNew, conditions, sqLogic, serverActive, searchMode, selected, onSelect }: {
  c: ConnectionSummary;
  isNew: boolean;
  conditions: SearchCondition[];
  sqLogic: 'and' | 'or';
  serverActive: boolean;
  searchMode: 'highlight' | 'filter';
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const hasAnyTerm = conditions.some(cond => cond.term.trim());
  const visibleMatch = rowMatchesSearch(c, conditions, sqLogic);
  const matches = serverActive || visibleMatch;

  if (hasAnyTerm && searchMode === 'filter' && !matches) return null;
  const dim = hasAnyTerm && searchMode === 'highlight' && !matches;

  const terms = conditions.map(cond => cond.term);

  return (
    <tr
      className={`cursor-pointer transition-colors
        ${selected ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}
        ${isNew && !selected ? 'animate-pulse-once' : ''}
        ${dim ? 'opacity-25' : ''}
      `}
      onClick={() => onSelect(c.id)}
    >
      <td className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmtDate(c.req_timestamp)}</td>
      <td className="px-4 py-2.5"><Badge className={methodColor(c.req_method)}>{c.req_method}</Badge></td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 max-w-xs truncate" title={c.req_url}>
        <Hl text={c.req_url} terms={terms} />
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[100px]">
        <Hl text={c.server_name ?? '—'} terms={terms} />
      </td>
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

// ─── MyConnectionsPage ────────────────────────────────────────────────────────

export function MyConnectionsPage() {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const [live, setLive] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Search state
  const [conditions, setConditions] = useState<SearchCondition[]>(INIT_CONDITIONS);
  const [sqLogic, setSqLogic] = useState<'and' | 'or'>('and');
  const [searchMode, setSearchMode] = useState<'highlight' | 'filter'>('highlight');
  const [debouncedConditions, setDebouncedConditions] = useState<SearchCondition[]>([]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedConditions(conditions), 300);
    return () => clearTimeout(t);
  }, [conditions]);

  const serverIds = (searchParams.get('server_id') ?? '').split(',').filter(Boolean);
  const methods   = (searchParams.get('method')    ?? '').split(',').filter(Boolean);
  const statuses  = (searchParams.get('status')    ?? '').split(',').filter(Boolean);
  const preset    = searchParams.get('preset') ?? '';
  const from      = searchParams.get('from') ?? '';
  const to        = searchParams.get('to')   ?? '';
  const scope     = (searchParams.get('scope') ?? 'mine') as 'mine' | 'all';
  const sort      = searchParams.get('sort')  ?? 'req_timestamp';
  const order     = (searchParams.get('order') ?? 'desc') as 'asc' | 'desc';

  const setScope = (s: 'mine' | 'all') =>
    setSearchParams((prev) => { prev.set('scope', s); return prev; });

  const setMultiFilter = (key: string, vals: string[]) =>
    setSearchParams((prev) => { if (vals.length) prev.set(key, vals.join(',')); else prev.delete(key); return prev; });

  const handleSort = (col: string) =>
    setSearchParams((prev) => {
      if (prev.get('sort') === col) prev.set('order', prev.get('order') === 'asc' ? 'desc' : 'asc');
      else { prev.set('sort', col); prev.set('order', 'desc'); }
      return prev;
    });

  const FILTER_KEYS = ['server_id', 'method', 'status', 'preset', 'from', 'to', 'scope', 'sort', 'order'];
  const hasActiveFilters =
    serverIds.length > 0 || methods.length > 0 || statuses.length > 0 ||
    preset || from || to || scope !== 'mine' ||
    conditions.some(c => c.term.trim()) ||
    sort !== 'req_timestamp' || order !== 'desc';

  const resetAll = () => {
    setConditions(INIT_CONDITIONS());
    setSqLogic('and');
    setSearchParams((prev) => { FILTER_KEYS.forEach(k => prev.delete(k)); return prev; });
  };

  const handleTimeChange = (newPreset: string, newFrom: string, newTo: string) =>
    setSearchParams((prev) => {
      if (newPreset) prev.set('preset', newPreset); else prev.delete('preset');
      if (newFrom)   prev.set('from', newFrom);     else prev.delete('from');
      if (newTo)     prev.set('to', newTo);         else prev.delete('to');
      return prev;
    });

  const { data: servers = [] } = useQuery({ queryKey: ['dashboard-servers'], queryFn: fetchDashboardServers });

  const activeDebouncedConds = debouncedConditions.filter(c => c.term.trim());
  const sqPayload = activeDebouncedConds.map(({ term, scopes }) => ({ term, scopes }));
  const filterMode = searchMode === 'filter';
  const sqString = filterMode && sqPayload.length > 0 ? JSON.stringify(sqPayload) : undefined;
  const serverActive = filterMode && sqPayload.length > 0;

  const queryKey = [
    'connections-my',
    serverIds.join(','), methods.join(','), statuses.join(','),
    preset, from, to, scope, sqString ?? '', sqLogic, sort, order,
  ];

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch, isFetching } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchConnections({
      page: pageParam, limit: LIMIT,
      server_id: serverIds.length ? serverIds : undefined,
      method:    methods.length   ? methods   : undefined,
      status:    statuses.length  ? statuses  : undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to:   to   ? new Date(to).toISOString()   : undefined,
      scope: scope === 'all' ? 'all' : undefined,
      sq: sqString,
      sq_logic: filterMode && sqPayload.length > 1 ? sqLogic : undefined,
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

  useWebSocket({ channels: wsChannel ? [wsChannel] : [], onMessage: handleWsMessage, enabled: live && !!wsChannel });

  return (
    <div className="flex gap-4 items-start">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">My Connections</h1>
              {data && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {allConnections.length.toLocaleString()} / {total.toLocaleString()} connections
                </p>
              )}
            </div>
            {/* Mine / All scope toggle */}
            <div className="flex items-center rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-xs shrink-0">
              <button
                onClick={() => setScope('mine')}
                className={`px-3 py-1.5 transition-colors ${scope === 'mine' ? 'bg-blue-600 text-white font-medium' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              >
                Mine
              </button>
              <button
                onClick={() => setScope('all')}
                className={`px-3 py-1.5 border-l border-gray-300 dark:border-gray-600 transition-colors ${scope === 'all' ? 'bg-blue-600 text-white font-medium' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              >
                All
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {hasActiveFilters && (
              <Button variant="secondary" size="sm" onClick={resetAll}>
                <X className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
            <Button variant={live ? 'primary' : 'secondary'} size="sm" onClick={() => setLive((v) => { if (!v) refetch(); return !v; })}>
              {live ? <RadioTower className="h-3.5 w-3.5 animate-pulse" /> : <Radio className="h-3.5 w-3.5" />}
              {live ? 'Live' : 'Live off'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching && !isFetchingNextPage}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <FilterBar
          serverIds={serverIds} methods={methods} statuses={statuses}
          preset={preset} from={from} to={to}
          servers={servers}
          onServerIds={(v) => setMultiFilter('server_id', v)}
          onMethods={(v)   => setMultiFilter('method', v)}
          onStatuses={(v)  => setMultiFilter('status', v)}
          onTimeChange={handleTimeChange}
        />

        <SearchBuilder
          conditions={conditions}
          logic={sqLogic}
          mode={searchMode}
          onChange={setConditions}
          onLogicChange={setSqLogic}
          onModeChange={setSearchMode}
        />

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !allConnections.length ? (
              <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">No connections match the current filters</div>
            ) : (
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
                    <TrafficRow key={c.id} c={c} isNew={newIds.has(c.id)}
                      conditions={conditions} sqLogic={sqLogic} serverActive={serverActive} searchMode={searchMode}
                      selected={c.id === selectedId} onSelect={(id) => setSelectedId(prev => prev === id ? null : id)} />
                  ))}
                </tbody>
              </table>
            )}
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
          </CardContent>
        </Card>
      </div>

      {selectedId && <DetailPanel id={selectedId} onClose={() => setSelectedId(null)} />}
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
