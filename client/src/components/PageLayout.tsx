import { type ReactNode } from 'react';
import { cn } from '../lib/utils';

type PageWidth = 'default' | 'narrow' | 'wide' | 'full';

const WIDTH_CLASS: Record<PageWidth, string> = {
  default: 'max-w-7xl',
  narrow: 'max-w-3xl',
  wide: 'max-w-none',
  full: 'max-w-none',
};

export function PageShell({
  children,
  width = 'default',
  className,
}: {
  children: ReactNode;
  width?: PageWidth;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full space-y-6', WIDTH_CLASS[width], className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{title}</h1>
        {description ? (
          <p className="max-w-3xl text-sm text-gray-500 dark:text-gray-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
    </div>
  );
}
