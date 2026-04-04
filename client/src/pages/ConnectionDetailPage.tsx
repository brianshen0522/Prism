import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { fetchConnection } from '../lib/api';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { methodColor } from '../lib/utils';
import { ConnectionDetailContent, ConnectionDetailSkeleton } from '../components/ConnectionDetail';

export function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: c, isLoading, error } = useQuery({
    queryKey: ['connection', id],
    queryFn: () => fetchConnection(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl space-y-4">
        <ConnectionDetailSkeleton />
      </div>
    );
  }

  if (error || !c) {
    return (
      <div className="max-w-4xl">
        <p className="text-red-600">{(error as Error)?.message ?? 'Not found'}</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={methodColor(c.req_method)}>{c.req_method}</Badge>
          <span className="font-mono text-sm text-gray-700 dark:text-gray-300 break-all">{c.req_url}</span>
        </div>
      </div>
      <ConnectionDetailContent c={c} />
    </div>
  );
}
