import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
} from 'lucide-react';
import { fetchAdminUsers, type AdminUser } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { PageHeader, PageShell } from '../components/PageLayout';
import { EmptyState, FilterCard, TableCard, TableScroller } from '../components/PagePrimitives';
import { Skeleton } from '../components/ui/skeleton';
import { fmtDate } from '../lib/utils';

const PAGE_SIZE = 20;

function fullName(user: AdminUser) {
  const name = [user.firstname, user.lastname].filter(Boolean).join(' ').trim();
  return name || '—';
}

function roleBadgeClass(role: AdminUser['role']) {
  if (role === 'admin') return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  if (role === 'monitor') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  if (role === 'oauth2') return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
  return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
}

function statusBadgeClass(user: AdminUser) {
  if (user.blocked) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  if (!user.activated) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
}

function tokenBadgeClass(user: AdminUser) {
  if (!user.participant_token.exists) return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  if (user.participant_token.institution_mismatch) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
  if (!user.participant_token.valid) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
}

function tokenStatusLabel(user: AdminUser) {
  if (!user.participant_token.exists) return 'No token';
  if (user.participant_token.institution_mismatch) return 'Institution mismatch';
  if (!user.participant_token.valid) return 'Expired';
  return 'Valid';
}

function UserDetail({ user }: { user: AdminUser }) {
  const institution = user.institution;
  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Institution</p>
        <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
          {institution ? institution.name : '—'}
        </p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {institution ? `ID ${institution.id}` : 'No institution assigned'}
        </p>
        {institution?.keyword ? (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Keyword: <span className="font-mono">{institution.keyword}</span>
          </p>
        ) : null}
        {institution && !institution.activated ? (
          <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Institution not activated
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Participant token</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge className={tokenBadgeClass(user)}>{tokenStatusLabel(user)}</Badge>
          <Badge className={user.participant_token.exists ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-500'}>
            {user.participant_token.exists ? 'Present' : 'Missing'}
          </Badge>
        </div>
        <div className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>Expires: {fmtDate(user.participant_token.expires_at)}</p>
          <p>Token institution ID: {user.participant_token.institution_id ?? '—'}</p>
          <p>Current institution ID: {user.institution?.id ?? '—'}</p>
          {user.participant_token.institution_mismatch ? (
            <p className="text-orange-700 dark:text-orange-300">
              The current token was issued for a different institution and will refresh on the next login.
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Activity</p>
        <div className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>Last login: {fmtDate(user.last_login)}</p>
          <p>Created: {fmtDate(user.creation_date)}</p>
          <p>Connections: {user.connection_count}</p>
          <p>Last connection: {fmtDate(user.last_connection_at)}</p>
        </div>
      </div>
    </div>
  );
}

function UsersTableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function UsersPage() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin-users'],
    queryFn: fetchAdminUsers,
  });

  const [search, setSearch] = useState('');
  const [institutionFilter, setInstitutionFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  useEffect(() => {
    setPage(1);
    setExpandedUserId(null);
  }, [search, institutionFilter, roleFilter, statusFilter]);

  const institutionOptions = useMemo(() => {
    const map = new Map<number, NonNullable<AdminUser['institution']>>();
    (data ?? []).forEach((user) => {
      if (user.institution) map.set(user.institution.id, user.institution);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((user) => {
      if (institutionFilter !== 'all' && String(user.institution?.id ?? '') !== institutionFilter) return false;
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (statusFilter === 'active' && (user.blocked || !user.activated)) return false;
      if (statusFilter === 'blocked' && !user.blocked) return false;
      if (statusFilter === 'not_activated' && user.activated) return false;
      if (!term) return true;
      return [user.username, fullName(user), user.email ?? '']
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [data, institutionFilter, roleFilter, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageUsers = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalUsers = data?.length ?? 0;
  const activeUsers = (data ?? []).filter((user) => user.activated && !user.blocked).length;
  const blockedUsers = (data ?? []).filter((user) => user.blocked).length;
  const mismatchedTokens = (data ?? []).filter((user) => user.participant_token.institution_mismatch).length;

  return (
    <PageShell width="wide">
      <PageHeader
        title="Users"
        description="Review every Gazelle user with their institution, account state, participant token status, and recent connection activity."
        actions={(
          <Button variant="secondary" onClick={() => refetch()} loading={isFetching}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Users', value: totalUsers },
          { label: 'Active', value: activeUsers },
          { label: 'Blocked', value: blockedUsers },
          { label: 'Token mismatches', value: mismatchedTokens },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-900/80">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{item.value}</p>
          </div>
        ))}
      </div>

      <FilterCard>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_220px_180px_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search username, name, or email"
              className="pl-9"
            />
          </div>

          <select
            value={institutionFilter}
            onChange={(event) => setInstitutionFilter(event.target.value)}
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">All institutions</option>
            {institutionOptions.map((institution) => (
              <option key={institution.id} value={institution.id}>
                {institution.name}{institution.keyword ? ` (${institution.keyword})` : ''}
              </option>
            ))}
          </select>

          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">All roles</option>
            <option value="admin">Admin</option>
            <option value="monitor">Monitor</option>
            <option value="oauth2">OAuth2</option>
            <option value="user">User</option>
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="not_activated">Not activated</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
      </FilterCard>

      <TableCard
        title="Users"
        description={(
          <span>
            {filtered.length} matching {filtered.length === 1 ? 'user' : 'users'}
            {' · '}
            page {page} of {totalPages}
          </span>
        )}
      >
        {isLoading ? (
          <UsersTableSkeleton />
        ) : pageUsers.length === 0 ? (
          <EmptyState
            title="No users matched your filters"
            description="Try clearing one of the filters or widening the search terms."
          />
        ) : (
          <TableScroller>
            <table className="min-w-[1180px] w-full">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Institution</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Login</th>
                  <th className="px-4 py-3">Token Status</th>
                  <th className="px-4 py-3">Connections</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {pageUsers.map((user) => {
                  const expanded = expandedUserId === user.id;
                  return (
                    <Fragment key={user.id}>
                      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                        <td className="px-4 py-3 align-top">
                          <button
                            type="button"
                            onClick={() => setExpandedUserId(expanded ? null : user.id)}
                            className="flex items-start gap-2 text-left"
                          >
                            {expanded ? (
                              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-gray-100">{fullName(user)}</p>
                              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{user.institution ? `ID ${user.institution.id}` : 'No institution'}</p>
                            </div>
                          </button>
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-xs text-gray-700 dark:text-gray-300">{user.username}</td>
                        <td className="px-4 py-3 align-top text-sm text-gray-700 dark:text-gray-300">{user.email ?? '—'}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-gray-400" />
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {user.institution?.name ?? '—'}
                              </span>
                            </div>
                            {user.institution?.keyword ? (
                              <Badge className="w-fit bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                                {user.institution.keyword}
                              </Badge>
                            ) : null}
                            {user.institution && !user.institution.activated ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Inactive
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Badge className={roleBadgeClass(user.role)}>{user.role}</Badge>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Badge className={statusBadgeClass(user)}>
                            {user.blocked ? 'Blocked' : user.activated ? 'Active' : 'Not activated'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-gray-500 dark:text-gray-400">{fmtDate(user.last_login)}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="space-y-1">
                            <Badge className={tokenBadgeClass(user)}>{tokenStatusLabel(user)}</Badge>
                            {user.participant_token.exists ? (
                              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                {user.participant_token.institution_mismatch
                                  ? `Issued for institution ${user.participant_token.institution_id ?? '—'}`
                                  : `Expires ${fmtDate(user.participant_token.expires_at)}`}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm text-gray-900 dark:text-gray-100">{user.connection_count}</div>
                          <div className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(user.last_connection_at)}</div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="bg-gray-50/60 dark:bg-gray-800/30">
                          <td colSpan={9} className="px-4 py-4">
                            <UserDetail user={user} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableScroller>
        )}
      </TableCard>

      {filtered.length > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Previous
            </Button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Page {page} / {totalPages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
