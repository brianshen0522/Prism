import { useState, useContext, createContext, useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Clock, Copy, Search, Server, X } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { copyToClipboard, fmtDate, fmtDuration, fmtBytes, statusColor, httpStatusColor, methodColor } from '../lib/utils';
import type { ConnectionDetail } from '../lib/api';

// ─── Headers ──────────────────────────────────────────────────────────────────

function HeadersTable({ headers }: { headers: Record<string, string | string[]> | null }) {
  if (!headers || !Object.keys(headers).length)
    return <p className="text-xs text-gray-400 dark:text-gray-500">No headers</p>;
  return (
    <table className="w-full text-xs font-mono">
      <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
        {Object.entries(headers).map(([k, v]) => (
          <tr key={k}>
            <td className="py-1 pr-4 text-gray-500 dark:text-gray-400 whitespace-nowrap align-top w-48">{k}</td>
            <td className="py-1 text-gray-800 dark:text-gray-200 break-all">{Array.isArray(v) ? v.join(', ') : v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await copyToClipboard(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      title={label}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CollapsibleHeaders({ headers }: { headers: Record<string, string | string[]> | null }) {
  const [open, setOpen] = useState(false);
  const count = headers ? Object.keys(headers).length : 0;
  const headersJson = headers ? JSON.stringify(headers, null, 2) : '{}';
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 w-full text-left group">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Headers</p>
        <span className="text-xs text-gray-400 dark:text-gray-500">({count})</span>
        <ChevronDown className={`h-3.5 w-3.5 text-gray-400 dark:text-gray-500 transition-transform ml-auto ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex justify-end">
            <CopyButton value={headersJson} label="Copy JSON" />
          </div>
          <HeadersTable headers={headers} />
        </div>
      )}
    </div>
  );
}

// ─── Body viewer ──────────────────────────────────────────────────────────────

type ViewMode = 'raw' | 'json' | 'html';

function detectMode(body: string, contentType?: string): ViewMode {
  const ct = contentType?.toLowerCase() ?? '';
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  const t = body.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (t.startsWith('<')) return 'html';
  return 'raw';
}

type JsonVal = string | number | boolean | null | JsonVal[] | { [k: string]: JsonVal };

interface JsonTreeCtxType { sig: number; expand: boolean; term: string; }
const JsonTreeCtx = createContext<JsonTreeCtxType>({ sig: 0, expand: true, term: '' });

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(term)})`, 'gi'));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === term.toLowerCase()
          ? <mark key={i} className="json-match bg-yellow-200 text-yellow-900 rounded-sm not-italic dark:bg-yellow-700/60 dark:text-yellow-100">{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

function JsonPrimitive({ value }: { value: string | number | boolean | null }) {
  const { term } = useContext(JsonTreeCtx);
  if (value === null) return <span className="text-gray-400 dark:text-gray-500">null</span>;
  if (typeof value === 'boolean') return <span className="text-purple-600 dark:text-purple-400">{String(value)}</span>;
  if (typeof value === 'number') {
    return (
      <span className="text-orange-500 dark:text-orange-400">
        <Highlighted text={String(value)} term={term} />
      </span>
    );
  }
  const encoded = JSON.stringify(value);
  const inner = encoded.slice(1, -1);
  return (
    <span className="text-green-700 dark:text-green-400">
      &quot;<Highlighted text={inner} term={term} />&quot;
    </span>
  );
}

function JsonNode({ value, propKey, isLast, depth }: { value: JsonVal; propKey?: string; isLast: boolean; depth: number }) {
  const { sig, expand, term } = useContext(JsonTreeCtx);
  const [open, setOpen] = useState(depth < 2);
  const prevSig = useRef(sig);

  useEffect(() => {
    if (sig !== prevSig.current) { prevSig.current = sig; setOpen(expand); }
  }, [sig, expand]);

  useEffect(() => { if (term) setOpen(true); }, [term]);

  const comma = isLast ? null : <span className="text-gray-400">,</span>;
  const keyEl = propKey !== undefined ? (
    <>
      <span className="text-blue-700 dark:text-blue-400">&quot;<Highlighted text={propKey} term={term} />&quot;</span>
      <span className="text-gray-400 dark:text-gray-500">: </span>
    </>
  ) : null;

  if (value === null || typeof value !== 'object') {
    return <div className="leading-5">{keyEl}<JsonPrimitive value={value as string | number | boolean | null} />{comma}</div>;
  }

  const isArr = Array.isArray(value);
  const entries: [string, JsonVal][] = isArr
    ? (value as JsonVal[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, JsonVal>);
  const [ob, cb] = isArr ? ['[', ']'] : ['{', '}'];

  if (entries.length === 0) {
    return <div className="leading-5">{keyEl}<span className="text-gray-400 dark:text-gray-500">{ob}{cb}</span>{comma}</div>;
  }

  return (
    <div>
      <div className="leading-5 flex items-center gap-0.5 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700 rounded -mx-1 px-1" onClick={() => setOpen(o => !o)}>
        <span className="text-gray-400 dark:text-gray-500 w-3 text-center shrink-0 text-[10px]">{open ? '▾' : '▸'}</span>
        {keyEl}
        <span className="text-gray-500 dark:text-gray-400">{ob}</span>
        {!open && (
          <>
            <span className="text-gray-400 dark:text-gray-500 text-[10px] px-1">{entries.length} {isArr ? 'items' : 'keys'}</span>
            <span className="text-gray-500 dark:text-gray-400">{cb}</span>
            {comma}
          </>
        )}
      </div>
      {open && (
        <>
          <div className="ml-3 border-l border-gray-200 dark:border-gray-600 pl-2">
            {entries.map(([key, val], idx) => (
              <JsonNode key={key} value={val} propKey={isArr ? undefined : key} isLast={idx === entries.length - 1} depth={depth + 1} />
            ))}
          </div>
          <div className="leading-5"><span className="text-gray-500 dark:text-gray-400">{cb}</span>{comma}</div>
        </>
      )}
    </div>
  );
}

function JsonTree({ body }: { body: string }) {
  const parsed: JsonVal = JSON.parse(body);
  const [sig, setSig] = useState(0);
  const [expand, setExpand] = useState(true);
  const [term, setTerm] = useState('');
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  function trigger(e: boolean) { setExpand(e); setSig(s => s + 1); }

  // Reset to first result when search term changes
  useEffect(() => { setActiveMatchIdx(0); }, [term]);

  // After each render: count .json-match marks, apply active style, scroll to active
  useEffect(() => {
    if (!term) { setMatchCount(0); return; }
    // Two rAF frames to let auto-expand re-renders settle
    let r1: number, r2: number;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        const marks = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('.json-match') ?? []);
        setMatchCount(marks.length);
        const idx = Math.min(activeMatchIdx, Math.max(0, marks.length - 1));
        marks.forEach((m, i) => {
          if (i === idx) {
            m.style.backgroundColor = '#ea580c'; // orange-600
            m.style.color = 'white';
            m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else {
            m.style.removeProperty('background-color');
            m.style.removeProperty('color');
          }
        });
      });
    });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [term, activeMatchIdx]);

  const prevMatch = () => setActiveMatchIdx(i => Math.max(0, i - 1));
  const nextMatch = () => setActiveMatchIdx(i => Math.min(matchCount - 1, i + 1));

  return (
    <JsonTreeCtx.Provider value={{ sig, expand, term }}>
      <div className="rounded border border-gray-200 dark:border-gray-700 overflow-hidden text-xs font-mono">
        <div className="flex flex-col gap-2 px-3 py-1.5 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 sm:flex-row sm:items-center sm:gap-1.5">
          <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 sm:py-0.5">
            <Search className="h-3 w-3 text-gray-400 dark:text-gray-500 shrink-0" />
            <input
              type="text"
              value={term}
              onChange={e => setTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.shiftKey ? prevMatch() : nextMatch(); } }}
              placeholder="Search keys / values…"
              className="flex-1 min-w-0 bg-transparent outline-none text-xs placeholder-gray-400 dark:placeholder-gray-500 dark:text-gray-100"
            />
            {term && (
              <button onClick={() => setTerm('')} className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 shrink-0">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {term && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap shrink-0 tabular-nums min-w-[3rem] text-center">
                {matchCount === 0 ? 'No results' : `${activeMatchIdx + 1} / ${matchCount}`}
              </span>
              <button
                onClick={prevMatch}
                disabled={matchCount === 0 || activeMatchIdx === 0}
                className="p-0.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={nextMatch}
                disabled={matchCount === 0 || activeMatchIdx >= matchCount - 1}
                className="p-0.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap sm:ml-auto">
            <button onClick={() => trigger(true)} title="Expand all" className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors">
              <ChevronsUpDown className="h-3 w-3" />Expand
            </button>
            <button onClick={() => trigger(false)} title="Collapse all" className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors">
              <ChevronsDownUp className="h-3 w-3" />Collapse
            </button>
            <CopyButton value={body} label="Copy JSON" />
          </div>
        </div>
        <div ref={containerRef} className="p-3 overflow-auto max-h-96 bg-gray-50 dark:bg-gray-900">
          <JsonNode value={parsed} isLast propKey={undefined} depth={0} />
        </div>
      </div>
    </JsonTreeCtx.Provider>
  );
}

export function BodyBlock({ body, truncated, contentType }: { body: string | null; truncated: boolean; contentType?: string }) {
  const isValidJson = !!body && (() => { try { JSON.parse(body); return true; } catch { return false; } })();
  const isValidHtml = !!body && /<[a-z][\s\S]*>/i.test(body);
  const defaultMode = body ? detectMode(body, contentType) : 'raw';
  const [mode, setMode] = useState<ViewMode>(defaultMode);

  if (!body) return <p className="text-xs text-gray-400">No body</p>;

  const tabLabel: Record<ViewMode, string> = { raw: 'Raw', json: 'JSON', html: 'HTML' };
  const tabEnabled: Record<ViewMode, boolean> = { raw: true, json: isValidJson, html: isValidHtml };

  return (
    <div className="space-y-2">
      {truncated && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 dark:bg-amber-900/30 dark:text-amber-400">
          Body was truncated due to the server's storage limit.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {(['raw', 'json', 'html'] as ViewMode[]).map((t) => {
          const enabled = tabEnabled[t];
          const active = mode === t;
          return (
            <button key={t} onClick={() => enabled && setMode(t)} disabled={!enabled}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                active ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
                : enabled ? 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                : 'bg-gray-50 text-gray-300 cursor-not-allowed dark:bg-gray-800 dark:text-gray-600'
              }`}>
              {tabLabel[t]}
            </button>
          );
        })}
      </div>
      {mode === 'raw' && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <CopyButton value={body} label="Copy raw" />
          </div>
          <pre className="text-xs font-mono bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-700 p-3 overflow-auto max-h-96 whitespace-pre-wrap break-all dark:text-gray-200">
            {body}
          </pre>
        </div>
      )}
      {mode === 'json' && <JsonTree body={body} />}
      {mode === 'html' && (
        <iframe srcDoc={body} sandbox="" className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white" style={{ height: '24rem' }} title="HTML preview" />
      )}
    </div>
  );
}

// ─── cURL builder ─────────────────────────────────────────────────────────────

// Headers that are injected by the proxy/nginx or managed by curl itself —
// including them in a replay curl would be wrong or redundant.
const CURL_SKIP_HEADERS = new Set([
  'host', 'connection', 'content-length',
  'x-real-ip', 'x-forwarded-for', 'x-forwarded-proto',
  'x-forwarded-scheme', 'x-forwarded-host',
]);

function buildCurl(c: ConnectionDetail): string {
  const headers = c.req_headers ?? {};

  // Reconstruct full URL: req_url is only the path, so prepend scheme+host.
  const host = (headers['host'] as string | undefined) ?? '';
  const scheme = (headers['x-forwarded-proto'] as string | undefined)
    ?? (headers['x-forwarded-scheme'] as string | undefined)
    ?? 'http';
  const url = host ? `${scheme}://${host}${c.req_url}` : c.req_url;

  const parts: string[] = [`curl -X ${c.req_method}`, `  '${url}'`];

  for (const [k, v] of Object.entries(headers)) {
    if (CURL_SKIP_HEADERS.has(k.toLowerCase())) continue;
    const val = (Array.isArray(v) ? v.join(', ') : v).replace(/'/g, "'\\''");
    parts.push(`  -H '${k}: ${val}'`);
  }

  if (c.req_body) {
    parts.push(`  --data '${c.req_body.replace(/'/g, "'\\''")}'`);
  }

  return parts.join(' \\\n');
}

// ─── ConnectionDetailContent — the shareable detail view ─────────────────────

export function ConnectionDetailContent({ c }: { c: ConnectionDetail }) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-2 text-sm">
        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
          <Clock className="h-3.5 w-3.5" />{fmtDate(c.req_timestamp)}
        </div>
        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
          <Server className="h-3.5 w-3.5" />{c.server_name ?? c.server_id}
        </div>
        <Badge className={statusColor(c.status)}>{c.status}</Badge>
        {c.res_status_code && <Badge className={httpStatusColor(c.res_status_code)}>HTTP {c.res_status_code}</Badge>}
        <span className="text-gray-500 dark:text-gray-400 text-xs">{fmtDuration(c.duration_ms)}</span>
        <span className="text-gray-400 dark:text-gray-500 text-xs">
          {fmtBytes(c.req_body_size)} → {fmtBytes(c.res_body_size)}
        </span>
      </div>

      {/* Request */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle>Request</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`font-mono text-xs ${methodColor(c.req_method)}`}>
                  {c.req_method}
                </Badge>
                <code className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">{c.req_url}</code>
              </div>
            </div>
            <CopyButton value={buildCurl(c)} label="Copy cURL" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <CollapsibleHeaders headers={c.req_headers} />
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Body</p>
            <BodyBlock body={c.req_body} truncated={c.req_body_truncated} contentType={c.req_headers?.['content-type'] as string | undefined} />
          </div>
        </CardContent>
      </Card>

      {/* Response */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Response</CardTitle>
            {c.res_timestamp && <span className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(c.res_timestamp)}</span>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {c.status === 'error' ? (
            <p className="text-sm text-red-600 dark:text-red-400">Request failed — target was unreachable.</p>
          ) : c.status === 'pending' ? (
            <p className="text-sm text-yellow-600 dark:text-yellow-400">Response not yet received.</p>
          ) : (
            <>
              <CollapsibleHeaders headers={c.res_headers} />
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Body</p>
                <BodyBlock body={c.res_body} truncated={c.res_body_truncated} contentType={c.res_headers?.['content-type'] as string | undefined} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Skeleton placeholder ─────────────────────────────────────────────────────

export function ConnectionDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
