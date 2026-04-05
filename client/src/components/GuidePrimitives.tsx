import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export type GuideKind = 'oauth-pair' | 'direct-server';

export function guideRoleBadgeClass(kind: GuideKind) {
  return kind === 'oauth-pair'
    ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
    : 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200';
}

export function guideIconSurfaceClass(kind: GuideKind) {
  return kind === 'oauth-pair'
    ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
    : 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200';
}

export const guideSurfaceClass =
  'border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900';

export const guideMutedSurfaceClass =
  'border-gray-200 bg-slate-50 dark:border-gray-700 dark:bg-slate-950/30';

export const guideInsetSurfaceClass =
  'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900';

export function GuideInfoPanel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border p-4', guideMutedSurfaceClass, className)}>
      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
