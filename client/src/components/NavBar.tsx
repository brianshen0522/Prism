import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, KeyRound, List, LayoutDashboard, Globe, Server, Settings } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { logout } from '../lib/api';
import { cn } from '../lib/utils';

const monitorLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/traffic', label: 'Global Traffic', icon: Globe },
];

const adminLinks = [
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function NavBar() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isPrivileged = user?.role === 'admin' || user?.role === 'monitor' || user?.role === 'oauth2';
  const isAdmin = user?.role === 'admin';

  const links = [
    ...(isPrivileged ? monitorLinks : [{ to: '/connections', label: 'My Connections', icon: List }]),
    { to: '/token', label: 'My Token', icon: KeyRound },
    ...(isAdmin ? adminLinks : []),
  ];

  const handleLogout = async () => {
    await logout().catch(() => {});
    navigate('/login');
  };

  return (
    <nav className="h-14 border-b border-gray-200 bg-white flex items-center px-6 gap-6 shrink-0 dark:border-gray-700 dark:bg-gray-900">
      {/* Brand */}
      <Link to="/" className="font-bold text-blue-600 text-lg tracking-tight mr-2">
        Prism
      </Link>

      {/* Nav links */}
      {links.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className={cn(
            'flex items-center gap-1.5 text-sm font-medium transition-colors',
            pathname.startsWith(to)
              ? 'text-blue-600'
              : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}

      <div className="ml-auto flex items-center gap-4">
        {user && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-300">{user.username}</span>
            {' · '}
            <span className="capitalize">{user.role}</span>
          </span>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:text-gray-100"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </nav>
  );
}
