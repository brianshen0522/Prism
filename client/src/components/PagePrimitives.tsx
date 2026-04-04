import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { cn } from '../lib/utils';

export function FilterCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('border-gray-200/80 bg-white/90 dark:border-gray-700 dark:bg-gray-900/70', className)}>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

export function TableCard({
  children,
  title,
  description,
  className,
}: {
  children: ReactNode;
  title?: string;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden border-gray-200/80 bg-white/95 shadow-sm dark:border-gray-700 dark:bg-gray-900/80', className)}>
      {title ? (
        <CardHeader className="bg-gray-50/70 dark:bg-gray-800/60">
          <CardTitle>{title}</CardTitle>
          {description ? <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p> : null}
        </CardHeader>
      ) : null}
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('py-16 text-center', className)}>
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
      {description ? <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">{description}</p> : null}
    </div>
  );
}

export function TableScroller({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('overflow-x-auto', className)}>{children}</div>;
}

export function MobileSheet({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-200 md:hidden',
        open ? 'pointer-events-auto bg-black/40 opacity-100' : 'pointer-events-none bg-black/0 opacity-0',
      )}
      onClick={onClose}
    >
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl transition-transform duration-200 dark:bg-gray-950',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
            {description ? <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p> : null}
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
          {children}
        </div>
      </div>
    </div>
  );
}
