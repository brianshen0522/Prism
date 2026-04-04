import { Outlet } from 'react-router-dom';
import { NavBar } from './NavBar';

export function Layout() {
  return (
    <div className="flex flex-col min-h-screen">
      <NavBar />
      <main className="flex-1 container mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
