import { create } from 'zustand';

export interface AuthUser {
  sub: number;
  username: string;
  role: 'admin' | 'monitor' | 'oauth2' | 'user';
  institutionId: number;
  institutionName: string;
  institutionKeyword: string | null;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  participantTokenStale: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  markParticipantTokenStale: () => void;
  clearParticipantTokenStale: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  participantTokenStale: false,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  clearAuth: () => set({ accessToken: null, user: null, participantTokenStale: false }),
  markParticipantTokenStale: () => set({ participantTokenStale: true }),
  clearParticipantTokenStale: () => set({ participantTokenStale: false }),
}));

// Refresh token is persisted across page loads
export const REFRESH_TOKEN_KEY = 'prism_refresh_token';
