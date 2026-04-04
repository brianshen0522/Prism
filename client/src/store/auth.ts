import { create } from 'zustand';

export interface AuthUser {
  sub: number;
  username: string;
  role: 'admin' | 'monitor' | 'oauth2' | 'user';
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  clearAuth: () => set({ accessToken: null, user: null }),
}));

// Refresh token is persisted across page loads
export const REFRESH_TOKEN_KEY = 'prism_refresh_token';
