import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { disconnectHubSocket } from '../../lib/socket';

interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
}

interface AuthTenant {
  tenantId: string;
  name: string;
  slug: string;
  enrollmentKey: string;
  defaultAlertEmail: string | null;
}

interface AuthSessionState {
  authenticated: boolean;
  user: AuthUser | null;
  tenant: AuthTenant | null;
  expiresAt: string | null;
}

interface AuthContextValue extends AuthSessionState {
  loading: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<boolean>;
  register: (input: {
    companyName: string;
    displayName: string;
    email: string;
    password: string;
  }) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

interface SessionPayload {
  authenticated?: boolean;
  user?: AuthUser;
  tenant?: AuthTenant;
  session?: {
    expiresAt?: string;
  };
  error?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY_STATE: AuthSessionState = {
  authenticated: false,
  user: null,
  tenant: null,
  expiresAt: null,
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
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSessionState>(EMPTY_STATE);

  const refreshSession = async () => {
    try {
      const response = await fetch('/api/auth/session');
      const payload = await readJsonResponse<SessionPayload>(response);
      setSession(sessionFromPayload(payload));
      setError(null);
    } catch (err) {
      setSession(EMPTY_STATE);
      setError(err instanceof Error ? err.message : 'Failed to load session.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const submit = async (url: string, body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);

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
      return true;
    } catch (err) {
      setSession(EMPTY_STATE);
      setError(err instanceof Error ? err.message : 'Request failed.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const value = useMemo<AuthContextValue>(() => ({
    ...session,
    loading,
    error,
    refreshSession,
    login: async ({ email, password }) => submit('/api/auth/login', { email, password }),
    register: async ({ companyName, displayName, email, password }) => (
      submit('/api/auth/register', { companyName, displayName, email, password })
    ),
    logout: async () => {
      setLoading(true);
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
        });
      } finally {
        disconnectHubSocket();
        setSession(EMPTY_STATE);
        setLoading(false);
      }
    },
    clearError: () => setError(null),
  }), [error, loading, session]);

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
