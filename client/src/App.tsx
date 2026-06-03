import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuthStore } from './store/auth';
import { LoginPage } from './pages/LoginPage';
import { TokenPage } from './pages/TokenPage';
import { ConnectionViewPage } from './pages/ConnectionViewPage';
import { OAuthPipelineViewPage } from './pages/OAuthPipelineViewPage';
import { IntegrationGuidePage } from './pages/IntegrationGuidePage';
import { IntegrationGuideDetailPage } from './pages/IntegrationGuideDetailPage';
import { ConnectionDetailPage } from './pages/ConnectionDetailPage';
import { DashboardPage } from './pages/DashboardPage';
import { TrafficPage } from './pages/TrafficPage';
import { OAuthPipelineDetailPage } from './pages/OAuthPipelineDetailPage';
import { ServersPage } from './pages/ServersPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';

function AdminOnlyRoute({ children }: { children: ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
}

function NonUserRoute({ children }: { children: ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'user') {
    return <Navigate to="/guide" replace />;
  }
  return children;
}

function DefaultRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'admin') {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/guide" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/view/c/:shareToken" element={<ConnectionViewPage />} />
      <Route path="/view/op/:shareToken" element={<OAuthPipelineViewPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<DefaultRedirect />} />
          <Route path="/connections" element={<Navigate to="/traffic" replace />} />
          <Route path="/guide" element={<IntegrationGuidePage />} />
          <Route path="/guide/:id" element={<IntegrationGuideDetailPage />} />
          <Route path="/connections/:id" element={<ConnectionDetailPage />} />
          <Route path="/token" element={<TokenPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/traffic" element={<NonUserRoute><TrafficPage /></NonUserRoute>} />
          <Route path="/oauth/pipelines/:id" element={<OAuthPipelineDetailPage />} />
          <Route path="/users" element={<AdminOnlyRoute><UsersPage /></AdminOnlyRoute>} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<DefaultRedirect />} />
    </Routes>
  );
}
