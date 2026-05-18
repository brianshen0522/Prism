import { ExternalLink, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchConnection, type ConnectionDetail } from '../lib/api';
import { Card, CardContent } from './ui/card';
import { ConnectionDetailContent, ConnectionDetailSkeleton } from './ConnectionDetail';
import { cn } from '../lib/utils';

export function ConnectionInspectPanel({
  id,
  onClose,
  title = 'Connection Inspect',
  description = 'Inspect the raw request and response for the selected connection.',
  fetchFn,
  getExternalHref,
}: {
  id: string | null;
  onClose: () => void;
  title?: string;
  description?: string;
  fetchFn?: (id: string) => Promise<ConnectionDetail>;
  getExternalHref?: (id: string) => string | null;
}) {
  const fetch = fetchFn ?? fetchConnection;
  const externalHref = id ? (getExternalHref ? getExternalHref(id) : `${import.meta.env.BASE_URL}connections/${id}`) : null;

  const { data: connection, isLoading } = useQuery({
    queryKey: ['connection', fetchFn ? 'public' : 'auth', id],
    queryFn: () => fetch(id!),
    enabled: !!id,
  });

  return (
    <>
      <div
        className={cn(
          'min-w-0 hidden xl:block overflow-hidden self-start transition-[width,opacity,margin] duration-300 ease-out',
          id ? 'sticky top-4 h-[calc(100vh-2rem)] w-[max(33vw,520px)] max-w-[720px] opacity-100 ml-2' : 'w-0 opacity-0 ml-0 pointer-events-none',
        )}
      >
        <Card className={cn(
          'flex h-full flex-col overflow-hidden transition-transform duration-300 ease-out',
          id ? 'translate-x-0' : 'translate-x-6',
        )}>
          <CardContent className="flex flex-col p-0 h-full min-h-0">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
              </div>
              <div className="flex items-center gap-1">
                {externalHref && (
                  <a
                    href={externalHref}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    title="Open in new tab"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {id && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            {!id ? (
              <div className="px-4 py-16 text-center text-sm text-gray-400 dark:text-gray-500">
                No connection selected
              </div>
            ) : isLoading ? (
              <div className="flex-1 overflow-auto p-4">
                <ConnectionDetailSkeleton />
              </div>
            ) : connection ? (
              <div className="flex-1 overflow-auto p-4">
                <ConnectionDetailContent c={connection} />
              </div>
            ) : (
              <div className="px-4 py-16 text-center text-sm text-gray-400 dark:text-gray-500">
                Connection not found
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div
        className={cn(
          'xl:hidden fixed inset-0 z-50 transition-opacity duration-300',
          id ? 'pointer-events-auto bg-black/40 opacity-100' : 'pointer-events-none bg-black/0 opacity-0',
        )}
        onClick={onClose}
      >
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl transition-transform duration-300 ease-out dark:bg-gray-950',
            id ? 'translate-y-0' : 'translate-y-full',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[calc(85vh-4rem)] overflow-auto p-4">
            {!id ? (
              <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">No connection selected</div>
            ) : isLoading ? (
              <ConnectionDetailSkeleton />
            ) : connection ? (
              <ConnectionDetailContent c={connection} />
            ) : (
              <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">Connection not found</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
