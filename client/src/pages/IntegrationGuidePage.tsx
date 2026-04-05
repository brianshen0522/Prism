import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BookOpen,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchIntegrationGuide, regenParticipantToken } from '../lib/api';
import { copyToClipboard } from '../lib/utils';
import {
  GuideInfoPanel,
  guideIconSurfaceClass,
  guideInsetSurfaceClass,
  guideMutedSurfaceClass,
  guideRoleBadgeClass,
  guideSurfaceClass,
} from '../components/GuidePrimitives';
import { PageHeader, PageShell } from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';

type GuideListItem = Awaited<ReturnType<typeof fetchIntegrationGuide>>['items'][number];

function OverviewCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: typeof BookOpen;
}) {
  return (
    <Card className={`${guideSurfaceClass} transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md`}>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="rounded-xl bg-slate-100 p-3 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionIntro({
  title,
  description,
  count,
}: {
  title: string;
  description: string;
  count: number;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      <Badge className="w-fit bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
        {count} {count === 1 ? 'service' : 'services'}
      </Badge>
    </div>
  );
}

function ServiceCard({ item }: { item: GuideListItem }) {
  const isOAuth = item.kind === 'oauth-pair';
  const iconTone = guideIconSurfaceClass(item.kind);
  const roleBadge = guideRoleBadgeClass(item.kind);

  return (
    <Link to={`/guide/${item.id}`} className="block h-full">
      <Card className={`group h-full overflow-hidden ${guideSurfaceClass} transition-all duration-300 hover:-translate-y-1 hover:shadow-xl`}>
        <CardContent className="flex h-full flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <div className={`rounded-xl p-3 ${iconTone}`}>
              {isOAuth ? <Waypoints className="h-5 w-5" /> : <BookOpen className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{item.title}</h3>
                <Badge className={roleBadge}>{isOAuth ? 'OAuth pair' : 'Direct access'}</Badge>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {item.description ?? (isOAuth
                  ? 'Protected resource server with a linked authentication server.'
                  : 'Direct-access server that can be called with the participant token header.')}
              </p>
            </div>
          </div>

          <GuideInfoPanel title="User Access URL">
            <p className="break-all font-mono text-sm text-gray-900 dark:text-gray-100">{item.public_base_url}</p>
          </GuideInfoPanel>

          {item.authentication_server ? (
            <GuideInfoPanel title="Authentication server" className="border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                <ShieldCheck className="h-4 w-4" />
                {item.authentication_server.name}
              </div>
            </GuideInfoPanel>
          ) : (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-950/30 dark:text-stone-200">
              Direct request flow. No separate OAuth token exchange is required for this service.
            </div>
          )}

          <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-200 pt-4 text-sm dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">{item.summary}</span>
            <span className="inline-flex items-center gap-1 font-medium text-blue-600 transition-transform duration-200 group-hover:translate-x-1">
              Open guide
              <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function IntegrationGuidePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['integration-guide'],
    queryFn: fetchIntegrationGuide,
  });

  const renewMutation = useMutation({
    mutationFn: regenParticipantToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integration-guide'] });
      qc.invalidateQueries({ queryKey: ['participant-token'] });
    },
  });

  if (isLoading) {
    return (
      <PageShell width="wide">
        <Skeleton className="h-14 w-80" />
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-80 w-full" />
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell width="wide">
        <Card>
          <CardContent className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
            No guide data is available right now.
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const directItems = data.items.filter((item) => item.kind === 'direct-server');
  const oauthItems = data.items.filter((item) => item.kind === 'oauth-pair');

  return (
    <PageShell width="wide" className="max-w-[1600px] space-y-8">
      <PageHeader
        title="Integration Guide"
        description="Choose a service first. Each guide is generated from the current server configuration, including the public URL, required headers, OAuth flow, and curl examples."
      />

      <Card className={`overflow-hidden ${guideSurfaceClass}`}>
        <CardContent className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)] xl:p-7">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Sparkles className="h-3.5 w-3.5" />
              Start here
            </div>
            <div className="space-y-3">
              <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                Pick a service, then follow a guide built from the live configuration.
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
                This page only shows the services you can call. Open one card to see the exact participant token header, public URL,
                OAuth steps, and curl examples for that server.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <OverviewCard
                title="Available Services"
                value={data.overview.total_servers}
                description="Everything currently active and visible."
                icon={Server}
              />
              <OverviewCard
                title="Direct Access"
                value={data.overview.direct_servers}
                description="Call these directly with the participant token header."
                icon={BookOpen}
              />
              <OverviewCard
                title="OAuth Pairs"
                value={data.overview.oauth_pairs}
                description="Protected resources with linked authentication servers."
                icon={Waypoints}
              />
            </div>
          </div>

          <div className={`rounded-[28px] border p-5 ${guideMutedSurfaceClass}`}>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-slate-700 dark:text-slate-200" />
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Participant Token</p>
            </div>
            <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
              Use this header on client-originated requests. The service detail page will show where it must be sent.
            </p>
            <div className={`mt-4 rounded-2xl border px-4 py-3 font-mono text-sm text-gray-900 dark:text-gray-100 ${guideInsetSurfaceClass}`}>
              {data.participant_token.header_name}: {data.participant_token.masked_token}
            </div>
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (data.participant_token.token) copyToClipboard(data.participant_token.token);
                }}
              >
                Copy token
              </Button>
            </div>
            <div className={`mt-5 space-y-3 rounded-2xl border p-4 ${guideInsetSurfaceClass}`}>
              <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">How to use this guide</p>
              <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <li>1. Choose a service block below.</li>
                <li>2. Open the generated guide page.</li>
                <li>3. Copy the curl example that matches your flow.</li>
              </ol>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-5"
              loading={renewMutation.isPending}
              onClick={() => renewMutation.mutate()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Renew token
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <SectionIntro
          title="OAuth-Protected Resource Servers"
          description="Choose one resource server to view the linked authentication server, the token exchange, and the exact client request flow."
          count={oauthItems.length}
        />
        {oauthItems.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
              No OAuth-protected resource servers are configured right now.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {oauthItems.map((item) => (
              <ServiceCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionIntro
          title="Direct Access Servers"
          description="These services can be called directly. Open a card to see the participant header and copy the ready-to-use curl example."
          count={directItems.length}
        />
        {directItems.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
              No direct-access servers are configured right now.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {directItems.map((item) => (
              <ServiceCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
