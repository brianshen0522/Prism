import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Activity, Server, AlertTriangle, Zap } from 'lucide-react';
import {
  fetchDashboardStats, fetchDashboardChart,
  type DashboardStats, type ChartData, type ConnectionSummary,
} from '../lib/api';
import { fetchConnections } from '../lib/api';
import { useWebSocket, type WSMessage } from '../lib/ws';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
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
  const chartData = (displayChart?.data ?? []).map((p) => ({
    ...p,
    label: new Date(p.hour).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <CardTitle>Requests — last {chartHours} hours</CardTitle>
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
      <Card>
        <CardHeader>
          <CardTitle>Recent connections</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {recentLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : !recent?.data.length ? (
            <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">No connections yet</div>
          ) : (
            <table className="w-full text-sm">
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
