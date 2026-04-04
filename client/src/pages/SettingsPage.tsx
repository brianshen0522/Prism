import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { fetchSettings, upsertSetting, deleteSetting, type Setting } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { PageHeader, PageShell } from '../components/PageLayout';
import { EmptyState, TableCard } from '../components/PagePrimitives';
import { Skeleton } from '../components/ui/skeleton';
import { fmtDate } from '../lib/utils';

// ─── Predefined setting suggestions ──────────────────────────────────────────

const SUGGESTIONS = [
  { key: 'participant_token_header', label: 'Participant token header name', hint: 'Header participants must include in requests. Default: X-Participant-Token' },
  { key: 'participant_token_ttl_minutes', label: 'Participant token TTL (minutes)', hint: 'How often participant tokens rotate. Default: 5' },
  { key: 'default_body_size_limit_kb', label: 'Default body storage limit (KB)', hint: 'Applied to new servers. 0 = unlimited.' },
  { key: 'proxy_request_timeout_ms', label: 'Proxy request timeout (ms)', hint: 'Max time to wait for target. Default: 30000.' },
  { key: 'dashboard_requests_window_minutes', label: 'Dashboard requests window (minutes)', hint: 'Time window for the Requests and Error Rate stat cards. Default: 5.' },
  { key: 'dashboard_chart_hours', label: 'Dashboard chart window (hours)', hint: 'How many hours of history the traffic chart covers. Default: 24.' },
  { key: 'dashboard_chart_bucket_minutes', label: 'Dashboard chart bucket size (minutes)', hint: 'Granularity of each bar in the traffic chart. E.g. 10, 30, 60, 120. Default: 60.' },
  { key: 'connectathon_name', label: 'Connectathon name', hint: 'Displayed in the UI header.' },
];

// ─── Inline editable row ──────────────────────────────────────────────────────

function SettingRow({ setting }: { setting: Setting }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(setting.value);

  const saveMut = useMutation({
    mutationFn: () => upsertSetting(setting.key, draft),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); setEditing(false); },
  });

  const delMut = useMutation({
    mutationFn: () => deleteSetting(setting.key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const suggestion = SUGGESTIONS.find((s) => s.key === setting.key);

  return (
    <tr className="group hover:bg-gray-50 dark:hover:bg-gray-700">
      <td className="px-4 py-3 align-top">
        <p className="font-mono text-xs text-gray-700 dark:text-gray-300">{setting.key}</p>
        {suggestion && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{suggestion.hint}</p>}
      </td>
      <td className="px-4 py-3 align-top">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              className="h-7 text-xs py-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveMut.mutate();
                if (e.key === 'Escape') { setEditing(false); setDraft(setting.value); }
              }}
            />
            <Button variant="ghost" size="sm" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
              <Check className="h-3.5 w-3.5 text-green-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(setting.value); }}>
              <X className="h-3.5 w-3.5 text-gray-400" />
            </Button>
          </div>
        ) : (
          <span className="font-mono text-sm text-gray-800 dark:text-gray-200">{setting.value}</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmtDate(setting.updated_at)}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="text-gray-400 hover:text-blue-600">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm"
            loading={delMut.isPending}
            onClick={() => { if (confirm(`Delete setting "${setting.key}"?`)) delMut.mutate(); }}
            className="text-gray-400 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Add new setting row ──────────────────────────────────────────────────────

function AddSettingRow({ onCancel, initialKey = '' }: { onCancel: () => void; initialKey?: string }) {
  const qc = useQueryClient();
  const [key, setKey] = useState(initialKey);
  const [value, setValue] = useState('');

  const mut = useMutation({
    mutationFn: () => upsertSetting(key.trim(), value),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); onCancel(); },
  });

  return (
    <tr className="bg-blue-50 dark:bg-blue-900/30">
      <td className="px-4 py-3">
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="setting_key"
          autoFocus
          className="h-7 text-xs py-1 font-mono"
          list="setting-suggestions"
        />
        <datalist id="setting-suggestions">
          {SUGGESTIONS.map((s) => <option key={s.key} value={s.key} />)}
        </datalist>
      </td>
      <td className="px-4 py-3">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value"
          className="h-7 text-xs py-1"
          onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) mut.mutate(); if (e.key === 'Escape') onCancel(); }}
        />
      </td>
      <td className="px-4 py-3" />
      <td className="px-4 py-3 text-right">
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="sm" loading={mut.isPending} disabled={!key.trim()} onClick={() => mut.mutate()}>
            <Check className="h-3.5 w-3.5 text-green-600" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-3.5 w-3.5 text-gray-400" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function AddSettingMobileCard({ onCancel, initialKey = '' }: { onCancel: () => void; initialKey?: string }) {
  const qc = useQueryClient();
  const [key, setKey] = useState(initialKey);
  const [value, setValue] = useState('');

  const mut = useMutation({
    mutationFn: () => upsertSetting(key.trim(), value),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); onCancel(); },
  });

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm dark:border-blue-800 dark:bg-blue-950/20">
      <div className="space-y-3">
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="setting_key"
          autoFocus
          className="font-mono"
          list="mobile-setting-suggestions"
        />
        <datalist id="mobile-setting-suggestions">
          {SUGGESTIONS.map((s) => <option key={s.key} value={s.key} />)}
        </datalist>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value"
          onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) mut.mutate(); if (e.key === 'Escape') onCancel(); }}
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" loading={mut.isPending} disabled={!key.trim()} onClick={() => mut.mutate()}>
            <Check className="h-3.5 w-3.5 text-green-600" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-3.5 w-3.5 text-gray-400" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettingMobileCard({ setting }: { setting: Setting }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(setting.value);

  const saveMut = useMutation({
    mutationFn: () => upsertSetting(setting.key, draft),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); setEditing(false); },
  });

  const delMut = useMutation({
    mutationFn: () => deleteSetting(setting.key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const suggestion = SUGGESTIONS.find((s) => s.key === setting.key);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="space-y-1">
        <p className="font-mono text-xs text-gray-700 dark:text-gray-300">{setting.key}</p>
        {suggestion && <p className="text-xs text-gray-400 dark:text-gray-500">{suggestion.hint}</p>}
      </div>

      <div className="mt-3">
        {editing ? (
          <div className="space-y-3">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              className="text-sm"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                <Check className="h-3.5 w-3.5 text-green-600" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(setting.value); }}>
                <X className="h-3.5 w-3.5 text-gray-400" />
              </Button>
            </div>
          </div>
        ) : (
          <p className="break-all font-mono text-sm text-gray-800 dark:text-gray-200">{setting.value}</p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(setting.updated_at)}</p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="text-gray-400 hover:text-blue-600">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={delMut.isPending}
            onClick={() => { if (confirm(`Delete setting "${setting.key}"?`)) delMut.mutate(); }}
            className="text-gray-400 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── SettingsPage ─────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [addingKey, setAddingKey] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Settings"
        description="Manage system-wide configuration stored in the database."
        actions={(
          <Button size="sm" onClick={() => setAddingKey('')} disabled={addingKey !== null}>
            <Plus className="h-4 w-4" />
            Add setting
          </Button>
        )}
      />

      <TableCard title="Configuration">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {addingKey !== null && <AddSettingMobileCard initialKey={addingKey} onCancel={() => setAddingKey(null)} />}
                {!settings?.length && addingKey === null ? (
                  <EmptyState title="No settings configured yet" className="py-12" />
                ) : (
                  settings?.map((s) => <SettingMobileCard key={s.key} setting={s} />)
                )}
              </div>
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium w-64">Key</th>
                    <th className="px-4 py-3 font-medium">Value</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Last updated</th>
                    <th className="px-4 py-3 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {addingKey !== null && <AddSettingRow initialKey={addingKey} onCancel={() => setAddingKey(null)} />}
                  {!settings?.length && addingKey === null ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-0">
                        <EmptyState title="No settings configured yet" className="py-12" />
                      </td>
                    </tr>
                  ) : (
                    settings?.map((s) => <SettingRow key={s.key} setting={s} />)
                  )}
                </tbody>
              </table>
            </>
          )}
      </TableCard>

      {/* Suggested settings helper */}
      {SUGGESTIONS.some((s) => !settings?.some((r) => r.key === s.key)) && (
        <TableCard title="Suggested settings">
            <>
              <div className="space-y-3 p-4 md:hidden">
                {SUGGESTIONS.filter((s) => !settings?.some((r) => r.key === s.key)).map((s) => (
                  <div key={s.key} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                    <p className="font-mono text-xs text-gray-700 dark:text-gray-300">{s.key}</p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{s.hint}</p>
                    <Button variant="ghost" size="sm" onClick={() => setAddingKey(s.key)} className="mt-3 text-blue-600">
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                ))}
              </div>
              <table className="hidden w-full text-sm md:table">
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {SUGGESTIONS.filter((s) => !settings?.some((r) => r.key === s.key)).map((s) => (
                    <tr key={s.key} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-gray-700 dark:text-gray-300">{s.key}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{s.hint}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => setAddingKey(s.key)}
                          className="text-blue-600"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
        </TableCard>
      )}
    </PageShell>
  );
}
