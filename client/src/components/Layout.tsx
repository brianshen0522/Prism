import { Outlet, useLocation } from 'react-router-dom';
import { NavBar } from './NavBar';
import { cn } from '../lib/utils';

export function Layout() {
  const location = useLocation();
  const isFullWidth = /^\/oauth\/pipelines\/[^/]+$/.test(location.pathname)
    || location.pathname === '/traffic';

  return (
    <div className="flex flex-col min-h-screen">
      <NavBar />
      <main className={cn(
        'flex-1 w-full mx-auto py-6 px-4 xl:px-6 2xl:px-8',
        isFullWidth ? 'max-w-none' : 'max-w-screen-2xl',
      )}>
        <Outlet />
      </main>
    </div>
  );
}
