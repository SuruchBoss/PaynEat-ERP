// Adapted from Cwork (web/src/stores/auth.store.ts), see NOTICE. Without Cwork's device
// fields, and with enrolment steps: activation mid-sign-in returns the session together
// with the recovery codes, and the sign-in page adopts it once the codes are shown.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AuthTokens,
  LoginResponse,
  LoginSession,
  MfaActivation,
  MfaChallenge,
  MfaEnrolmentOffer,
  SessionUser,
} from '@/features/auth/auth.types';
import { api } from '@/lib/api-client';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  /** True until a persisted session has been revalidated with the API. */
  isBootstrapping: boolean;

  /** A challenge when the account owes a second factor; null once a session exists. */
  login: (email: string, password: string) => Promise<MfaChallenge | null>;
  verifyMfa: (challengeToken: string, code: string) => Promise<void>;
  beginEnrolment: (challengeToken: string) => Promise<MfaEnrolmentOffer>;
  activateEnrolment: (challengeToken: string, code: string) => Promise<MfaActivation>;
  adoptSession: (session: LoginSession) => void;
  logout: () => Promise<void>;
  setTokens: (tokens: AuthTokens) => void;
  clearSession: () => void;
  bootstrap: () => Promise<void>;
  can: (...permissions: string[]) => boolean;
}

/** Where the session is kept on this browser. */
export const SESSION_STORAGE_KEY = 'payneat-erp.session';

const SIGNED_OUT = { accessToken: null, refreshToken: null, user: null } as const;

/**
 * Session state only: the credentials and the identity they belong to. Everything else
 * that comes from the server lives in TanStack Query. (Cwork.)
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...SIGNED_OUT,
      isBootstrapping: true,

      async login(email, password) {
        const result = await api.post<LoginResponse>(
          '/auth/login',
          { email, password },
          { anonymous: true },
        );
        if (result.mfaRequired) return result; // a challenge is not a session
        get().adoptSession(result);
        return null;
      },

      async verifyMfa(challengeToken, code) {
        const session = await api.post<LoginSession>(
          '/auth/mfa/verify',
          { challengeToken, code },
          { anonymous: true },
        );
        get().adoptSession(session);
      },

      beginEnrolment(challengeToken) {
        return api.post<MfaEnrolmentOffer>(
          '/auth/mfa/enroll',
          { challengeToken },
          { anonymous: true },
        );
      },

      activateEnrolment(challengeToken, code) {
        return api.post<MfaActivation>(
          '/auth/mfa/activate',
          { challengeToken, code },
          { anonymous: true },
        );
      },

      adoptSession(session) {
        set({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          user: session.user,
          isBootstrapping: false,
        });
      },

      async logout() {
        const refreshToken = get().refreshToken;
        try {
          if (refreshToken) await api.post('/auth/logout', { refreshToken });
        } catch {
          // Signing out here must succeed even when the API cannot be reached.
        }
        set({ ...SIGNED_OUT, isBootstrapping: false });
      },

      setTokens(tokens) {
        set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
      },

      clearSession() {
        set({ ...SIGNED_OUT, isBootstrapping: false });
      },

      /**
       * Revalidates a persisted session once, on load: a token in storage proves nothing,
       * so the API is asked who we are before the console renders. (Cwork.)
       */
      async bootstrap() {
        if (!get().isBootstrapping) return;
        if (!get().accessToken) {
          set({ isBootstrapping: false });
          return;
        }
        try {
          const user = await api.get<SessionUser>('/auth/me');
          set({ user });
        } catch {
          set({ ...SIGNED_OUT });
        } finally {
          set({ isBootstrapping: false });
        }
      },

      can(...permissions) {
        const held = get().user?.permissions ?? [];
        return permissions.every((p) => held.includes(p));
      },
    }),
    {
      name: SESSION_STORAGE_KEY,
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    },
  ),
);

// Wire the HTTP client to the store once, at module load. (Cwork.)
api.configure({
  getAccessToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokensRefreshed: (tokens) => useAuthStore.getState().setTokens(tokens),
  onSessionExpired: () => useAuthStore.getState().clearSession(),
});
