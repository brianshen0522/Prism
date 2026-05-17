import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, RefreshCw, ShieldCheck, Clock, Play, ChevronDown, ChevronUp, Building2, AlertTriangle } from 'lucide-react';
import { fetchParticipantToken, regenParticipantToken } from '../lib/api';
import { copyToClipboard } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { PageHeader, PageShell } from '../components/PageLayout';
import { Skeleton } from '../components/ui/skeleton';
import { useAuthStore } from '../store/auth';
import { useWebSocket } from '../lib/ws';

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyToClipboard(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Countdown({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining(0);
        onExpired();
      } else {
        setRemaining(ms);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpired]);

  const totalSecs = Math.floor(remaining / 1000);
  const urgent = totalSecs < 30;

  function fmtRemaining(secs: number): string {
    if (secs <= 0) return 'Expired — refreshing…';
    const days  = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const mins  = Math.floor((secs % 3600) / 60);
    const s     = secs % 60;
    if (days >= 1)  return `Expires in ${days}d ${hours}h`;
    if (hours >= 1) return `Expires in ${hours}h ${mins}m`;
    return `Expires in ${mins}:${String(s).padStart(2, '0')}`;
  }

  return (
    <div className={`flex items-center gap-2 text-sm font-mono ${urgent ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>{fmtRemaining(totalSecs)}</span>
    </div>
  );
}

type TryItResponse = { status: number; body: unknown; latencyMs: number };

function TryItPanel({ endpoint, defaultUsername }: { endpoint: string; defaultUsername: string }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TryItResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const send = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    const started = performance.now();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const latencyMs = Math.round(performance.now() - started);
      let body: unknown;
      try { body = await res.json(); } catch { body = await res.text(); }
      setResult({ status: res.status, body, latencyMs });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (s: number) => {
    if (s < 300) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    if (s < 400) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  };

  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setTimeout(() => passwordRef.current?.focus(), 50);
        }}
        className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Play className="h-3 w-3" />
          Try it
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="border-t border-dashed border-gray-300 px-4 pb-4 pt-3 space-y-3 dark:border-gray-600">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-mono text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                placeholder="username"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Password</label>
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-mono text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                placeholder="••••••••"
              />
            </div>
          </div>

          <Button size="sm" variant="primary" onClick={send} loading={loading} className="w-full justify-center">
            <Play className="h-3 w-3" />
            Send
          </Button>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}

          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge className={statusColor(result.status)}>{result.status}</Badge>
                <span className="text-xs text-gray-400 dark:text-gray-500">{result.latencyMs} ms</span>
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-gray-900 p-3 text-xs text-green-300 dark:bg-black">
                {JSON.stringify(result.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TokenPage() {
  const qc = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isTokenStale = useAuthStore((state) => state.participantTokenStale);
  const clearTokenStale = useAuthStore((state) => state.clearParticipantTokenStale);
  const [regenDialogOpen, setRegenDialogOpen] = useState(false);
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const curlUsername = user?.username ?? '<username>';
  const curlPassword = '<password>';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['participant-token'],
    queryFn: fetchParticipantToken,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const regenMut = useMutation({
    mutationFn: regenParticipantToken,
    onSuccess: (newData) => qc.setQueryData(['participant-token'], newData),
  });

  const handleExpired = () => refetch();

  useEffect(() => {
    if (!isTokenStale) return;
    refetch();
    clearTokenStale();
  }, [isTokenStale, refetch, clearTokenStale]);

  const institutionChannel = user?.institutionId ? `traffic:institution:${user.institutionId}` : null;
  const handleWsMessage = useCallback((msg: { type: string; payload?: unknown }) => {
    if (msg.type !== 'token:institution_regenned') return;
    const payload = msg.payload as { triggeredByUserId?: number } | undefined;
    if (payload?.triggeredByUserId !== user?.sub) {
      refetch();
    }
  }, [user?.sub, refetch]);

  useWebSocket({
    channels: institutionChannel ? [institutionChannel] : [],
    onMessage: handleWsMessage,
    enabled: !!institutionChannel,
  });

  const currentTokenCurl = `curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"username":"${curlUsername}","password":"${curlPassword}"}' \\
  ${currentOrigin}/api/token/current`;
  const renewTokenCurl = `curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"username":"${curlUsername}","password":"${curlPassword}"}' \\
  ${currentOrigin}/api/token/renew`;

  const institutionShortName = user ? (user.institutionKeyword ?? user.institutionName) : 'your institution';

  return (
    <>
    <Dialog
      open={regenDialogOpen}
      onClose={() => setRegenDialogOpen(false)}
      title="Regenerate institution tokens"
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
          <p className="text-sm text-gray-700 dark:text-gray-300">
            This will regenerate tokens for <span className="font-semibold">{institutionShortName}</span>.
            All current tokens will be invalidated immediately — every member will need to fetch a new token before their next request.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRegenDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={regenMut.isPending}
            onClick={() => {
              setRegenDialogOpen(false);
              regenMut.mutate();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </Button>
        </div>
      </div>
    </Dialog>
    <PageShell width="wide" className="max-w-6xl">
      <PageHeader
        title="Participant Token"
        description={(
          <>
          Include this token in every request so your traffic is correctly attributed.
          The token rotates automatically — copy it fresh before each test session.
          </>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <div className="space-y-6">
          {user && (
            <Card>
              <CardContent className="flex items-start gap-3 p-4">
                <Building2 className="mt-0.5 h-5 w-5 text-blue-500" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{user.institutionKeyword ?? user.institutionName}</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    This token belongs to your institution. Each member has their own token.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-blue-500" />
                  Your current token
                </CardTitle>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={regenMut.isPending}
                  onClick={() => setRegenDialogOpen(true)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : data ? (
                <>
                  <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900 sm:flex-row sm:items-center">
                    <code className="flex-1 break-all font-mono text-sm text-gray-900 select-all dark:text-gray-100">
                      {data.token}
                    </code>
                    <CopyButton value={data.token} />
                  </div>

                  <Countdown expiresAt={data.expires_at} onExpired={handleExpired} />
                  {user && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Issued for: <span className="font-medium text-gray-700 dark:text-gray-300">{user.institutionKeyword ?? user.institutionName}</span>
                    </p>
                  )}

                  <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-900/20">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                      Required request header
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <code className="min-w-0 flex-1 break-all font-mono text-sm text-blue-900 dark:text-blue-200">
                        {data.header_name}: {data.token}
                      </code>
                      <CopyButton value={`${data.header_name}: ${data.token}`} />
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          {data && (
            <Card>
              <CardHeader>
                <CardTitle>Usage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                <p>Add the header to every request you send through the proxy:</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                  {`curl -H "${data.header_name}: ${data.token}" http://<proxy-host>:<port>/your/endpoint`}
                </pre>
                <ul className="list-inside list-disc space-y-1 text-xs">
                  <li>Only requests carrying a valid token are attributed to your account.</li>
                  <li>The token rotates on a schedule — refresh this page to get the latest.</li>
                  <li>If you suspect your token was leaked, click <strong>Regenerate</strong> immediately.</li>
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        {data && (
          <div className="space-y-6">
            <Card className="xl:sticky xl:top-24">
              <CardHeader>
                <CardTitle>API</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 text-sm text-gray-600 dark:text-gray-400">
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">Get the current token</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Returns the current participant token for the supplied username and password.</p>
                    </div>
                    <code className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      POST /api/token/current
                    </code>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Curl example</p>
                      <CopyButton value={currentTokenCurl} />
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-gray-700 dark:text-gray-300">
                      {currentTokenCurl}
                    </pre>
                  </div>
                  <TryItPanel endpoint={`${currentOrigin}/api/token/current`} defaultUsername={curlUsername} />
                </div>

                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">Force a new token</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Immediately invalidates the current token and issues a new participant token for the supplied username and password.</p>
                    </div>
                    <code className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      POST /api/token/renew
                    </code>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Curl example</p>
                      <CopyButton value={renewTokenCurl} />
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-gray-700 dark:text-gray-300">
                      {renewTokenCurl}
                    </pre>
                  </div>
                  <TryItPanel endpoint={`${currentOrigin}/api/token/renew`} defaultUsername={curlUsername} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </PageShell>
    </>
  );
}
