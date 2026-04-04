import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { tryRestoreSession } from '../lib/api';

export function ProtectedRoute() {
  const { accessToken } = useAuthStore();
  const [checking, setChecking] = useState(!accessToken);

  useEffect(() => {
    if (accessToken) return;
    tryRestoreSession().finally(() => setChecking(false));
  }, [accessToken]);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!useAuthStore.getState().accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
