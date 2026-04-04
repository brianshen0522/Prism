import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Calendar, ChevronDown, ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import type { ConnectionSummary } from '../lib/api';

// ─── Shared constants ─────────────────────────────────────────────────────────

export const SEL_CLS = 'rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400';
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// ─── Search types ─────────────────────────────────────────────────────────────

export type SearchScope = 'url' | 'req_headers' | 'req_body' | 'res_headers' | 'res_body';

export interface SearchCondition {
  id: string;
  term: string;
  scopes: SearchScope[];
}

export function genCondId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export type FilterField = 'scope' | 'server_id' | 'method' | 'status' | 'res_status_code' | 'user_id' | 'text';

export interface FilterCondition {
  id: string;
  field: FilterField | '';
  logic: 'and' | 'or';
  values: string[];
  term: string;
  scopes: SearchScope[];
}

export function createEmptyFilterCondition(): FilterCondition {
  return {
    id: genCondId(),
    field: '',
    logic: 'and',
    values: [],
    term: '',
    scopes: [],
  };
}

export function createScopeFilterCondition(scope: 'mine' | 'all' = 'mine'): FilterCondition {
  return {
    id: genCondId(),
    field: 'scope',
    logic: 'and',
    values: [scope],
    term: '',
    scopes: [],
  };
}

export function createPresetFilterCondition(
  field: Exclude<FilterField, 'text'>,
  values: string[] = [],
): FilterCondition {
  return {
    id: genCondId(),
    field,
    logic: 'and',
    values,
    term: '',
    scopes: [],
  };
}

export function isFilterConditionActive(condition: FilterCondition): boolean {
  if (condition.field === 'text') return condition.term.trim().length > 0;
  return condition.field !== '' && condition.values.length > 0;
}

// ─── MultiSelect ─────────────────────────────────────────────────────────────

export function MultiSelect({
  placeholder, options, selected, onChange, filterable = false, searchPlaceholder = 'Filter options...',
}: {
  placeholder: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (vals: string[]) => void;
  filterable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (val: string) =>
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);

  const label =
    selected.length === 0 ? `All ${placeholder}`
    : selected.length <= 2 ? selected.join(', ')
    : `${selected[0]} +${selected.length - 1}`;

  const loweredQuery = query.trim().toLowerCase();
  const visibleOptions = loweredQuery
    ? options.filter((option) => option.label.toLowerCase().includes(loweredQuery) || option.value.toLowerCase().includes(loweredQuery))
    : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            if (!next) setQuery('');
            return next;
          });
        }}
        className={`${SEL_CLS} flex items-center gap-1.5 min-w-[120px] cursor-pointer`}
      >
        <span className="flex-1 text-left truncate">{label}</span>
        {selected.length > 0 && (
          <span className="shrink-0 bg-blue-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {selected.length}
          </span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg min-w-full">
          {filterable && (
            <div className="p-2 border-b border-gray-100 dark:border-gray-700">
              <div className="relative min-w-[220px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 border-b border-gray-100 dark:border-gray-700 transition-colors"
            >
              Clear selection
            </button>
          )}
          {visibleOptions.map(opt => (
            <label key={opt.value} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{opt.label}</span>
            </label>
          ))}
          {visibleOptions.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              No matching options
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Date range picker ───────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const TOTAL_MIN   = 24 * 60;

export const QUICK_PRESETS = [
  { label: 'All time', value: '',     minutes: 0 },
  { label: 'Last 15m', value: '15m',  minutes: 15 },
  { label: 'Last 1h',  value: '1h',   minutes: 60 },
  { label: 'Last 6h',  value: '6h',   minutes: 360 },
  { label: 'Last 24h', value: '24h',  minutes: 1440 },
  { label: 'Last 7d',  value: '7d',   minutes: 10080 },
];

export function pad2(n: number) { return String(n).padStart(2, '0'); }

function dateToStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

export function snap5m(d: Date) {
  return `${dateToStr(d)}T${pad2(d.getHours())}:${pad2(Math.floor(d.getMinutes()/5)*5)}`;
}

function minToTimeStr(m: number) { return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; }

function formatDisplayRange(preset: string, from: string, to: string): string {
  if (!from && !to) return 'All time';
  const hit = QUICK_PRESETS.find(p => p.value === preset);
  if (hit && preset !== '' && preset !== 'custom') return hit.label;
  const fmt = (s: string) => {
    if (!s) return '';
    const [datePart, timePart] = s.split('T');
    const [, mo, d] = datePart.split('-');
    return `${MONTH_NAMES[parseInt(mo,10)-1]} ${parseInt(d,10)} ${timePart ?? ''}`.trim();
  };
  return `${fmt(from)} — ${fmt(to)}`;
}

function TimeRangeSlider({
  fromMin, toMin, onChange,
}: {
  fromMin: number; toMin: number;
  onChange: (from: number, to: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'from' | 'to' | null>(null);

  function clientXToMin(clientX: number): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * TOTAL_MIN / 5) * 5;
  }

  function startDrag(which: 'from' | 'to', e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = which;
    const onMove = (ev: MouseEvent) => {
      const m = clientXToMin(ev.clientX);
      if (dragging.current === 'from') onChange(Math.max(0, Math.min(m, toMin - 5)), toMin);
      else onChange(fromMin, Math.max(fromMin + 5, Math.min(m, TOTAL_MIN)));
    };
    const onUp = () => {
      dragging.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleTrackClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).dataset.handle) return;
    const m = clientXToMin(e.clientX);
    if (Math.abs(m - fromMin) <= Math.abs(m - toMin))
      onChange(Math.max(0, Math.min(m, toMin - 5)), toMin);
    else
      onChange(fromMin, Math.max(fromMin + 5, Math.min(m, TOTAL_MIN)));
  }

  const fromPct = (fromMin / TOTAL_MIN) * 100;
  const toPct   = (toMin   / TOTAL_MIN) * 100;
  const TICKS   = [0, 6*60, 12*60, 18*60, TOTAL_MIN];

  return (
    <div className="select-none pt-2 pb-1">
      <div className="relative mx-2" style={{ height: '28px' }}>
        {TICKS.map(t => (
          <div key={t} className="absolute top-0 w-px h-2 bg-gray-300 dark:bg-gray-600 pointer-events-none"
            style={{ left: `${(t / TOTAL_MIN) * 100}%` }} />
        ))}
        <div ref={trackRef}
          className="absolute top-2.5 inset-x-0 h-2 rounded-full bg-gray-200 dark:bg-gray-700 cursor-pointer"
          onClick={handleTrackClick}
        >
          <div className="absolute top-0 h-full bg-blue-500 rounded-full pointer-events-none"
            style={{ left: `${fromPct}%`, width: `${toPct - fromPct}%` }} />
        </div>
        <div data-handle="from"
          className="absolute top-1.5 -translate-x-1/2 w-5 h-5 rounded-full bg-white dark:bg-gray-100 border-2 border-blue-600 shadow-md cursor-grab active:cursor-grabbing z-10"
          style={{ left: `${fromPct}%` }}
          onMouseDown={e => startDrag('from', e)} />
        <div data-handle="to"
          className="absolute top-1.5 -translate-x-1/2 w-5 h-5 rounded-full bg-white dark:bg-gray-100 border-2 border-blue-600 shadow-md cursor-grab active:cursor-grabbing z-10"
          style={{ left: `${toPct}%` }}
          onMouseDown={e => startDrag('to', e)} />
      </div>
      <div className="relative mx-2 mt-1" style={{ height: '14px' }}>
        {TICKS.map(t => (
          <span key={t} className="absolute text-[9px] text-gray-400 dark:text-gray-500 -translate-x-1/2 pointer-events-none"
            style={{ left: `${(t / TOTAL_MIN) * 100}%` }}>
            {t === TOTAL_MIN ? '24' : pad2(Math.floor(t / 60))}
          </span>
        ))}
      </div>
      <div className="flex justify-between mt-1 mx-2 text-xs font-mono font-medium text-blue-600 dark:text-blue-400">
        <span>{minToTimeStr(fromMin)}</span>
        <span>{minToTimeStr(toMin)}</span>
      </div>
    </div>
  );
}

export function DateRangePicker({
  preset, from, to, onChange,
}: {
  preset: string; from: string; to: string;
  onChange: (preset: string, from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const nowRef = new Date();
  const [viewYear,  setViewYear]  = useState(nowRef.getFullYear());
  const [viewMonth, setViewMonth] = useState(nowRef.getMonth());
  const [stage,     setStage]     = useState<'from' | 'to'>('from');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo,   setDraftTo]   = useState('');
  const [fromH,     setFromH]     = useState('00');
  const [fromM,     setFromM]     = useState('00');
  const [toH,       setToH]       = useState('23');
  const [toM,       setToM]       = useState('55');
  const [hover,     setHover]     = useState('');

  useEffect(() => {
    if (!open) return;
    const df = from?.split('T')[0] ?? '';
    const dt = to?.split('T')[0]   ?? '';
    setDraftFrom(df); setDraftTo(dt);
    setFromH(from?.includes('T') ? from.split('T')[1].slice(0,2) : '00');
    setFromM(from?.includes('T') ? from.split('T')[1].slice(3,5) : '00');
    setToH(to?.includes('T')   ? to.split('T')[1].slice(0,2)   : '23');
    setToM(to?.includes('T')   ? to.split('T')[1].slice(3,5)   : '55');
    setStage('from'); setHover('');
    const anchor = df ? new Date(df) : new Date();
    setViewYear(anchor.getFullYear()); setViewMonth(anchor.getMonth());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  function applyQuickPreset(p: typeof QUICK_PRESETS[number]) {
    if (p.value === '') { onChange('', '', ''); }
    else { const now = new Date(); onChange(p.value, snap5m(new Date(now.getTime() - p.minutes * 60 * 1000)), snap5m(now)); }
    setOpen(false);
  }

  function handleDayClick(ds: string) {
    if (stage === 'from') { setDraftFrom(ds); setDraftTo(''); setStage('to'); }
    else {
      let f = draftFrom, t = ds;
      if (t < f) { [f, t] = [t, f]; }
      setDraftFrom(f); setDraftTo(t); setStage('from');
    }
  }

  function applyCustom() {
    if (!draftFrom) return;
    onChange('custom', `${draftFrom}T${fromH}:${fromM}`, `${draftTo || draftFrom}T${toH}:${toM}`);
    setOpen(false);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y-1); setViewMonth(11); } else setViewMonth(m => m-1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y+1); setViewMonth(0); } else setViewMonth(m => m+1);
  }

  const todayStr      = dateToStr(new Date());
  const firstDay      = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMo      = new Date(viewYear, viewMonth + 1, 0).getDate();
  const rangeEnd      = stage === 'to' && hover ? (hover < draftFrom ? draftFrom : hover) : draftTo;
  const effectiveStart = stage === 'to' && hover && hover < draftFrom ? hover : draftFrom;
  const hasActive     = !!(from || to);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors
          ${hasActive || open
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500 text-blue-700 dark:text-blue-300'
            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
      >
        <Calendar className="h-3.5 w-3.5 shrink-0" />
        <span className="whitespace-nowrap">{formatDisplayRange(preset, from, to)}</span>
        {hasActive && (
          <span role="button" onClick={(e) => { e.stopPropagation(); onChange('', '', ''); }}
            className="ml-0.5 opacity-60 hover:opacity-100 cursor-pointer">
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
          <div className="w-32 shrink-0 border-r border-gray-100 dark:border-gray-700 p-2 space-y-0.5">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide px-2 py-1">Quick select</p>
            {QUICK_PRESETS.map(p => (
              <button key={p.value} type="button" onClick={() => applyQuickPreset(p)}
                className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors
                  ${(preset === p.value) || (!preset && p.value === '')
                    ? 'bg-blue-100 dark:bg-blue-800/50 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="p-3 space-y-2" style={{ width: '260px' }}>
            <div className="flex items-center justify-between">
              <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{MONTH_NAMES[viewMonth]} {viewYear}</span>
              <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center">
              {DAY_NAMES.map(d => (
                <div key={d} className="text-[10px] font-medium text-gray-400 dark:text-gray-500 py-0.5">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 text-center gap-y-0.5">
              {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMo }, (_, i) => {
                const day = i + 1;
                const ds = `${viewYear}-${pad2(viewMonth+1)}-${pad2(day)}`;
                const isStart = ds === draftFrom;
                const isEnd   = ds === (draftTo || (stage === 'to' && hover === ds ? hover : ''));
                const inRange = !!(effectiveStart && rangeEnd && ds > effectiveStart && ds < rangeEnd);
                const isToday = ds === todayStr;
                return (
                  <button key={day} type="button"
                    onClick={() => handleDayClick(ds)}
                    onMouseEnter={() => stage === 'to' && setHover(ds)}
                    onMouseLeave={() => setHover('')}
                    className={[
                      'text-xs py-1.5 leading-none transition-colors select-none',
                      isStart || isEnd ? 'bg-blue-600 text-white rounded-full font-semibold'
                        : inRange ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : isToday ? 'text-blue-600 dark:text-blue-400 font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 rounded'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded',
                    ].join(' ')}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-center text-gray-400 dark:text-gray-500">
              {stage === 'from' ? 'Click to set start date' : `Start: ${draftFrom} — click end date`}
            </p>
            {draftFrom && (
              <div className="border-t border-gray-100 dark:border-gray-700 pt-1">
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Time range (drag to adjust)</p>
                <TimeRangeSlider
                  fromMin={parseInt(fromH, 10) * 60 + parseInt(fromM, 10)}
                  toMin={parseInt(toH, 10) * 60 + parseInt(toM, 10)}
                  onChange={(f, t) => {
                    setFromH(pad2(Math.floor(f / 60))); setFromM(pad2(f % 60));
                    setToH(pad2(Math.floor(t / 60)));   setToM(pad2(t % 60));
                  }}
                />
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              {draftFrom && (
                <button type="button" onClick={() => { setDraftFrom(''); setDraftTo(''); setStage('from'); }}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1">
                  Clear
                </button>
              )}
              <button type="button" onClick={applyCustom} disabled={!draftFrom}
                className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-1 rounded transition-colors">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sortable column header ───────────────────────────────────────────────────

export function SortTh({ col, label, sort, order, onSort, align }: {
  col: string; label: string;
  sort: string; order: 'asc' | 'desc';
  onSort: (col: string) => void;
  align?: 'right';
}) {
  const active = sort === col;
  const Icon = active ? (order === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={`px-4 py-3 font-medium ${align === 'right' ? 'text-right' : ''}`}>
      <button type="button" onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors
          ${active ? 'text-blue-600 dark:text-blue-400' : 'hover:text-gray-700 dark:hover:text-gray-300'}`}>
        {align === 'right' && <Icon className="h-3 w-3 shrink-0" />}
        {label}
        {align !== 'right' && <Icon className="h-3 w-3 shrink-0" />}
      </button>
    </th>
  );
}

// ─── Scope selector (for SearchBuilder) ──────────────────────────────────────

const SCOPE_OPTIONS: { value: SearchScope; label: string }[] = [
  { value: 'url',         label: 'URL' },
  { value: 'req_headers', label: 'Req headers' },
  { value: 'req_body',    label: 'Req body' },
  { value: 'res_headers', label: 'Res headers' },
  { value: 'res_body',    label: 'Res body' },
];

function ScopeSelect({ scopes, onChange }: {
  scopes: SearchScope[];
  onChange: (s: SearchScope[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggle = (scope: SearchScope) =>
    onChange(scopes.includes(scope) ? scopes.filter(s => s !== scope) : [...scopes, scope]);

  const label =
    scopes.length === 0 ? 'All fields'
    : scopes.length === 1 ? (SCOPE_OPTIONS.find(o => o.value === scopes[0])?.label ?? scopes[0])
    : `${scopes.length} fields`;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${SEL_CLS} flex items-center gap-1 min-w-[108px] cursor-pointer py-1.5 px-2`}
      >
        <span className="flex-1 text-left truncate text-xs">{label}</span>
        {scopes.length > 0 && (
          <span className="shrink-0 bg-blue-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {scopes.length}
          </span>
        )}
        <ChevronDown className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg min-w-full">
          {scopes.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 border-b border-gray-100 dark:border-gray-700 transition-colors"
            >
              Clear (all fields)
            </button>
          )}
          {SCOPE_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={scopes.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Connection filter builder ────────────────────────────────────────────────

const FILTER_FIELD_OPTIONS: { value: FilterField; label: string }[] = [
  { value: 'scope', label: 'Scope' },
  { value: 'server_id', label: 'Server' },
  { value: 'method', label: 'Method' },
  { value: 'status', label: 'Status' },
  { value: 'res_status_code', label: 'Status code' },
  { value: 'user_id', label: 'User' },
  { value: 'text', label: 'Text' },
];

function fieldLabel(field: FilterField | '') {
  return FILTER_FIELD_OPTIONS.find((option) => option.value === field)?.label ?? 'Condition';
}

function FilterFieldSelect({
  value,
  options,
  onChange,
}: {
  value: FilterField | '';
  options: { value: FilterField; label: string }[];
  onChange: (value: FilterField | '') => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange((e.target.value as FilterField | '') || '')}
      className={`${SEL_CLS} min-w-[140px]`}
    >
      <option value="">Choose condition</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ConditionValueInput({
  condition,
  serverOptions,
  statusCodeOptions,
  userOptions,
  onChange,
}: {
  condition: FilterCondition;
  serverOptions: { value: string; label: string }[];
  statusCodeOptions: { value: string; label: string }[];
  userOptions: { value: string; label: string }[];
  onChange: (patch: Partial<FilterCondition>) => void;
}) {
  if (condition.field === 'scope') {
    return (
      <select
        value={condition.values[0] ?? 'mine'}
        onChange={(e) => onChange({ values: [e.target.value] })}
        className={`${SEL_CLS} min-w-[140px]`}
      >
        <option value="mine">Mine</option>
        <option value="all">All</option>
      </select>
    );
  }

  if (condition.field === 'server_id') {
    return (
      <MultiSelect
        placeholder="Servers"
        options={serverOptions}
        selected={condition.values}
        onChange={(values) => onChange({ values })}
      />
    );
  }

  if (condition.field === 'method') {
    return (
      <MultiSelect
        placeholder="Methods"
        options={HTTP_METHODS.map((method) => ({ value: method, label: method }))}
        selected={condition.values}
        onChange={(values) => onChange({ values })}
      />
    );
  }

  if (condition.field === 'status') {
    return (
      <MultiSelect
        placeholder="Statuses"
        options={[
          { value: 'completed', label: 'Completed' },
          { value: 'error', label: 'Error' },
          { value: 'pending', label: 'Pending' },
        ]}
        selected={condition.values}
        onChange={(values) => onChange({ values })}
      />
    );
  }

  if (condition.field === 'res_status_code') {
    return (
      <MultiSelect
        placeholder="Status codes"
        options={statusCodeOptions}
        selected={condition.values}
        onChange={(values) => onChange({ values })}
        filterable
        searchPlaceholder="Search status codes..."
      />
    );
  }

  if (condition.field === 'user_id') {
    return (
      <MultiSelect
        placeholder="Users"
        options={userOptions}
        selected={condition.values}
        onChange={(values) => onChange({ values })}
        filterable
        searchPlaceholder="Search users..."
      />
    );
  }

  if (condition.field === 'text') {
    return (
      <>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={condition.term}
            onChange={(e) => onChange({ term: e.target.value })}
            placeholder="Contains text..."
            className="w-full pl-8 pr-7 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {condition.term && (
            <button
              type="button"
              onClick={() => onChange({ term: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <ScopeSelect scopes={condition.scopes} onChange={(scopes) => onChange({ scopes })} />
      </>
    );
  }

  return (
    <div className="min-w-[160px] px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 border border-dashed border-gray-300 dark:border-gray-600 rounded-md">
      Select a field first
    </div>
  );
}

export function ConnectionFilterBuilder({
  requiredConditions = [],
  conditions,
  serverOptions,
  statusCodeOptions,
  userOptions,
  allowUserFilter,
  allowScopeFilter = false,
  onRequiredChange,
  onChange,
}: {
  requiredConditions?: FilterCondition[];
  conditions: FilterCondition[];
  serverOptions: { value: string; label: string }[];
  statusCodeOptions: { value: string; label: string }[];
  userOptions: { value: string; label: string }[];
  allowUserFilter: boolean;
  allowScopeFilter?: boolean;
  onRequiredChange?: (conditions: FilterCondition[]) => void;
  onChange: (conditions: FilterCondition[]) => void;
}) {
  const isReusableField = (field: FilterField) => field === 'text';

  const usedFields = [...requiredConditions, ...conditions]
    .map((condition) => condition.field)
    .filter((field): field is FilterField => field !== '' && !isReusableField(field));

  const availableFieldOptions = FILTER_FIELD_OPTIONS.filter((option) => {
    if (!allowUserFilter && option.value === 'user_id') return false;
    if (!allowScopeFilter && option.value === 'scope') return false;
    return true;
  });

  const updateCondition = (id: string, patch: Partial<FilterCondition>) =>
    onChange(conditions.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)));

  const updateRequiredCondition = (id: string, patch: Partial<FilterCondition>) => {
    if (!onRequiredChange) return;
    onRequiredChange(requiredConditions.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)));
  };

  const changeField = (id: string, field: FilterField | '') =>
    onChange(
      conditions.map((condition) => (
        condition.id === id
          ? { ...condition, field, values: [], term: '', scopes: [] }
          : condition
      )),
    );

  const removeCondition = (id: string) => {
    const next = conditions.filter((condition) => condition.id !== id);
    onChange(next.length > 0 ? next : [createEmptyFilterCondition()]);
  };

  const remainingFields = availableFieldOptions.filter(
    (option) => isReusableField(option.value) || !usedFields.includes(option.value),
  );

  return (
    <div className="space-y-3">
      {requiredConditions.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/50 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Required Filters</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">Always shown</span>
          </div>

          {requiredConditions.map((condition) => (
            <div key={condition.id} className="flex items-center gap-1.5 flex-wrap">
              <div className={`${SEL_CLS} min-w-[140px] bg-gray-100 dark:bg-gray-800/80 text-gray-600 dark:text-gray-300`}>
                {fieldLabel(condition.field)}
              </div>

              <ConditionValueInput
                condition={condition}
                serverOptions={serverOptions}
                statusCodeOptions={statusCodeOptions}
                userOptions={userOptions}
                onChange={(patch) => updateRequiredCondition(condition.id, patch)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Additional Conditions</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Structured fields are unique. Text can be added multiple times.
        </span>
      </div>

      {conditions.map((condition, idx) => {
        const rowFieldOptions = availableFieldOptions.filter(
          (option) => option.value === condition.field || isReusableField(option.value) || !usedFields.includes(option.value),
        );

        return (
          <div key={condition.id}>
            {idx > 0 && (
              <div className="flex items-center py-0.5 pl-1">
                <button
                  type="button"
                  onClick={() => updateCondition(condition.id, { logic: condition.logic === 'and' ? 'or' : 'and' })}
                  className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/80 text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors select-none"
                  title="Toggle AND / OR for this condition"
                >
                  {condition.logic.toUpperCase()}
                </button>
              </div>
            )}

            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterFieldSelect
                value={condition.field}
                options={rowFieldOptions}
                onChange={(field) => changeField(condition.id, field)}
              />

              <ConditionValueInput
                condition={condition}
                serverOptions={serverOptions}
                statusCodeOptions={statusCodeOptions}
                userOptions={userOptions}
                onChange={(patch) => updateCondition(condition.id, patch)}
              />

              <button
                type="button"
                onClick={() => removeCondition(condition.id)}
                title={`Remove ${fieldLabel(condition.field)}`}
                className="p-1.5 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}

      {remainingFields.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...conditions, createEmptyFilterCondition()])}
          className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add condition
        </button>
      )}
    </div>
  );
}

// ─── Highlight matching text ──────────────────────────────────────────────────

export function Hl({ text, terms }: { text: string; terms: string[] }) {
  const active = terms.filter(t => t.trim());
  if (!active.length) return <>{text}</>;
  const escaped = active.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);
  const lowers = active.map(t => t.toLowerCase());
  return (
    <>
      {parts.map((part, i) =>
        lowers.includes(part.toLowerCase())
          ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded-sm px-0">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

// ─── Client-side row match (visible fields only) ──────────────────────────────
// Used for highlight/dim during debounce window.
// Conditions with body/header scopes are treated as "unknown" → assume match.

// Client-side row match used by Highlight mode (visible fields only).
// In Filter mode the server already did the filtering — this is only for dimming.
export function rowMatchesSearch(
  c: ConnectionSummary,
  conditions: SearchCondition[],
  logic: 'and' | 'or',
): boolean {
  const active = conditions.filter(cond => cond.term.trim());
  if (!active.length) return true;

  const checkCond = (cond: SearchCondition): boolean => {
    const t = cond.term.trim().toLowerCase();
    const scopes = cond.scopes;

    // Scopes that have no visible column → can't check, assume match (no dimming)
    if (scopes.length > 0 && scopes.every(s => s !== 'url')) return true;

    // All fields (empty) or URL included: check all visible row fields
    if (c.req_url.toLowerCase().includes(t)) return true;
    if (scopes.length === 0) {
      // Also check other columns visible in the row
      if ((c.server_name ?? '').toLowerCase().includes(t)) return true;
      if (c.req_method.toLowerCase().includes(t)) return true;
      if (String(c.user_id ?? '').includes(t)) return true;
      if (String(c.res_status_code ?? '').includes(t)) return true;
    }
    return false;
  };

  if (logic === 'or') return active.some(checkCond);
  return active.every(checkCond);
}
