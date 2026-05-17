import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Activity, Server, AlertTriangle, Zap } from 'lucide-react';
import {
  fetchDashboardStats, fetchDashboardChart,
  fetchOAuthPipelines,
  type DashboardStats, type ChartData, type ConnectionSummary, type OAuthPipelineListItem,
} from '../lib/api';
import { fetchConnections } from '../lib/api';
import { useWebSocket, type WSMessage } from '../lib/ws';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { EmptyState, TableCard, TableScroller } from '../components/PagePrimitives';
import { Skeleton } from '../components/ui/skeleton';
import { PageHeader, PageShell } from '../components/PageLayout';
import { fmtDate, fmtDuration, statusColor, methodColor, httpStatusColor } from '../lib/utils';

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <div className={`rounded-lg p-3 ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const hour = new Date(label).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">{hour}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

// ─── Recent connections row ───────────────────────────────────────────────────

function RecentRow({ c }: { c: ConnectionSummary }) {
  const navigate = useNavigate();
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer" onClick={() => navigate(`/connections/${c.id}`)}>
      <td className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmtDate(c.req_timestamp)}</td>
      <td className="px-4 py-2.5"><Badge className={methodColor(c.req_method)}>{c.req_method}</Badge></td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 max-w-xs truncate">{c.req_url}</td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[100px]">{c.server_name ?? '—'}</td>
      <td className="px-4 py-2.5"><Badge className={statusColor(c.status)}>{c.status}</Badge></td>
      <td className="px-4 py-2.5">
        {c.res_status_code
          ? <Badge className={httpStatusColor(c.res_status_code)}>{c.res_status_code}</Badge>
          : <span className="text-gray-300 text-xs">—</span>}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 text-right">{fmtDuration(c.duration_ms)}</td>
    </tr>
  );
}

function RecentMobileCard({ c }: { c: ConnectionSummary }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/connections/${c.id}`)}
      className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(c.req_timestamp)}</p>
          <p className="mt-1 break-all font-mono text-xs text-gray-700 dark:text-gray-300">{c.req_url}</p>
        </div>
        <Badge className={methodColor(c.req_method)}>{c.req_method}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge className={statusColor(c.status)}>{c.status}</Badge>
        {c.res_status_code ? <Badge className={httpStatusColor(c.res_status_code)}>{c.res_status_code}</Badge> : null}
        <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{fmtDuration(c.duration_ms)}</Badge>
      </div>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{c.server_name ?? '—'}</p>
    </button>
  );
}

function pipelineStatusTone(p: OAuthPipelineListItem) {
  if (p.success) return 'bg-green-100 text-green-800';
  if (!p.complete || !p.legal) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

function RecentPipelineRow({ pipeline }: { pipeline: OAuthPipelineListItem }) {
  const navigate = useNavigate();
  return (
    <tr
      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
      onClick={() => navigate(`/oauth/pipelines/${pipeline.id}`)}
    >
      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500">{fmtDate(pipeline.started_at)}</td>
      <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300">
        <div className="space-y-1">
          <div>{pipeline.participant_institution?.name || '—'}</div>
          {pipeline.participant_user && (
            <div className="text-[11px] text-gray-400 dark:text-gray-500">
              user: {pipeline.participant_user.name || pipeline.participant_user.username}
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[140px]">
        {pipeline.authentication_server?.name ?? '—'}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 max-w-[180px] truncate">
        {pipeline.access_token_fingerprint}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 text-center">{pipeline.resource_call_count}</td>
      <td className="px-4 py-2.5">
        <Badge className={pipelineStatusTone(pipeline)}>
          {pipeline.success ? 'success' : pipeline.complete ? (pipeline.legal ? 'failed' : 'illegal') : 'incomplete'}
        </Badge>
      </td>
    </tr>
  );
}

function RecentPipelineMobileCard({ pipeline }: { pipeline: OAuthPipelineListItem }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/oauth/pipelines/${pipeline.id}`)}
      className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(pipeline.started_at)}</p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {pipeline.participant_institution?.name || '—'}
          </p>
          {pipeline.participant_user && (
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              user: {pipeline.participant_user.name || pipeline.participant_user.username}
            </p>
          )}
          <p className="mt-1 break-all font-mono text-xs text-gray-700 dark:text-gray-300">
            {pipeline.access_token_fingerprint}
          </p>
        </div>
        <Badge className={pipelineStatusTone(pipeline)}>
          {pipeline.success ? 'success' : pipeline.complete ? (pipeline.legal ? 'failed' : 'illegal') : 'incomplete'}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
          {pipeline.resource_call_count} calls
        </Badge>
      </div>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {pipeline.authentication_server?.name ?? '—'}
      </p>
      {pipeline.diagnostics_summary ? (
        <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{pipeline.diagnostics_summary}</p>
      ) : null}
    </button>
  );
}

// ─── DashboardPage ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const qc = useQueryClient();
  const [liveStats, setLiveStats] = useState<DashboardStats | null>(null);
  const [liveChart, setLiveChart] = useState<ChartData | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
    refetchInterval: 30_000,
  });

  const { data: chart, isLoading: chartLoading } = useQuery({
    queryKey: ['dashboard-chart'],
    queryFn: fetchDashboardChart,
    refetchInterval: 60_000,
  });

  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['connections', 1, '', ''],
    queryFn: () => fetchConnections({ page: 1, limit: 10 }),
    refetchInterval: 15_000,
  });

  const { data: recentPipelines, isLoading: recentPipelinesLoading } = useQuery({
    queryKey: ['dashboard-oauth-pipelines'],
    queryFn: () => fetchOAuthPipelines({ page: 1, limit: 8 }),
    refetchInterval: 15_000,
  });

  // Real-time dashboard stats via WS
  const handleWsMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'dashboard:stats') {
      setLiveStats(msg.payload as DashboardStats);
      setLiveChart(null); // invalidate chart so it refetches with new window if changed
    } else if (msg.type === 'connection:new' || msg.type === 'connection:completed' || msg.type === 'connection:error') {
      qc.invalidateQueries({ queryKey: ['connections', 1, '', ''] });
    }
  }, [qc]);

  useWebSocket({ channels: ['dashboard', 'traffic:all'], onMessage: handleWsMessage });

  const displayStats = liveStats ?? stats;
  const displayChart = liveChart ?? chart;

  const chartHours = displayChart?.hours ?? 24;
  const chartBucketMinutes = displayChart?.bucketMinutes ?? 60;
  const chartBucketLabel = chartBucketMinutes < 60
    ? `${chartBucketMinutes}m`
    : chartBucketMinutes % 60 === 0
      ? `${chartBucketMinutes / 60}h`
      : `${chartBucketMinutes}m`;
  const chartData = (displayChart?.data ?? []).map((p) => ({
    ...p,
    label: new Date(p.hour).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  }));

  return (
    <PageShell>
      <PageHeader
        title="Dashboard"
        description="Monitor request volume, error rate, and recent traffic activity across the Prism environment."
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard
              label="Total Requests"
              value={displayStats?.totalRequests.toLocaleString() ?? '—'}
              icon={Activity}
              color="bg-blue-100 text-blue-600"
            />
            <StatCard
              label="Active Servers"
              value={displayStats?.activeServers ?? '—'}
              icon={Server}
              color="bg-emerald-100 text-emerald-600"
            />
            <StatCard
              label={`Requests (${displayStats?.windowMinutes ?? 5}m)`}
              value={displayStats?.requestsLastWindow ?? '—'}
              icon={Zap}
              color="bg-violet-100 text-violet-600"
            />
            <StatCard
              label={`Error Rate (${displayStats?.windowMinutes ?? 5}m)`}
              value={displayStats ? `${(displayStats.errorRate * 100).toFixed(1)}%` : '—'}
              icon={AlertTriangle}
              color={
                (displayStats?.errorRate ?? 0) > 0.1
                  ? 'bg-red-100 text-red-600'
                  : 'bg-amber-100 text-amber-600'
              }
            />
          </>
        )}
      </div>

      {/* Traffic chart */}
      <Card>
        <CardHeader>
          <CardTitle>Requests — last {chartHours}h &nbsp;·&nbsp; {chartBucketLabel} buckets</CardTitle>
        </CardHeader>
        <CardContent>
          {chartLoading ? (
            <Skeleton className="h-52 w-full" />
          ) : !chartData.length ? (
            <div className="h-52 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
              No traffic yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradErrors" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="count" name="Requests" stroke="#3b82f6" strokeWidth={2} fill="url(#gradCount)" />
                <Area type="monotone" dataKey="errors" name="Errors" stroke="#ef4444" strokeWidth={2} fill="url(#gradErrors)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Recent connections */}
      <TableCard title="Recent connections">
        <TableScroller>
          {recentLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : !recent?.data.length ? (
            <EmptyState title="No connections yet" className="py-10" />
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {recent.data.map((c) => <RecentMobileCard key={c.id} c={c} />)}
              </div>
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Method</th>
                    <th className="px-4 py-3 font-medium">URL</th>
                    <th className="px-4 py-3 font-medium">Server</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">HTTP</th>
                    <th className="px-4 py-3 font-medium text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {recent.data.map((c) => <RecentRow key={c.id} c={c} />)}
                </tbody>
              </table>
            </>
          )}
        </TableScroller>
      </TableCard>

      <TableCard title="Recent OAuth pipelines">
        <TableScroller>
          {recentPipelinesLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : !recentPipelines?.data.length ? (
            <EmptyState title="No OAuth pipelines yet" className="py-10" />
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {recentPipelines.data.map((pipeline) => <RecentPipelineMobileCard key={pipeline.id} pipeline={pipeline} />)}
              </div>
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Institution</th>
                    <th className="px-4 py-3 font-medium">Auth Server</th>
                    <th className="px-4 py-3 font-medium">Token</th>
                    <th className="px-4 py-3 font-medium text-center">Calls</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {recentPipelines.data.map((pipeline) => <RecentPipelineRow key={pipeline.id} pipeline={pipeline} />)}
                </tbody>
              </table>
            </>
          )}
        </TableScroller>
      </TableCard>
    </PageShell>
  );
}
