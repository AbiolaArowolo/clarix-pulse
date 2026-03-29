import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { disconnectHubSocket } from '../../lib/socket';

interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
  isPlatformAdmin?: boolean;
}

interface AuthImpersonation {
  active: boolean;
  impersonatorUserId?: string | null;
  impersonatorEmail?: string | null;
  startedAt?: string | null;
}

interface AuthTenant {
  tenantId: string;
  name: string;
  slug: string;
  enrollmentKey: string;
  defaultAlertEmail: string | null;
  enabled?: boolean;
  disabledReason?: string | null;
  accessKeyHint?: string | null;
  accessKeyExpiresAt?: string | null;
}

interface AuthSessionState {
  authenticated: boolean;
  user: AuthUser | null;
  tenant: AuthTenant | null;
  expiresAt: string | null;
  impersonation: AuthImpersonation | null;
}

interface AuthContextValue extends AuthSessionState {
  bootstrapped: boolean;
  loading: boolean;
  error: string | null;
  notice: string | null;
  registration: {
    companyName?: string;
    email?: string;
    accessKey?: string | null;
    accessKeyHint?: string | null;
    accessKeyExpiresAt?: string | null;
    pendingActivation?: boolean;
    emailSent?: boolean;
  } | null;
  refreshSession: () => Promise<void>;
  login: (input: { email: string; password: string; accessKey: string }) => Promise<boolean>;
  register: (input: {
    companyName: string;
    displayName: string;
    email: string;
    password: string;
  }) => Promise<boolean>;
  requestPasswordReset: (email: string) => Promise<boolean>;
  resetPassword: (input: { token: string; password: string }) => Promise<boolean>;
  stopImpersonation: () => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

interface SessionPayload {
  authenticated?: boolean;
  user?: AuthUser;
  tenant?: AuthTenant;
  registration?: {
    companyName?: string;
    email?: string;
    accessKey?: string | null;
    accessKeyHint?: string | null;
    accessKeyExpiresAt?: string | null;
    pendingActivation?: boolean;
    emailSent?: boolean;
  };
  session?: {
    expiresAt?: string;
  };
  impersonation?: AuthImpersonation;
  notice?: string;
  registered?: boolean;
  error?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY_STATE: AuthSessionState = {
  authenticated: false,
  user: null,
  tenant: null,
  expiresAt: null,
  impersonation: null,
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

function sessionFromPayload(payload: SessionPayload): AuthSessionState {
  return {
    authenticated: Boolean(payload.authenticated && payload.user && payload.tenant),
    user: payload.user ?? null,
    tenant: payload.tenant ?? null,
    expiresAt: payload.session?.expiresAt ?? null,
    impersonation: payload.impersonation ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registration, setRegistration] = useState<AuthContextValue['registration']>(null);
  const [session, setSession] = useState<AuthSessionState>(EMPTY_STATE);

  const refreshSession = async () => {
    try {
      const response = await fetch('/api/auth/session');
      const payload = await readJsonResponse<SessionPayload>(response);
      setSession(sessionFromPayload(payload));
      setError(null);
      setNotice(payload.notice ?? null);
      setRegistration(null);
    } catch (err) {
      setSession(EMPTY_STATE);
      setError(err instanceof Error ? err.message : 'Failed to load session.');
      setNotice(null);
      setRegistration(null);
    } finally {
      setBootstrapped(true);
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const submit = async (url: string, body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = await readJsonResponse<SessionPayload>(response);
      if (!response.ok) {
        throw new Error(String(payload.error ?? 'Request failed.'));
      }

      setSession(sessionFromPayload(payload));
      setNotice(payload.notice ?? null);
      setRegistration(payload.registration ?? null);
      return true;
    } catch (err) {
      setSession(EMPTY_STATE);
      setError(err instanceof Error ? err.message : 'Request failed.');
      setNotice(null);
      if (url !== '/api/auth/login') {
        setRegistration(null);
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  const value = useMemo<AuthContextValue>(() => ({
    ...session,
    bootstrapped,
    loading,
    error,
    notice,
    registration,
    refreshSession,
    login: async ({ email, password, accessKey }) => {
      const ok = await submit('/api/auth/login', { email, password, accessKey });
      if (ok) {
        setRegistration(null);
      }
      return ok;
    },
    register: async ({ companyName, displayName, email, password }) => (
      submit('/api/auth/register', { companyName, displayName, email, password })
    ),
    requestPasswordReset: async (email) => (
      submit('/api/auth/forgot-password', { email })
    ),
    resetPassword: async ({ token, password }) => (
      submit('/api/auth/reset-password', { token, password })
    ),
    stopImpersonation: async () => {
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch('/api/auth/impersonation/stop', {
          method: 'POST',
        });
        const payload = await readJsonResponse<SessionPayload>(response);
        if (!response.ok) {
          throw new Error(String(payload.error ?? 'Failed to stop impersonation.'));
        }
        disconnectHubSocket();
        await refreshSession();
        setNotice(payload.notice ?? 'Returned to the admin workspace.');
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to stop impersonation.');
        return false;
      } finally {
        setLoading(false);
      }
    },
    logout: async () => {
      setLoading(true);
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
        });
      } finally {
        disconnectHubSocket();
        setSession(EMPTY_STATE);
        setNotice(null);
        setRegistration(null);
        setLoading(false);
      }
    },
    clearError: () => setError(null),
  }), [bootstrapped, error, loading, notice, registration, session]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
