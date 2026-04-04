import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

function getPages(page: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const left  = Math.max(2, page - 1);
  const right = Math.min(total - 1, page + 1);
  const items: (number | '...')[] = [1];

  if (left > 2)       items.push('...');
  for (let i = left; i <= right; i++) items.push(i);
  if (right < total - 1) items.push('...');
  items.push(total);

  return items;
}

const BASE = 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:pointer-events-none disabled:opacity-40 h-8';
const NAV  = `${BASE} w-8 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700`;
const NUM  = `${BASE} w-8`;
const ACTIVE = `${NUM} bg-blue-600 text-white shadow-sm`;
const INACTIVE = `${NUM} border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700`;

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages = getPages(page, totalPages);

  return (
    <div className="flex items-center gap-1">
      <button className={NAV} disabled={page <= 1} onClick={() => onPage(1)} title="First page">
        <ChevronsLeft className="h-3.5 w-3.5" />
      </button>
      <button className={NAV} disabled={page <= 1} onClick={() => onPage(page - 1)} title="Previous page">
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} className="w-8 text-center text-sm text-gray-400 dark:text-gray-500 select-none">
            …
          </span>
        ) : (
          <button
            key={p}
            className={p === page ? ACTIVE : INACTIVE}
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ),
      )}

      <button className={NAV} disabled={page >= totalPages} onClick={() => onPage(page + 1)} title="Next page">
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <button className={NAV} disabled={page >= totalPages} onClick={() => onPage(totalPages)} title="Last page">
        <ChevronsRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
