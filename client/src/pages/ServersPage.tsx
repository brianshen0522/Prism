import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Play, Square, RotateCcw, Pencil, Trash2,
  Upload, Download, ChevronDown, Lock, Unlock,
} from 'lucide-react';
import {
  fetchAdminServers, createServer, updateServer, deleteServer,
  startServer, stopServer, restartServer, importServers,
  type AdminServer, type CreateServerBody, type UpdateServerBody,
} from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { PageHeader, PageShell } from '../components/PageLayout';
import { EmptyState, TableCard, TableScroller } from '../components/PagePrimitives';
import { Badge } from '../components/ui/badge';
import { Dialog } from '../components/ui/dialog';
import { Skeleton } from '../components/ui/skeleton';

// ─── Server status badges ─────────────────────────────────────────────────────

function StatusCell({ server }: { server: AdminServer }) {
  return (
    <div className="flex flex-col gap-1">
      <Badge className={server.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
        {server.is_active ? 'active' : 'inactive'}
      </Badge>
      <Badge className={server.is_running ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-400'}>
        {server.is_running ? 'running' : 'stopped'}
      </Badge>
    </div>
  );
}

// ─── Row actions ──────────────────────────────────────────────────────────────

function RowActions({
  server,
  locked,
  onEdit,
  onDelete,
}: {
  server: AdminServer;
  locked: boolean;
  onEdit: (s: AdminServer) => void;
  onDelete: (s: AdminServer) => void;
}) {
  const qc = useQueryClient();
  const mut = (fn: (id: string) => Promise<AdminServer>) =>
    useMutation({
      mutationFn: () => fn(server.id),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-servers'] }),
    });

  const startMut = mut(startServer);
  const stopMut = mut(stopServer);
  const restartMut = mut(restartServer);

  return (
    <div className="flex items-center gap-1 justify-end">
      {server.is_running ? (
        <>
          <Button
            variant="ghost" size="sm" title="Stop"
            loading={stopMut.isPending}
            disabled={locked}
            onClick={() => stopMut.mutate()}
            className="text-gray-500 hover:text-amber-600"
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm" title="Restart"
            loading={restartMut.isPending}
            disabled={locked}
            onClick={() => restartMut.mutate()}
            className="text-gray-500 hover:text-blue-600"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <Button
          variant="ghost" size="sm" title="Start"
          loading={startMut.isPending}
          disabled={locked}
          onClick={() => startMut.mutate()}
          className="text-gray-500 hover:text-green-600"
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
      )}

      <Button
        variant="ghost" size="sm" title="Edit"
        disabled={locked}
        onClick={() => onEdit(server)}
        className="text-gray-500 hover:text-blue-600"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost" size="sm" title="Delete"
        disabled={locked}
        onClick={() => onDelete(server)}
        className="text-gray-500 hover:text-red-600"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ServerMobileCard({
  server,
  locked,
  onEdit,
  onDelete,
}: {
  server: AdminServer;
  locked: boolean;
  onEdit: (s: AdminServer) => void;
  onDelete: (s: AdminServer) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{server.name}</p>
          <p className="mt-1 break-all font-mono text-xs text-gray-500 dark:text-gray-400">{server.target_url}</p>
        </div>
        <StatusCell server={server} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">:{server.proxy_port}</Badge>
        <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
          {server.body_size_limit_kb ? `${server.body_size_limit_kb} KB` : '∞'}
        </Badge>
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          {server.server_role}
        </Badge>
      </div>

      <div className="mt-3">
        <RowActions server={server} locked={locked} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

// ─── Server form ──────────────────────────────────────────────────────────────

interface ServerFormProps {
  initial?: AdminServer | null;
  allServers: AdminServer[];
  onSave: (data: CreateServerBody | UpdateServerBody) => Promise<void>;
  onClose: () => void;
  saving: boolean;
  error?: string;
}

function ServerForm({ initial, allServers, onSave, onClose, saving, error }: ServerFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [targetUrl, setTargetUrl] = useState(initial?.target_url ?? '');
  const [sslVerify, setSslVerify] = useState(initial?.ssl_verify ?? true);
  const [proxyPort, setProxyPort] = useState(initial?.proxy_port?.toString() ?? '');
  const [bodyLimit, setBodyLimit] = useState(initial?.body_size_limit_kb?.toString() ?? '');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [serverRole, setServerRole] = useState<AdminServer['server_role']>(initial?.server_role ?? 'generic');
  const [oauthAuthServerId, setOauthAuthServerId] = useState(initial?.oauth_auth_server_id ?? '');
  const [oauthTokenEndpoint, setOauthTokenEndpoint] = useState(initial?.oauth_token_endpoint ?? '');
  const [oauthValidationEndpoint, setOauthValidationEndpoint] = useState(initial?.oauth_validation_endpoint ?? '');
  const [oauthValidationSuccessPath, setOauthValidationSuccessPath] = useState(initial?.oauth_validation_success_path ?? 'active');
  const [oauthValidationSuccessValue, setOauthValidationSuccessValue] = useState(initial?.oauth_validation_success_value ?? 'true');

  const isEditing = !!initial;
  const authServers = allServers.filter((server) => server.server_role === 'authentication' && server.id !== initial?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isHttps = targetUrl.startsWith('https://');
    const body: CreateServerBody & UpdateServerBody = {
      name,
      target_url: targetUrl,
      is_https: isHttps,
      ssl_verify: sslVerify,
      body_size_limit_kb: bodyLimit ? parseInt(bodyLimit, 10) : null,
      server_role: serverRole,
      oauth_auth_server_id: serverRole === 'resource' && oauthAuthServerId ? oauthAuthServerId : null,
      oauth_token_endpoint: serverRole === 'authentication' && oauthTokenEndpoint.trim() ? oauthTokenEndpoint.trim() : null,
      oauth_validation_endpoint: serverRole === 'authentication' && oauthValidationEndpoint.trim() ? oauthValidationEndpoint.trim() : null,
      oauth_validation_success_path: serverRole === 'authentication' && oauthValidationSuccessPath.trim() ? oauthValidationSuccessPath.trim() : null,
      oauth_validation_success_value: serverRole === 'authentication' && oauthValidationSuccessValue.trim() ? oauthValidationSuccessValue.trim() : null,
    };
    if (!isEditing && proxyPort) body.proxy_port = parseInt(proxyPort, 10);
    if (isEditing) body.is_active = isActive;
    await onSave(body);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Name *</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="FHIR Server A" required />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Role *</label>
        <select
          value={serverRole}
          onChange={(e) => setServerRole(e.target.value as AdminServer['server_role'])}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="generic">Generic</option>
          <option value="authentication">Authentication server</option>
          <option value="resource">Resource server</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Target URL *</label>
        <Input
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://hapi.fhir.tw/"
          type="url"
          required
        />
        {targetUrl.startsWith('https://') && (
          <p className="text-xs text-blue-600">HTTPS target detected</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          id="ssl_verify"
          type="checkbox"
          checked={sslVerify}
          onChange={(e) => setSslVerify(e.target.checked)}
          className="rounded border-gray-300"
        />
        <label htmlFor="ssl_verify" className="text-sm text-gray-700 dark:text-gray-300">Verify SSL certificate</label>
      </div>

      {!isEditing && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Proxy port <span className="text-gray-400 dark:text-gray-500 font-normal">(auto-assigned if blank)</span>
          </label>
          <Input
            value={proxyPort}
            onChange={(e) => setProxyPort(e.target.value)}
            placeholder="7001"
            type="number"
            min={1024}
            max={65535}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Body storage limit (KB) <span className="text-gray-400 dark:text-gray-500 font-normal">(blank = unlimited)</span>
        </label>
        <Input
          value={bodyLimit}
          onChange={(e) => setBodyLimit(e.target.value)}
          placeholder="e.g. 512"
          type="number"
          min={1}
        />
      </div>

      {serverRole === 'authentication' && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">OAuth Authentication Settings</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Used to detect token issuance and validation traffic for OAuth pipelines.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Token endpoint</label>
            <Input value={oauthTokenEndpoint} onChange={(e) => setOauthTokenEndpoint(e.target.value)} placeholder="/oauth/token" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Validation endpoint</label>
            <Input value={oauthValidationEndpoint} onChange={(e) => setOauthValidationEndpoint(e.target.value)} placeholder="/oauth/introspect" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Validation success JSON path</label>
              <Input value={oauthValidationSuccessPath} onChange={(e) => setOauthValidationSuccessPath(e.target.value)} placeholder="active" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Expected value</label>
              <Input value={oauthValidationSuccessValue} onChange={(e) => setOauthValidationSuccessValue(e.target.value)} placeholder="true" />
            </div>
          </div>
        </div>
      )}

      {serverRole === 'resource' && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">OAuth Resource Settings</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Optionally link this resource server to its authentication server to improve pipeline matching.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Authentication server</label>
            <select
              value={oauthAuthServerId}
              onChange={(e) => setOauthAuthServerId(e.target.value)}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">Auto-detect</option>
              {authServers.map((server) => (
                <option key={server.id} value={server.id}>{server.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {isEditing && (
        <div className="flex items-center gap-2">
          <input
            id="is_active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded border-gray-300"
          />
          <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded px-3 py-2">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={saving}>{isEditing ? 'Save changes' : 'Create server'}</Button>
      </div>
    </form>
  );
}

// ─── Import dialog ────────────────────────────────────────────────────────────

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<{ created: number; warnings: string[] } | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const mut = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const payload = JSON.parse(text);
      return importServers(payload);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin-servers'] });
      setResult({ created: data.created, warnings: data.warnings });
    },
    onError: (err) => setError((err as Error).message),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult(null);
    mut.mutate(file);
  };

  const handleClose = () => {
    setResult(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Import servers (JSON)">
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select a Prism JSON export file. Port conflicts are auto-resolved.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFile}
          className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 dark:file:bg-blue-900/30 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50"
        />

        {mut.isPending && <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">Importing…</p>}

        {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded px-3 py-2">{error}</p>}

        {result && (
          <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 p-3 space-y-2">
            <p className="text-sm font-medium text-green-800 dark:text-green-400">{result.created} server{result.created !== 1 ? 's' : ''} imported</p>
            {result.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">⚠ {w}</p>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={handleClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Export dropdown ──────────────────────────────────────────────────────────

function ExportMenu() {
  const [open, setOpen] = useState(false);

  const download = async (format: 'json' | 'csv') => {
    setOpen(false);
    const { useAuthStore } = await import('../store/auth');
    const token = useAuthStore.getState().accessToken;
    const path = `/api/admin/servers/export${format === 'csv' ? '/csv' : ''}`;
    const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format === 'csv' ? 'prism-servers.csv' : 'prism-servers.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        <Download className="h-3.5 w-3.5" />
        Export
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-36 rounded-md bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 py-1">
            <button
              onClick={() => download('json')}
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              JSON
            </button>
            <button
              onClick={() => download('csv')}
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ServersPage ──────────────────────────────────────────────────────────────

export function ServersPage() {
  const qc = useQueryClient();
  const [locked, setLocked] = useState(() => localStorage.getItem('servers-locked') !== '0');
  const [formServer, setFormServer] = useState<AdminServer | null | 'new'>('new' as any);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [formError, setFormError] = useState('');

  const toggleLock = () => setLocked((v) => {
    localStorage.setItem('servers-locked', v ? '0' : '1');
    return !v;
  });

  const { data: servers, isLoading } = useQuery({
    queryKey: ['admin-servers'],
    queryFn: fetchAdminServers,
    refetchInterval: 10_000,
  });

  const createMut = useMutation({
    mutationFn: (body: CreateServerBody) => createServer(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-servers'] }); setShowForm(false); setFormError(''); },
    onError: (err) => setFormError((err as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateServerBody }) => updateServer(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-servers'] }); setShowForm(false); setFormError(''); },
    onError: (err) => setFormError((err as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteServer,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-servers'] }),
  });

  const editing = showForm && formServer && formServer !== 'new' ? formServer as AdminServer : null;

  const handleSave = async (body: CreateServerBody | UpdateServerBody) => {
    if (editing) {
      await updateMut.mutateAsync({ id: editing.id, body: body as UpdateServerBody });
    } else {
      await createMut.mutateAsync(body as CreateServerBody);
    }
  };

  const handleDelete = (s: AdminServer) => {
    if (confirm(`Delete "${s.name}"? This will stop the proxy listener and remove all connection history.`)) {
      deleteMut.mutate(s.id);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Servers"
        description={servers
          ? `${servers.length} server${servers.length !== 1 ? 's' : ''} · ${servers.filter((s) => s.is_running).length} running`
          : 'Manage proxy targets, runtime state, and OAuth server classification.'}
        actions={(
          <>
          <Button
            variant={locked ? 'primary' : 'secondary'}
            size="sm"
            onClick={toggleLock}
            title={locked ? 'Unlock to allow changes' : 'Lock to prevent changes'}
            className={locked ? 'bg-amber-500 hover:bg-amber-600 border-amber-500' : ''}
          >
            {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            {locked ? 'Locked' : 'Lock'}
          </Button>

          <Button
            variant="secondary" size="sm"
            disabled={locked}
            onClick={() => { setShowImport(true); }}
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>

          <ExportMenu />

          <Button
            size="sm"
            disabled={locked}
            onClick={() => { setFormServer('new' as any); setFormError(''); setShowForm(true); }}
          >
            <Plus className="h-4 w-4" />
            Add server
          </Button>
          </>
        )}
      />

      {/* Lock banner */}
      {locked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-400">
          <Lock className="h-4 w-4 shrink-0" />
          <span>Server configuration is locked. Click <strong>Locked</strong> to unlock and allow changes.</span>
        </div>
      )}

      {/* Table */}
      <TableCard>
        <TableScroller>
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : !servers?.length ? (
            <EmptyState title="No servers configured yet" description="Add a server to start proxying traffic." />
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {servers.map((s) => (
                  <ServerMobileCard
                    key={s.id}
                    server={s}
                    locked={locked}
                    onEdit={(sv) => { setFormServer(sv); setFormError(''); setShowForm(true); }}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Target URL</th>
                    <th className="px-4 py-3 font-medium">Port</th>
                    <th className="px-4 py-3 font-medium">Limit</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {servers.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{s.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 max-w-[220px] truncate" title={s.target_url}>
                        {s.target_url}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">:{s.proxy_port}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {s.body_size_limit_kb ? `${s.body_size_limit_kb} KB` : '∞'}
                      </td>
                      <td className="px-4 py-3"><StatusCell server={s} /></td>
                      <td className="px-4 py-3">
                        <RowActions
                          server={s}
                          locked={locked}
                          onEdit={(sv) => { setFormServer(sv); setFormError(''); setShowForm(true); }}
                          onDelete={handleDelete}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </TableScroller>
      </TableCard>

      {/* Create / Edit dialog */}
      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? `Edit "${editing.name}"` : 'Add server'}
        className="max-w-lg"
      >
        <ServerForm
          initial={editing}
          allServers={servers ?? []}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
          saving={createMut.isPending || updateMut.isPending}
          error={formError}
        />
      </Dialog>

      {/* Import dialog */}
      <ImportDialog open={showImport} onClose={() => setShowImport(false)} />
    </PageShell>
  );
}
