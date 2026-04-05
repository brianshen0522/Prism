import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, RefreshCw, ShieldCheck, Clock } from 'lucide-react';
import { fetchParticipantToken, regenParticipantToken } from '../lib/api';
import { copyToClipboard } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { PageHeader, PageShell } from '../components/PageLayout';
import { Skeleton } from '../components/ui/skeleton';
import { useAuthStore } from '../store/auth';

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
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const urgent = totalSecs < 30;

  return (
    <div className={`flex items-center gap-2 text-sm font-mono ${urgent ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>
        {remaining === 0 ? 'Expired — refreshing…' : `Expires in ${mins}:${String(secs).padStart(2, '0')}`}
      </span>
    </div>
  );
}

export function TokenPage() {
  const qc = useQueryClient();
  const user = useAuthStore((state) => state.user);
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
  const currentTokenCurl = `curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"username":"${curlUsername}","password":"${curlPassword}"}' \\
  ${currentOrigin}/api/token/current`;
  const renewTokenCurl = `curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"username":"${curlUsername}","password":"${curlPassword}"}' \\
  ${currentOrigin}/api/token/renew`;

  return (
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
                  onClick={() => {
                    if (confirm('Regenerate your token? The current token will stop working immediately.')) {
                      regenMut.mutate();
                    }
                  }}
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
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </PageShell>
  );
}
