import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  ExternalLink,
  KeyRound,
  Monitor,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { fetchIntegrationGuideDetail, regenParticipantToken } from '../lib/api';
import { copyToClipboard, cn } from '../lib/utils';
import {
  GuideInfoPanel,
  guideInsetSurfaceClass,
  guideMutedSurfaceClass,
  guideRoleBadgeClass,
  guideSurfaceClass,
} from '../components/GuidePrimitives';
import { PageHeader, PageShell } from '../components/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        copyToClipboard(value);
      }}
      className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      <Copy className="h-3.5 w-3.5" />
      Copy
    </button>
  );
}

function StepCard({
  index,
  title,
  description,
  method,
  url,
  headers,
  hint,
}: {
  index: number;
  title: string;
  description: string;
  method: string | null;
  url: string | null;
  headers: Array<{ name: string; value: string }>;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-gray-700 dark:bg-gray-900/70">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          {index}
        </div>
        <div className="min-w-0 flex-1 space-y-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
            {method ? (
              <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{method}</Badge>
            ) : null}
          </div>
          <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">{description}</p>
          {hint ? <div>{hint}</div> : null}
          {url ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950/30">
              <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Endpoint</p>
              <p className="mt-2 break-all font-mono text-xs leading-6 text-gray-800 dark:text-gray-200">{url}</p>
            </div>
          ) : null}
          {headers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {headers.map((header) => (
                <Badge key={`${title}-${header.name}`} className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                  {header.name}: {header.value}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function IntegrationGuideDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['integration-guide', id],
    queryFn: () => fetchIntegrationGuideDetail(id),
    enabled: !!id,
  });

  const renewMutation = useMutation({
    mutationFn: regenParticipantToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integration-guide'] });
      qc.invalidateQueries({ queryKey: ['integration-guide', id] });
      qc.invalidateQueries({ queryKey: ['participant-token'] });
    },
  });

  if (isLoading) {
    return (
      <PageShell width="wide">
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-[520px] w-full" />
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell width="wide">
        <Card>
          <CardContent className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
            Guide item not found.
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const isOAuth = data.item.kind === 'oauth-pair';

  return (
    <PageShell width="wide" className="max-w-[1600px] space-y-8">
      <Link to="/guide" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
        <ArrowLeft className="h-4 w-4" />
        Back to Integration Guide
      </Link>

      <Card className={`overflow-hidden ${guideSurfaceClass}`}>
        <CardContent className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:p-7">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={guideRoleBadgeClass(data.item.kind)}>
                {isOAuth ? 'OAuth pair' : 'Direct access'}
              </Badge>
              {data.item.authentication_server ? (
                <Badge className={guideRoleBadgeClass('oauth-pair')}>{data.item.authentication_server.name}</Badge>
              ) : null}
            </div>
            <PageHeader
              title={data.item.title}
              description={data.item.description ?? data.item.summary}
              className="[&_p]:max-w-3xl"
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <GuideInfoPanel title="User Access URL">
                <p className="break-all font-mono text-sm text-gray-900 dark:text-gray-100">{data.item.public_base_url}</p>
              </GuideInfoPanel>
              <GuideInfoPanel title="Access mode">
                <div className="mt-2 flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                  {isOAuth ? <Waypoints className="h-4 w-4 text-slate-700 dark:text-slate-200" /> : <ShieldCheck className="h-4 w-4 text-stone-700 dark:text-stone-200" />}
                  {isOAuth
                    ? 'Participant token + access token'
                    : 'Participant token only'}
                </div>
              </GuideInfoPanel>
            </div>
          </div>

          <div className={`rounded-[28px] border p-5 ${guideMutedSurfaceClass}`}>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-slate-700 dark:text-slate-200" />
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">What this guide will show</p>
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-gray-700 dark:text-gray-300">
              <li>1. The public URL your client should call.</li>
              <li>2. The headers required on client-originated requests.</li>
              <li>3. The exact OAuth sequence, if this resource is protected.</li>
              <li>4. Copy-ready curl commands for each step.</li>
            </ul>
            {data.detail.notes.length > 0 ? (
              <div className="mt-5 space-y-2">
                {data.detail.notes.map((note) => (
                  <div key={note} className={`rounded-xl border px-3 py-2 text-sm text-gray-700 dark:text-gray-300 ${guideInsetSurfaceClass}`}>
                    {note}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Service Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Flow diagram */}
              <div className={`flex flex-wrap items-center gap-2 rounded-2xl border p-4 ${guideMutedSurfaceClass}`}>
                <div className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 shadow-sm dark:bg-gray-800">
                  <Monitor className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Your Client</span>
                </div>
                {isOAuth && data.item.authentication_server ? (
                  <>
                    <ArrowRight className="h-4 w-4 shrink-0 text-blue-400" />
                    <div className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 shadow-sm dark:bg-blue-900/30">
                      <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <div>
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">{data.item.authentication_server.name}</p>
                        <p className="text-[10px] text-blue-500 dark:text-blue-400">auth server · get access token</p>
                      </div>
                    </div>
                  </>
                ) : null}
                <ArrowRight className="h-4 w-4 shrink-0 text-blue-400" />
                <div className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 shadow-sm dark:bg-green-900/30">
                  <Server className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="text-xs font-semibold text-green-700 dark:text-green-300">{data.item.title}</p>
                    <p className="text-[10px] text-green-500 dark:text-green-400">{isOAuth ? 'resource server · use access token' : 'direct access · participant token only'}</p>
                  </div>
                </div>
              </div>

              {/* Server panels */}
              <div className="grid gap-4 lg:grid-cols-2">
                {isOAuth && data.item.authentication_server ? (
                  <GuideInfoPanel title="Authentication server">
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{data.item.authentication_server.name}</p>
                    <p className="mt-1 break-all font-mono text-xs text-gray-500 dark:text-gray-400">
                      {data.item.authentication_server.token_endpoint ?? data.item.authentication_server.public_base_url}
                    </p>
                  </GuideInfoPanel>
                ) : null}
                <GuideInfoPanel title="Resource server">
                  <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{data.item.title}</p>
                  <p className="mt-1 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{data.item.public_base_url}</p>
                </GuideInfoPanel>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Waypoints className="h-4 w-4 text-blue-600" />
                Walkthrough
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.detail.steps.map((step, index) => (
                  <div
                    key={step.id}
                    className={cn(
                      'relative',
                      index < data.detail.steps.length - 1 &&
                        'after:absolute after:left-[1.1rem] after:top-[calc(100%+0.25rem)] after:h-5 after:w-0.5 after:bg-blue-200 dark:after:bg-blue-900/40',
                    )}
                  >
                    <StepCard
                      index={index + 1}
                      title={step.title}
                      description={step.description}
                      method={step.method}
                      url={step.url}
                      headers={step.headers}
                      hint={step.kind === 'participant-token' ? (
                        <div className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <span>You can also view and copy your token from the{' '}</span>
                          <Link to="/token" className="font-semibold underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-100">
                            My Token page
                          </Link>
                          <span>.</span>
                        </div>
                      ) : undefined}
                    />
                    {index < data.detail.steps.length - 1 ? (
                      <div className="pointer-events-none absolute left-2 top-[calc(100%+0.15rem)] flex h-5 w-8 items-center justify-center">
                        <ArrowRight className="h-4 w-4 rotate-90 text-blue-400 dark:text-blue-500" />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 2xl:sticky 2xl:top-24 2xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-blue-600" />
                Participant Token
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <GuideInfoPanel title="Header name">
                <p className="font-mono text-sm text-gray-900 dark:text-gray-100">{data.participant_token.header_name}</p>
              </GuideInfoPanel>
              <GuideInfoPanel title="Current token">
                <p className="break-all font-mono text-sm text-gray-900 dark:text-gray-100">{data.participant_token.masked_token}</p>
              </GuideInfoPanel>
              <div>
                <CopyButton value={data.participant_token.token ?? data.participant_token.masked_token ?? ''} />
              </div>
              <Button variant="secondary" size="sm" loading={renewMutation.isPending} onClick={() => renewMutation.mutate()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Renew token
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Curl Examples</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.detail.steps.map((step) => (
                step.curl ? (
                  <div key={`${step.id}-curl`} className={`rounded-2xl border p-4 ${guideMutedSurfaceClass}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                        {step.title}
                      </p>
                      <CopyButton value={step.curl} />
                    </div>
                    <pre className={`overflow-x-auto whitespace-pre-wrap break-all rounded-xl border p-3 font-mono text-xs text-gray-700 dark:text-gray-300 ${guideInsetSurfaceClass}`}>
                      {step.curl}
                    </pre>
                  </div>
                ) : null
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
