import { useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CircleDashed, Link as LinkIcon, Check } from 'lucide-react';
import { fetchOAuthPipeline } from '../lib/api';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { PageHeader } from '../components/PageLayout';
import { Skeleton } from '../components/ui/skeleton';
import { ConnectionInspectPanel } from '../components/ConnectionInspectPanel';
import { cn, fmtDate, httpStatusColor, methodColor, copyToClipboard } from '../lib/utils';

function ShareLinkButton({ shareToken }: { shareToken: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!shareToken) return null;
  const url = `${window.location.origin}${import.meta.env.BASE_URL}view/op/${shareToken}`;
  async function handle() {
    await copyToClipboard(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={handle}
      className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      title="Copy share link"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy share link'}
    </button>
  );
}

function StatusBadge({ ok, trueLabel, falseLabel, falseTone = 'error' }: {
  ok: boolean;
  trueLabel: string;
  falseLabel: string;
  falseTone?: 'error' | 'warning' | 'neutral';
}) {
  const falseClass =
    falseTone === 'warning'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
      : falseTone === 'neutral'
        ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  return (
    <Badge className={ok ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : falseClass}>
      {ok ? trueLabel : falseLabel}
    </Badge>
  );
}

type UiStatus = 'ok' | 'warning' | 'error' | 'missing';

function toneForStatus(status: UiStatus) {
  if (status === 'ok') {
    return {
      card: 'border-green-200 bg-green-50/80 dark:border-green-800 dark:bg-green-900/20',
      text: 'text-green-800 dark:text-green-300',
      line: 'bg-green-500',
      badge: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    };
  }
  if (status === 'warning') {
    return {
      card: 'border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-900/20',
      text: 'text-amber-800 dark:text-amber-300',
      line: 'bg-amber-500',
      badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    };
  }
  if (status === 'error') {
    return {
      card: 'border-red-200 bg-red-50/80 dark:border-red-800 dark:bg-red-900/20',
      text: 'text-red-800 dark:text-red-300',
      line: 'bg-red-500',
      badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    };
  }
  return {
    card: 'border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/30',
    text: 'text-gray-700 dark:text-gray-300',
    line: 'bg-gray-300 dark:bg-gray-600',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  };
}

function actorSummaryStatus(ok: boolean, missing = false): UiStatus {
  if (missing) return 'missing';
  return ok ? 'ok' : 'error';
}

function summarizeTokenIssueProblems(tokenIssue: Awaited<ReturnType<typeof fetchOAuthPipeline>>['token_issue']) {
  const issues: string[] = [];
  if (!tokenIssue.connection_id) issues.push('No token request was matched.');
  if (tokenIssue.connection_id && !tokenIssue.participant_token_present) issues.push('Client request is missing the participant token.');
  if (tokenIssue.connection_id && tokenIssue.participant_token_present && !tokenIssue.participant_token_linked) {
    issues.push('Participant token is expired or no longer linked to the pipeline institution.');
  }
  if (tokenIssue.connection_id && !tokenIssue.access_token_extracted) issues.push('Authentication server response did not expose an access token.');
  if (tokenIssue.connection_id && !tokenIssue.success) issues.push('Token issue did not complete successfully.');
  if (tokenIssue.is_refresh_grant && !tokenIssue.refresh_token_supplied) issues.push('Refresh grant was detected without a refresh token in the request body.');
  return issues;
}

function tokenIssueStateLabel(tokenIssue: Awaited<ReturnType<typeof fetchOAuthPipeline>>['token_issue']) {
  if (!tokenIssue.connection_id) return 'Token request missing';
  if (!tokenIssue.participant_token_present) return 'Participant token missing';
  if (tokenIssue.is_refresh_grant && !tokenIssue.refresh_token_supplied) return 'Refresh token missing';
  if (!tokenIssue.access_token_extracted) return 'Response missing access_token';
  if (!tokenIssue.success) return 'Token issue failed';
  return tokenIssue.is_refresh_grant ? 'Refreshed' : 'Issued';
}

function summarizeResourceProblems(call: Awaited<ReturnType<typeof fetchOAuthPipeline>>['resource_calls'][number]) {
  const issues: string[] = [];
  if (!call.participant_token_present) issues.push('Client request is missing the participant token.');
  if (call.participant_token_present && !call.participant_token_linked) {
    issues.push('Participant token is expired or no longer linked to the pipeline institution.');
  }
  if (!call.success) issues.push('Resource call returned an unsuccessful status.');
  if (!call.validation) issues.push('Validation request is missing.');
  if (call.validation && !call.validation.body_check_passed) issues.push('Validation body check failed.');
  if (call.validation && !call.validation.success) issues.push('Validation request completed with an error.');
  return issues;
}

function humanizeDiagnostic(diagnostic: string) {
  if (diagnostic === 'unlinked_token_issue_participant' || diagnostic === 'unlinked_resource_participant') {
    return 'Participant token expired or no longer linked to an institution';
  }
  if (diagnostic === 'missing_token_issue_participant_token' || diagnostic === 'missing_resource_participant_token') {
    return 'Participant token missing';
  }
  if (diagnostic === 'missing_validation') return 'Validation missing';
  if (diagnostic === 'validation_failed') return 'Validation failed';
  if (diagnostic === 'resource_call_failed') return 'Resource call failed';
  if (diagnostic === 'missing_issued_access_token') return 'Access token missing';
  if (diagnostic === 'token_issue_failed') return 'Token issue failed';
  if (diagnostic === 'missing_resource_calls') return 'No resource calls';
  if (diagnostic === 'missing_token_issue') return 'Token request missing';
  return diagnostic;
}

function FlowCard({
  title,
  subtitle,
  status,
  right,
  children,
  selected = false,
  highlighted = false,
  onClick,
  onHoverChange,
}: {
  title: string;
  subtitle?: string;
  status: UiStatus;
  right?: ReactNode;
  children?: ReactNode;
  selected?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const tone = toneForStatus(status);

  return (
    <div
      className={cn(
        'rounded-xl border p-3 shadow-sm transition-all duration-200',
        tone.card,
        selected && 'ring-2 ring-blue-500 border-blue-300 dark:border-blue-700',
        highlighted && !selected && '-translate-y-0.5 shadow-lg scale-[1.01]',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:scale-[1.01] active:scale-[0.995]',
      )}
      onClick={onClick}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('text-sm font-semibold', tone.text)}>{title}</p>
          {subtitle && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function FlowConnector({ status, dashed = false }: { status: UiStatus; dashed?: boolean }) {
  const tone = toneForStatus(status);
  return (
    <div className="hidden md:flex flex-col items-center justify-center gap-2 px-2">
      <div className={cn('h-8 w-0.5 rounded-full opacity-70', tone.line)} />
      <div className="flex items-center justify-center gap-2">
        <div className={cn('h-0.5 w-10 rounded-full', tone.line, dashed && 'border-t-2 border-dashed bg-transparent border-current')} />
        <ArrowRight className={cn('h-4 w-4', tone.text)} />
      </div>
      <div className={cn('h-8 w-0.5 rounded-full opacity-70', tone.line)} />
    </div>
  );
}

function ActorHeader({
  name,
  subtitle,
  status,
}: {
  name: string;
  subtitle: string;
  status: UiStatus;
}) {
  const tone = toneForStatus(status);
  return (
    <div className={cn('rounded-xl border px-4 py-3', tone.card)}>
      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">{subtitle}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className={cn('text-sm font-semibold', tone.text)}>{name}</p>
        <Badge className={tone.badge}>{status === 'ok' ? 'OK' : status === 'missing' ? 'Missing' : status === 'warning' ? 'Warning' : 'Issue'}</Badge>
      </div>
    </div>
  );
}

export function OAuthFlowMap({ summary, tokenIssue, resourceCalls, onInspectConnection, selectedConnectionId, hoveredConnectionId, onHoverConnection }: {
  summary: Awaited<ReturnType<typeof fetchOAuthPipeline>>['summary'];
  tokenIssue: Awaited<ReturnType<typeof fetchOAuthPipeline>>['token_issue'];
  resourceCalls: Awaited<ReturnType<typeof fetchOAuthPipeline>>['resource_calls'];
  onInspectConnection: (id: string) => void;
  selectedConnectionId: string | null;
  hoveredConnectionId: string | null;
  onHoverConnection: (id: string | null) => void;
}) {
  const openConnection = (id: string | null | undefined) => {
    if (id) onInspectConnection(id);
  };

  const tokenIssueStatus: UiStatus = tokenIssue.ui_status;
  const authHeaderStatus = actorSummaryStatus(!!summary.authentication_server, !summary.authentication_server);
  const clientStatus = summary.legal ? 'ok' : summary.complete ? 'error' : 'warning';
  const resourceHeaderStatus = resourceCalls.length > 0 && resourceCalls.some((call) => call.success)
    ? 'ok'
    : resourceCalls.length > 0
      ? 'error'
      : 'missing';

  return (
    <Card>
      <CardContent className="p-4 md:p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Flow Map</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The swimlane shows the relationship between client, authentication server, and resource server. Green is OK, amber is incomplete, red is a problem, gray is missing.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <ActorHeader
            name={summary.participant_institution?.name ?? summary.participant_user?.name ?? summary.participant_user?.username ?? 'Client'}
            subtitle={summary.participant_user ? `Client · ${summary.participant_user.name ?? summary.participant_user.username}` : 'Client'}
            status={clientStatus}
          />
          <ActorHeader
            name={summary.authentication_server?.name ?? 'Authentication Server'}
            subtitle="Authentication Server"
            status={authHeaderStatus}
          />
          <ActorHeader
            name={summary.resource_servers[0]?.name ?? (resourceCalls.length > 1 ? `${resourceCalls.length} resource servers` : 'Resource Server')}
            subtitle="Resource Server"
            status={resourceHeaderStatus}
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-gradient-to-r from-blue-50 via-white to-emerald-50 p-3 dark:border-gray-700 dark:from-blue-950/20 dark:via-gray-800 dark:to-emerald-950/20">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Token Exchange</span>
              <Badge className={toneForStatus(tokenIssueStatus).badge}>
                {tokenIssueStateLabel(tokenIssue)}
              </Badge>
            </div>
            {summarizeTokenIssueProblems(tokenIssue).length > 0 && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                {summarizeTokenIssueProblems(tokenIssue).join(' ')}
              </div>
            )}
            <div className="space-y-3 md:hidden">
              <FlowCard
                title="Client Request"
                subtitle={tokenIssue.req_timestamp ? fmtDate(tokenIssue.req_timestamp) : 'No request recorded'}
                status={tokenIssue.participant_token_present ? 'ok' : tokenIssue.connection_id ? 'error' : 'missing'}
                selected={selectedConnectionId === tokenIssue.connection_id}
                highlighted={!!tokenIssue.connection_id && hoveredConnectionId === tokenIssue.connection_id}
                onClick={tokenIssue.connection_id ? () => openConnection(tokenIssue.connection_id) : undefined}
                onHoverChange={tokenIssue.connection_id ? (hovered) => onHoverConnection(hovered ? tokenIssue.connection_id : null) : undefined}
                right={(
                  !tokenIssue.connection_id
                    ? <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">No request</Badge>
                    : <StatusBadge ok={tokenIssue.participant_token_present} trueLabel="Participant token" falseLabel="Missing token" />
                )}
              >
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {tokenIssue.is_refresh_grant
                    ? 'Client exchanges a refresh token for a new access token.'
                    : 'Client requests a token from the authentication server.'}
                </p>
              </FlowCard>
              <div className="ml-4 h-5 w-0.5 rounded-full bg-gray-300 dark:bg-gray-600" />
              <FlowCard
                title="Token Issue"
                subtitle="Authentication server response"
                status={tokenIssueStatus}
                selected={selectedConnectionId === tokenIssue.connection_id}
                highlighted={!!tokenIssue.connection_id && hoveredConnectionId === tokenIssue.connection_id}
                onClick={tokenIssue.connection_id ? () => openConnection(tokenIssue.connection_id) : undefined}
                onHoverChange={tokenIssue.connection_id ? (hovered) => onHoverConnection(hovered ? tokenIssue.connection_id : null) : undefined}
                right={(
                  <Badge className={tokenIssue.status_code ? httpStatusColor(tokenIssue.status_code) : toneForStatus(tokenIssueStatus).badge}>
                    {tokenIssue.status_code ?? '—'}
                  </Badge>
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {tokenIssue.connection_id ? (
                    <>
                      <StatusBadge ok={tokenIssue.access_token_extracted} trueLabel="Access token extracted" falseLabel="Response missing access_token" />
                      {tokenIssue.is_refresh_grant && (
                        <StatusBadge ok={tokenIssue.refresh_token_rotated} trueLabel="Refresh token rotated" falseLabel="Refresh token not rotated" />
                      )}
                    </>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">Token response unavailable</Badge>
                  )}
                </div>
              </FlowCard>
            </div>

            <div className="hidden md:grid gap-3 md:grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)_64px_minmax(0,1fr)] items-stretch">
              <FlowCard
                title="Client Request"
                subtitle={tokenIssue.req_timestamp ? fmtDate(tokenIssue.req_timestamp) : 'No request recorded'}
                status={tokenIssue.participant_token_present ? 'ok' : tokenIssue.connection_id ? 'error' : 'missing'}
                selected={selectedConnectionId === tokenIssue.connection_id}
                highlighted={!!tokenIssue.connection_id && hoveredConnectionId === tokenIssue.connection_id}
                onClick={tokenIssue.connection_id ? () => openConnection(tokenIssue.connection_id) : undefined}
                onHoverChange={tokenIssue.connection_id ? (hovered) => onHoverConnection(hovered ? tokenIssue.connection_id : null) : undefined}
                right={(
                  !tokenIssue.connection_id
                    ? <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">No request</Badge>
                    : <StatusBadge ok={tokenIssue.participant_token_present} trueLabel="Participant token" falseLabel="Missing token" />
                )}
              >
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {tokenIssue.is_refresh_grant
                    ? 'Client exchanges a refresh token for a new access token.'
                    : 'Client requests a token from the authentication server.'}
                </p>
                {tokenIssue.connection_id && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                      Grant: {tokenIssue.grant_type ?? 'unknown'}
                    </Badge>
                    {tokenIssue.is_refresh_grant && (
                      <StatusBadge
                        ok={tokenIssue.refresh_token_supplied}
                        trueLabel="Refresh token supplied"
                        falseLabel="Refresh token missing"
                        falseTone="warning"
                      />
                    )}
                    {tokenIssue.participant_token_present && (
                      <StatusBadge
                        ok={tokenIssue.participant_token_linked}
                        trueLabel="Participant linked"
                        falseLabel="Token expired or unlinked"
                      />
                    )}
                  </div>
                )}
              </FlowCard>
              <FlowConnector status={tokenIssue.participant_token_present ? 'ok' : tokenIssue.connection_id ? 'error' : 'missing'} />
              <FlowCard
                title="Token Issue"
                subtitle="Authentication server response"
                status={tokenIssueStatus}
                selected={selectedConnectionId === tokenIssue.connection_id}
                highlighted={!!tokenIssue.connection_id && hoveredConnectionId === tokenIssue.connection_id}
                onClick={tokenIssue.connection_id ? () => openConnection(tokenIssue.connection_id) : undefined}
                onHoverChange={tokenIssue.connection_id ? (hovered) => onHoverConnection(hovered ? tokenIssue.connection_id : null) : undefined}
                right={(
                  <Badge className={tokenIssue.status_code ? httpStatusColor(tokenIssue.status_code) : toneForStatus(tokenIssueStatus).badge}>
                    {tokenIssue.status_code ?? '—'}
                  </Badge>
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {tokenIssue.connection_id ? (
                    <>
                      <StatusBadge ok={tokenIssue.access_token_extracted} trueLabel="Access token extracted" falseLabel="Response missing access_token" />
                      {tokenIssue.is_refresh_grant && (
                        <StatusBadge
                          ok={tokenIssue.refresh_token_rotated}
                          trueLabel="Refresh token rotated"
                          falseLabel="Refresh token not rotated"
                        />
                      )}
                    </>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">Token response unavailable</Badge>
                  )}
                </div>
              </FlowCard>
              <FlowConnector status="missing" dashed />
              <div className="hidden md:block rounded-xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20" />
            </div>
          </div>

          {resourceCalls.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No resource calls were matched to this pipeline yet.
            </div>
          ) : (
            resourceCalls.map((call, index) => {
              const resourceStatus: UiStatus = call.ui_status;
              const validationStatus: UiStatus = call.validation
                ? call.validation.ui_status
                : 'missing';
              const problems = summarizeResourceProblems(call);

              return (
                <div
                  key={call.resource_connection_id}
                  className="rounded-2xl border border-gray-200 bg-gradient-to-r from-sky-50 via-white to-orange-50 p-3 dark:border-gray-700 dark:from-sky-950/20 dark:via-gray-800 dark:to-orange-950/20"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                      Resource Flow #{index + 1}
                    </span>
                    <Badge className={toneForStatus(resourceStatus).badge}>
                      {call.success ? 'Resource OK' : 'Resource issue'}
                    </Badge>
                    <Badge className={toneForStatus(validationStatus).badge}>
                      {call.validation ? (call.validation.success ? 'Validation OK' : 'Validation failed') : 'Validation missing'}
                    </Badge>
                  </div>
                  {problems.length > 0 && (
                    <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                      {problems.join(' ')}
                    </div>
                  )}

                  <div className="space-y-3 md:hidden">
                    <FlowCard
                      title="Client Resource Request"
                      subtitle={fmtDate(call.req_timestamp)}
                      status={call.participant_token_present ? resourceStatus : 'error'}
                      selected={selectedConnectionId === call.resource_connection_id}
                      highlighted={hoveredConnectionId === call.resource_connection_id}
                      onClick={() => openConnection(call.resource_connection_id)}
                      onHoverChange={(hovered) => onHoverConnection(hovered ? call.resource_connection_id : null)}
                      right={<Badge className={methodColor(call.method)}>{call.method}</Badge>}
                    >
                      <p className="font-mono text-xs text-gray-600 dark:text-gray-300 break-all">{call.url}</p>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <StatusBadge ok={call.participant_token_present} trueLabel="Participant token" falseLabel="Missing token" />
                        {call.participant_token_present && (
                          <StatusBadge
                            ok={call.participant_token_linked}
                            trueLabel="Participant linked"
                            falseLabel="Token expired or unlinked"
                          />
                        )}
                      </div>
                    </FlowCard>
                    <div className="ml-4 h-5 w-0.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                    <FlowCard
                      title={call.resource_server.name}
                      subtitle="Resource server response"
                      status={resourceStatus}
                      selected={selectedConnectionId === call.resource_connection_id}
                      highlighted={hoveredConnectionId === call.resource_connection_id}
                      onClick={() => openConnection(call.resource_connection_id)}
                      onHoverChange={(hovered) => onHoverConnection(hovered ? call.resource_connection_id : null)}
                      right={(
                        <Badge className={call.status_code ? httpStatusColor(call.status_code) : toneForStatus(resourceStatus).badge}>
                          {call.status_code ?? '—'}
                        </Badge>
                      )}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge ok={call.success} trueLabel="Call succeeded" falseLabel="Call failed" />
                      </div>
                    </FlowCard>
                    <div className="ml-4 h-5 w-0.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                    {call.validation ? (
                      <FlowCard
                        title="Token Validation"
                        subtitle={call.validation.authentication_server?.name ?? summary.authentication_server?.name ?? 'Authentication server'}
                        status={validationStatus}
                        selected={selectedConnectionId === call.validation.connection_id}
                        onClick={() => openConnection(call.validation?.connection_id)}
                        right={(
                          <Badge className={call.validation.status_code ? httpStatusColor(call.validation.status_code) : toneForStatus(validationStatus).badge}>
                            {call.validation.status_code ?? '—'}
                          </Badge>
                        )}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge ok={call.validation.body_check_passed} trueLabel="Body check passed" falseLabel="Body check failed" />
                        </div>
                      </FlowCard>
                    ) : (
                      <FlowCard
                        title="Validation Missing"
                        subtitle="Expected resource server verification request"
                        status="missing"
                        right={<CircleDashed className="h-4 w-4 text-gray-400" />}
                      >
                        <p className="text-xs text-gray-600 dark:text-gray-300">
                          No validation request was matched to this resource call.
                        </p>
                      </FlowCard>
                    )}
                  </div>

                  <div className="hidden md:grid gap-3 md:grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)_64px_minmax(0,1fr)] items-stretch">
                    <FlowCard
                      title="Client Resource Request"
                      subtitle={fmtDate(call.req_timestamp)}
                      status={call.participant_token_present ? resourceStatus : 'error'}
                      selected={selectedConnectionId === call.resource_connection_id}
                      highlighted={hoveredConnectionId === call.resource_connection_id}
                      onClick={() => openConnection(call.resource_connection_id)}
                      onHoverChange={(hovered) => onHoverConnection(hovered ? call.resource_connection_id : null)}
                      right={<Badge className={methodColor(call.method)}>{call.method}</Badge>}
                    >
                      <p className="font-mono text-xs text-gray-600 dark:text-gray-300 break-all">{call.url}</p>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <StatusBadge ok={call.participant_token_present} trueLabel="Participant token" falseLabel="Missing token" />
                        {call.participant_token_present && (
                          <StatusBadge
                            ok={call.participant_token_linked}
                            trueLabel="Participant linked"
                            falseLabel="Token expired or unlinked"
                          />
                        )}
                      </div>
                    </FlowCard>
                    <FlowConnector status={call.participant_token_present ? resourceStatus : 'error'} />
                    <FlowCard
                      title={call.resource_server.name}
                      subtitle="Resource server response"
                      status={resourceStatus}
                      selected={selectedConnectionId === call.resource_connection_id}
                      highlighted={hoveredConnectionId === call.resource_connection_id}
                      onClick={() => openConnection(call.resource_connection_id)}
                      onHoverChange={(hovered) => onHoverConnection(hovered ? call.resource_connection_id : null)}
                      right={(
                        <Badge className={call.status_code ? httpStatusColor(call.status_code) : toneForStatus(resourceStatus).badge}>
                          {call.status_code ?? '—'}
                        </Badge>
                      )}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge ok={call.success} trueLabel="Call succeeded" falseLabel="Call failed" />
                      </div>
                    </FlowCard>
                    <FlowConnector status={validationStatus} dashed={!call.validation} />
                    {call.validation ? (
                      <FlowCard
                        title="Token Validation"
                        subtitle={call.validation.authentication_server?.name ?? summary.authentication_server?.name ?? 'Authentication server'}
                        status={validationStatus}
                        selected={selectedConnectionId === call.validation.connection_id}
                        onClick={() => openConnection(call.validation?.connection_id)}
                        right={(
                          <Badge className={call.validation.status_code ? httpStatusColor(call.validation.status_code) : toneForStatus(validationStatus).badge}>
                            {call.validation.status_code ?? '—'}
                          </Badge>
                        )}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge ok={call.validation.body_check_passed} trueLabel="Body check passed" falseLabel="Body check failed" />
                        </div>
                      </FlowCard>
                    ) : (
                      <FlowCard
                        title="Validation Missing"
                        subtitle="Expected resource server verification request"
                        status="missing"
                        right={<CircleDashed className="h-4 w-4 text-gray-400" />}
                      >
                        <p className="text-xs text-gray-600 dark:text-gray-300">
                          No validation request was matched to this resource call.
                        </p>
                      </FlowCard>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function OAuthPipelineDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['oauth-pipeline', id],
    queryFn: () => fetchOAuthPipeline(id),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Link to="/traffic" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
          <ArrowLeft className="h-4 w-4" />
          Back to Traffic
        </Link>
        <Card>
          <CardContent className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">
            OAuth pipeline not found
          </CardContent>
        </Card>
      </div>
    );
  }

  const { summary, token_issue, resource_calls } = data;
  const participantName = summary.participant_institution?.name
    ?? summary.participant_user?.name
    ?? summary.participant_user?.username
    ?? 'Unknown participant';
  const backHref = typeof location.state === 'object' && location.state !== null
    ? `${String((location.state as { fromPath?: string }).fromPath ?? '/traffic')}${String((location.state as { fromSearch?: string }).fromSearch ?? '?view=oauth')}`
    : '/traffic?view=oauth';

  return (
    <div className="space-y-4">
      <Link to={backHref} className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
        <ArrowLeft className="h-4 w-4" />
        Back to OAuth Pipelines
      </Link>

      <div className="flex w-full flex-col gap-4 xl:flex-row xl:items-start">
        <div className={cn('space-y-4 min-w-0', selectedConnectionId ? 'flex-1' : 'w-full')}>
          <PageHeader
            title="OAuth Pipeline"
            description={`Started ${fmtDate(summary.started_at)} · ${participantName}`}
            actions={(
              <>
                <StatusBadge ok={summary.complete} trueLabel="Complete" falseLabel="Incomplete" />
                <StatusBadge ok={summary.legal} trueLabel="Legal" falseLabel="Illegal" />
                <StatusBadge ok={summary.success} trueLabel="Success" falseLabel="Failed" />
                <ShareLinkButton shareToken={data.share_token} />
              </>
            )}
          />

          <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs uppercase tracking-wide text-gray-400">Participant Institution</p>
            <p className="text-sm font-medium">{summary.participant_institution?.name ?? '—'}</p>
            {summary.participant_user && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                user: {summary.participant_user.name ?? summary.participant_user.username}
              </p>
            )}
          </CardContent>
        </Card>
        <Card><CardContent className="p-4 space-y-1"><p className="text-xs uppercase tracking-wide text-gray-400">Authentication Server</p><p className="text-sm font-medium">{summary.authentication_server?.name ?? '—'}</p></CardContent></Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-gray-400">Access Token</p>
            <p className="font-mono text-sm">{summary.access_token.fingerprint}</p>
            {data.access_token_full && (
              <details className="pt-1">
                <summary className="cursor-pointer text-xs text-blue-600 hover:text-blue-700">Show full token</summary>
                <p className="mt-2 break-all rounded-md bg-gray-50 px-2 py-2 font-mono text-xs text-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                  {data.access_token_full}
                </p>
              </details>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-gray-400">Token Grant</p>
            <p className="text-sm font-medium">{token_issue.grant_type ?? 'unknown'}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={token_issue.is_refresh_grant ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}>
                {token_issue.is_refresh_grant ? 'Refresh grant' : 'Initial grant'}
              </Badge>
              <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                {summary.resource_call_count} resource · {summary.validation_call_count} validation
              </Badge>
            </div>
          </CardContent>
        </Card>
          </div>

          <Card>
            <CardContent className="p-4 flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-gray-400">Pipeline Summary</span>
              <Badge className={summary.diagnostics.length === 0 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                {summary.diagnostics_summary}
              </Badge>
              {summary.diagnostics.map((diagnostic) => (
                <Badge key={diagnostic} className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                  {humanizeDiagnostic(diagnostic)}
                </Badge>
              ))}
            </CardContent>
          </Card>

          {(data.refresh_token_full || data.issued_refresh_token_full || token_issue.is_refresh_grant) && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs uppercase tracking-wide text-gray-400">Refresh Token Flow</span>
                  <Badge className={token_issue.is_refresh_grant ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}>
                    {token_issue.is_refresh_grant ? 'Refresh grant detected' : 'Refresh token present'}
                  </Badge>
                  <StatusBadge ok={token_issue.refresh_token_supplied} trueLabel="Refresh token supplied" falseLabel="Refresh token missing" falseTone="warning" />
                  <StatusBadge ok={token_issue.refresh_token_rotated} trueLabel="Refresh token rotated" falseLabel="Refresh token not rotated" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Supplied refresh token</p>
                    <p className="mt-1 break-all rounded-md bg-gray-50 px-2 py-2 font-mono text-xs text-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                      {data.refresh_token_full ?? token_issue.refresh_token_fingerprint ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Issued refresh token</p>
                    <p className="mt-1 break-all rounded-md bg-gray-50 px-2 py-2 font-mono text-xs text-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                      {data.issued_refresh_token_full ?? token_issue.issued_refresh_token_fingerprint ?? '—'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {(data.refresh_chain.previous_pipeline || data.refresh_chain.next_pipelines.length > 0) && (
            <Card>
              <CardContent className="p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Refresh Chain</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Shows how this pipeline is linked to earlier or later token issues through the same refresh token.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-gray-400">Previous Pipeline</p>
                {data.refresh_chain.previous_pipeline ? (
                  <Link
                    to={`/oauth/pipelines/${data.refresh_chain.previous_pipeline.id}`}
                    state={location.state}
                    className="block rounded-lg border border-blue-200 bg-blue-50 p-3 hover:border-blue-300 dark:border-blue-900/50 dark:bg-blue-950/20"
                  >
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      {data.refresh_chain.previous_pipeline.access_token_fingerprint}
                    </p>
                    <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                      {data.refresh_chain.previous_pipeline.grant_type ?? 'unknown'} · {fmtDate(data.refresh_chain.previous_pipeline.started_at)}
                    </p>
                    <p className="mt-1 text-xs text-blue-700/80 dark:text-blue-300/80">
                      {data.refresh_chain.previous_pipeline.authentication_server?.name ?? 'Authentication server'}
                    </p>
                  </Link>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-500">
                    No earlier pipeline was found for this refresh token.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-gray-400">Next Pipelines</p>
                {data.refresh_chain.next_pipelines.length > 0 ? (
                  <div className="space-y-2">
                    {data.refresh_chain.next_pipelines.map((pipeline) => (
                      <Link
                        key={pipeline.id}
                        to={`/oauth/pipelines/${pipeline.id}`}
                        state={location.state}
                        className="block rounded-lg border border-emerald-200 bg-emerald-50 p-3 hover:border-emerald-300 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                      >
                        <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                          {pipeline.access_token_fingerprint}
                        </p>
                        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                          {pipeline.grant_type ?? 'unknown'} · {fmtDate(pipeline.started_at)}
                        </p>
                        <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">
                          {pipeline.authentication_server?.name ?? 'Authentication server'}
                        </p>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-500">
                    No later pipelines were found using the issued refresh token.
                  </div>
                )}
              </div>
            </div>
              </CardContent>
            </Card>
          )}

          <OAuthFlowMap
            summary={summary}
            tokenIssue={token_issue}
            resourceCalls={resource_calls}
            onInspectConnection={setSelectedConnectionId}
            selectedConnectionId={selectedConnectionId}
            hoveredConnectionId={hoveredConnectionId}
            onHoverConnection={setHoveredConnectionId}
          />

        </div>

        <ConnectionInspectPanel
          id={selectedConnectionId}
          onClose={() => setSelectedConnectionId(null)}
          description="Click a token issue, resource call, or validation step to inspect its raw request and response."
        />
      </div>
    </div>
  );
}
