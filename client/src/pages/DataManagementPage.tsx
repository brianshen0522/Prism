import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, CheckCircle, XCircle, Loader2, Clock, AlertTriangle } from 'lucide-react';
import {
  startExport, startImport, fetchTasks, fetchTask, getDownloadUrl,
  type AdminTask,
} from '../lib/api';
import { Button } from '../components/ui/button';
import { PageHeader, PageShell } from '../components/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { fmtDate } from '../lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isActive(task: AdminTask) {
  return task.status === 'pending' || task.status === 'running';
}

function StatusIcon({ status }: { status: AdminTask['status'] }) {
  if (status === 'done') return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (status === 'error') return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === 'running' || status === 'pending')
    return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
      <div
        className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

// ─── Active task poller ───────────────────────────────────────────────────────

function useActiveTask(taskId: string | null) {
  return useQuery({
    queryKey: ['admin-task', taskId],
    queryFn: () => fetchTask(taskId!),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || isActive(data)) return 2000;
      return false;
    },
  });
}

// ─── Export section ───────────────────────────────────────────────────────────

function ExportSection() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const { data: task } = useActiveTask(taskId);

  const mut = useMutation({
    mutationFn: startExport,
    onSuccess: (res) => setTaskId(res.task_id),
  });

  const handleExport = () => {
    setTaskId(null);
    mut.mutate();
  };

  return (
    <Card className="border-gray-200/80 dark:border-gray-700">
      <CardHeader className="bg-gray-50/70 dark:bg-gray-800/60">
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="h-4 w-4" />
          Export
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Export all data — settings, servers, participant tokens, traffic, and OAuth pipelines — as a
          single JSON file. The export runs in the background; a download link appears when ready.
        </p>

        <Button onClick={handleExport} disabled={mut.isPending || (!!task && isActive(task))}>
          {mut.isPending || (task && isActive(task)) ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Preparing...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Export All Data
            </>
          )}
        </Button>

        {task && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="flex items-center gap-2">
              <StatusIcon status={task.status} />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {task.message ?? task.status}
              </span>
            </div>
            {isActive(task) && <ProgressBar value={task.progress} />}
            {task.status === 'done' && task.download_token && (
              <a
                href={getDownloadUrl(task.download_token)}
                className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
              >
                <Download className="h-3.5 w-3.5" />
                Download export
              </a>
            )}
            {task.status === 'error' && (
              <p className="text-xs text-red-600 dark:text-red-400">{task.error}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Import section ───────────────────────────────────────────────────────────

function ImportSection() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [parsedData, setParsedData] = useState<unknown>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: task } = useActiveTask(taskId);
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () => startImport(parsedData),
    onSuccess: (res) => {
      setTaskId(res.task_id);
      setConfirm(false);
      setParsedData(null);
      setFileName(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['admin-tasks'] });
    },
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    setParsedData(null);
    setFileName(file.name);
    setReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!parsed?.prism_export_version || !parsed?.data) {
          setFileError('This does not look like a Prism export file.');
          setReading(false);
          return;
        }
        setParsedData(parsed);
      } catch {
        setFileError('Failed to parse JSON. Make sure the file is a valid Prism export.');
      }
      setReading(false);
    };
    reader.onerror = () => {
      setFileError('Failed to read file.');
      setReading(false);
    };
    reader.readAsText(file);
  };

  return (
    <Card className="border-gray-200/80 dark:border-gray-700">
      <CardHeader className="bg-gray-50/70 dark:bg-gray-800/60">
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4" />
          Import
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700/50 dark:bg-amber-900/20">
          <div className="flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              <strong>Destructive operation.</strong> Importing will permanently delete all current
              traffic, pipelines, settings, servers, and participant tokens, then replace them with the
              imported data. This cannot be undone.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Select export file (.json)
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFile}
            className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 dark:text-gray-400 dark:file:bg-blue-900/30 dark:file:text-blue-300"
          />
          {reading && (
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Reading file...
            </p>
          )}
          {fileError && <p className="text-xs text-red-600 dark:text-red-400">{fileError}</p>}
          {parsedData != null && fileName && !fileError && (
            <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> {fileName} loaded and ready.
            </p>
          )}
        </div>

        {!confirm ? (
          <Button
            variant="danger"
            disabled={!parsedData || reading || (!!task && isActive(task))}
            onClick={() => setConfirm(true)}
          >
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3 dark:border-red-800/50 dark:bg-red-900/20">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              Are you sure? All existing data will be permanently deleted and replaced.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => mut.mutate()}
                disabled={mut.isPending}
              >
                {mut.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting...</>
                ) : (
                  'Yes, overwrite everything'
                )}
              </Button>
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {task && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="flex items-center gap-2">
              <StatusIcon status={task.status} />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {task.message ?? task.status}
              </span>
            </div>
            {isActive(task) && <ProgressBar value={task.progress} />}
            {task.status === 'error' && (
              <p className="text-xs text-red-600 dark:text-red-400">{task.error}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Task history ─────────────────────────────────────────────────────────────

function TaskHistory() {
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['admin-tasks'],
    queryFn: fetchTasks,
    refetchInterval: 5000,
  });

  if (isLoading) return null;
  if (!tasks?.length) return null;

  return (
    <Card className="border-gray-200/80 dark:border-gray-700">
      <CardHeader className="bg-gray-50/70 dark:bg-gray-800/60">
        <CardTitle className="text-base">Recent Tasks</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-3 px-4 py-3">
              <StatusIcon status={task.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">
                    {task.type}
                  </span>
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                    {task.message ?? task.status}
                  </span>
                </div>
                {isActive(task) && (
                  <div className="mt-1.5">
                    <ProgressBar value={task.progress} />
                  </div>
                )}
                {task.status === 'error' && task.error && (
                  <p className="mt-0.5 text-xs text-red-600 dark:text-red-400 truncate">{task.error}</p>
                )}
              </div>
              <div className="shrink-0 text-right space-y-0.5">
                <p className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(task.created_at)}</p>
                {task.status === 'done' && task.download_token && task.type === 'export' && (
                  <a
                    href={getDownloadUrl(task.download_token)}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Download
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DataManagementPage() {
  return (
    <PageShell width="narrow">
      <PageHeader
        title="Data Management"
        description="Export or import the full Prism dataset including traffic, pipelines, settings, servers, and participant tokens."
      />
      <ExportSection />
      <ImportSection />
      <TaskHistory />
    </PageShell>
  );
}
