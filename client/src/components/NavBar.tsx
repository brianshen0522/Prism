import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, KeyRound, List, LayoutDashboard, Globe, Server, Settings, Menu, X, BookOpen, Sun, Moon, Monitor } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { useThemeStore, type Theme } from '../store/theme';
import { logout } from '../lib/api';
import { cn } from '../lib/utils';

const THEME_CYCLE: Theme[] = ['system', 'light', 'dark'];
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const;

const adminLinks = [
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function NavBar() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const role = user?.role;
  const isAdmin = role === 'admin';
  const isMonitor = role === 'admin' || role === 'monitor';
  const isOAuth2 = role === 'oauth2';

  const { theme, setTheme } = useThemeStore();
  const ThemeIcon = THEME_ICON[theme];
  const cycleTheme = () => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length]);

  const links = [
    ...(isMonitor
      ? [
          { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { to: '/traffic', label: 'Global Traffic', icon: Globe },
        ]
      : isOAuth2
        ? [{ to: '/traffic', label: 'Global Traffic', icon: Globe }]
        : [{ to: '/connections', label: 'My Connections', icon: List }]),
    { to: '/token', label: 'My Token', icon: KeyRound },
    { to: '/guide', label: 'Integration Guide', icon: BookOpen },
    ...(isAdmin ? adminLinks : []),
  ];

  const handleLogout = async () => {
    await logout().catch(() => {});
    navigate('/login');
  };

  return (
    <>
      <nav className="h-14 border-b border-gray-200 bg-white flex items-center px-4 md:px-6 gap-4 shrink-0 dark:border-gray-700 dark:bg-gray-900">
        <Link to="/" className="font-bold text-blue-600 text-lg tracking-tight mr-1 shrink-0">
          Prism
        </Link>

        <div className="hidden md:flex items-center gap-6 min-w-0">
          {links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-1.5 text-sm font-medium transition-colors whitespace-nowrap',
                pathname.startsWith(to)
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </div>

        <div className="ml-auto hidden md:flex items-center gap-4">
          {user && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">{user.username}</span>
              {' · '}
              <span className="capitalize">{user.role}</span>
            </span>
          )}
          <button
            type="button"
            onClick={cycleTheme}
            title={`Theme: ${THEME_LABEL[theme]} (click to cycle)`}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:text-gray-100"
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:text-gray-100"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="ml-auto inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 md:hidden dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          <Menu className="h-5 w-5" />
        </button>
      </nav>

      <div
        className={cn(
          'fixed inset-0 z-50 md:hidden transition-opacity duration-200',
          mobileOpen ? 'pointer-events-auto bg-black/40 opacity-100' : 'pointer-events-none bg-black/0 opacity-0',
        )}
        onClick={() => setMobileOpen(false)}
      >
        <div
          className={cn(
            'absolute left-0 top-0 h-full w-[min(22rem,86vw)] bg-white shadow-2xl transition-transform duration-200 dark:bg-gray-900',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-gray-700">
            <div>
              <p className="text-lg font-semibold text-blue-600">Prism</p>
              {user && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {user.username} · <span className="capitalize">{user.role}</span>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-3 py-3 space-y-1">
            {links.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors',
                  pathname.startsWith(to)
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </div>

          <div className="absolute inset-x-0 bottom-0 border-t border-gray-200 p-3 space-y-2 dark:border-gray-700">
            <button
              type="button"
              onClick={cycleTheme}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <ThemeIcon className="h-4 w-4" />
              {THEME_LABEL[theme]} theme
            </button>
            <button
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
