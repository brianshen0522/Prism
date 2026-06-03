import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { fetchPublicConnection, fetchPublicOAuthPipeline } from '../lib/api';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { ViewLayout } from '../components/ViewLayout';
import { ConnectionInspectPanel } from '../components/ConnectionInspectPanel';
import { OAuthFlowMap } from './OAuthPipelineDetailPage';
import { fmtDate, copyToClipboard } from '../lib/utils';

function CopyTokenButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function handle() {
    await copyToClipboard(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={handle}
      className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
      title="Copy full token"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : null}
      {copied ? 'Copied' : 'Copy token'}
    </button>
  );
}

function StatusBadge({ ok, trueLabel, falseLabel }: { ok: boolean; trueLabel: string; falseLabel: string }) {
  return (
    <Badge className={ok ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}>
      {ok ? trueLabel : falseLabel}
    </Badge>
  );
}

export function OAuthPipelineViewPage() {
  const { shareToken = '' } = useParams();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-oauth-pipeline', shareToken],
    queryFn: () => fetchPublicOAuthPipeline(shareToken),
    enabled: !!shareToken,
    retry: false,
  });

  const idToToken = data?.connection_share_tokens ?? {};
  const participantName = data?.summary.participant_institution?.name
    ?? data?.summary.participant_user?.name
    ?? data?.summary.participant_user?.username
    ?? 'Unknown participant';

  return (
    <ViewLayout>
      <div className="space-y-4">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : error || !data ? (
          <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">
            Pipeline not found or this share link has expired.
          </div>
        ) : (
          <div className="flex w-full flex-col gap-4 xl:flex-row xl:items-start">
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">OAuth Pipeline</h1>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Started {fmtDate(data.summary.started_at)} · {participantName}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge ok={data.summary.complete} trueLabel="Complete" falseLabel="Incomplete" />
                  <StatusBadge ok={data.summary.legal} trueLabel="Legal" falseLabel="Illegal" />
                  <StatusBadge ok={data.summary.success} trueLabel="Success" falseLabel="Failed" />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardContent className="p-4 space-y-1">
                    <p className="text-xs uppercase tracking-wide text-gray-400">Participant Institution</p>
                    <p className="text-sm font-medium">{data.summary.participant_institution?.name ?? '—'}</p>
                    {data.summary.participant_user && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        user: {data.summary.participant_user.name ?? data.summary.participant_user.username}
                      </p>
                    )}
                  </CardContent>
                </Card>
                <Card><CardContent className="p-4 space-y-1"><p className="text-xs uppercase tracking-wide text-gray-400">Authentication Server</p><p className="text-sm font-medium">{data.summary.authentication_server?.name ?? '—'}</p></CardContent></Card>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <p className="text-xs uppercase tracking-wide text-gray-400">Access Token</p>
                    <p className="font-mono text-sm">{data.summary.access_token.fingerprint}</p>
                    {data.access_token_full && <CopyTokenButton value={data.access_token_full} />}
                  </CardContent>
                </Card>
              </div>

              <OAuthFlowMap
                summary={data.summary}
                tokenIssue={data.token_issue}
                resourceCalls={data.resource_calls}
                onInspectConnection={setSelectedConnectionId}
                selectedConnectionId={selectedConnectionId}
                hoveredConnectionId={hoveredConnectionId}
                onHoverConnection={setHoveredConnectionId}
              />
            </div>

            <ConnectionInspectPanel
              id={selectedConnectionId}
              onClose={() => setSelectedConnectionId(null)}
              description="Click a token issue, resource call, or validation step to inspect it."
              fetchFn={(id) => {
                const token = idToToken[id];
                if (!token) throw new Error('No share token for this connection');
                return fetchPublicConnection(token);
              }}
              getExternalHref={(id) => {
                const token = idToToken[id];
                return token ? `${import.meta.env.BASE_URL}view/c/${token}` : null;
              }}
            />
          </div>
        )}
      </div>
    </ViewLayout>
  );
}
