import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchPublicConnection } from '../lib/api';
import { Badge } from '../components/ui/badge';
import { PageHeader, PageShell } from '../components/PageLayout';
import { ViewLayout } from '../components/ViewLayout';
import { ConnectionDetailContent, ConnectionDetailSkeleton } from '../components/ConnectionDetail';
import { methodColor } from '../lib/utils';

export function ConnectionViewPage() {
  const { shareToken = '' } = useParams();
  const { data: c, isLoading, error } = useQuery({
    queryKey: ['public-connection', shareToken],
    queryFn: () => fetchPublicConnection(shareToken),
    enabled: !!shareToken,
    retry: false,
  });

  return (
    <ViewLayout>
      <PageShell>
        {isLoading ? (
          <ConnectionDetailSkeleton />
        ) : error || !c ? (
          <div className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">
            Connection not found or this share link has expired.
          </div>
        ) : (
          <>
            <PageHeader
              title="Connection Detail"
              description={(
                <span className="flex items-center gap-2 flex-wrap">
                  <Badge className={methodColor(c.req_method)}>{c.req_method}</Badge>
                  <span className="font-mono text-sm text-gray-700 dark:text-gray-300 break-all">{c.req_url}</span>
                </span>
              )}
            />
            <ConnectionDetailContent c={c} />
          </>
        )}
      </PageShell>
    </ViewLayout>
  );
}
