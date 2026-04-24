import { type ReactNode } from 'react';

export function ViewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-950">
      <div className="flex h-12 shrink-0 items-center border-b border-gray-200 bg-white px-6 dark:border-gray-700 dark:bg-gray-900">
        <span className="text-lg font-bold text-blue-600">Prism</span>
        <span className="ml-3 text-xs text-gray-400 dark:text-gray-500">Read-only view</span>
      </div>
      <main className="flex-1 w-full px-4 py-6 xl:px-6 2xl:px-8">
        {children}
      </main>
    </div>
  );
}
