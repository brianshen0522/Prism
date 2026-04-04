import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuthStore } from './store/auth';
import { LoginPage } from './pages/LoginPage';
import { TokenPage } from './pages/TokenPage';
import { MyConnectionsPage } from './pages/MyConnectionsPage';
import { ConnectionDetailPage } from './pages/ConnectionDetailPage';
import { DashboardPage } from './pages/DashboardPage';
import { GlobalTrafficPage } from './pages/GlobalTrafficPage';
import { ServersPage } from './pages/ServersPage';
import { SettingsPage } from './pages/SettingsPage';

function DefaultRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  const isPrivileged = role === 'admin' || role === 'monitor';
  return <Navigate to={isPrivileged ? '/traffic' : '/connections'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<DefaultRedirect />} />
          <Route path="/connections" element={<MyConnectionsPage />} />
          <Route path="/connections/:id" element={<ConnectionDetailPage />} />
          <Route path="/token" element={<TokenPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/traffic" element={<GlobalTrafficPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<DefaultRedirect />} />
    </Routes>
  );
}
