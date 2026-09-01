import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';
import { disconnectHubSocket } from '../../lib/socket';

// LEARN: Clerk is now the ONLY thing that proves "who is this person" -
// it owns the session cookie, password checks, and sign-in/sign-up UI.
// Pulse's own Postgres tables still own "what can this person do" - tenant,
// role, isPlatformAdmin, impersonation. This provider bridges the two: it
// watches Clerk's sign-in state (via useClerkAuth below) and, once Clerk
// says someone is signed in, asks the Pulse backend "who is this, in Pulse
// terms?" via GET /api/auth/session. The backend verifies the same Clerk
// session cookie server-side (clerkMiddleware + getAuth(req)) and looks up
// the matching Pulse user by clerk_user_id - see the DESIGN note in the
// migration for the full account-linking flow. There is no password,
// access-key, or reset-token concept on the frontend any more.
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
  refreshSession: () => Promise<void>;
  // The one self-service step left post-Clerk: someone who already proved
  // their identity via Clerk (isSignedIn=true) but has no Pulse tenant yet
  // spins up a brand-new company workspace with just these two fields - see
  // POST /api/auth/register on the backend. Adding a user to an *existing*
  // tenant is still admin-only; there is no invite flow here.
  register: (input: { companyName: string; displayName: string }) => Promise<boolean>;
  stopImpersonation: () => Promise<boolean>;
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
  impersonation?: AuthImpersonation;
  notice?: string;
  error?: string;
  registered?: boolean;
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
  const clerkAuth = useClerkAuth();
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSessionState>(EMPTY_STATE);

  const refreshSession = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/session');
      const payload = await readJsonResponse<SessionPayload>(response);

      // A non-2xx here (other than a plain "not signed in") usually means
      // Clerk considers this person signed in but Pulse can't find or link
      // a matching tenant user for them yet - surface that message instead
      // of a generic failure so the UI can explain the account-linking gap.
      if (!response.ok && response.status !== 401) {
        throw new Error(String(payload.error ?? 'Failed to load session.'));
      }

      setSession(sessionFromPayload(payload));
      setError(response.ok ? null : String(payload.error ?? 'Failed to load session.'));
      setNotice(payload.notice ?? null);
    } catch (err) {
      setSession(EMPTY_STATE);
      setError(err instanceof Error ? err.message : 'Failed to load session.');
      setNotice(null);
    } finally {
      setBootstrapped(true);
      setLoading(false);
    }
  };

  // Drive the Pulse-side session fetch off Clerk's own load/sign-in state
  // rather than a plain mount effect - re-runs automatically the moment
  // Clerk finishes its own sign-in or sign-out (SignIn widget, SignUp
  // widget, or the logout() call below all change clerkAuth.isSignedIn).
  useEffect(() => {
    if (!clerkAuth.isLoaded) {
      return;
    }

    if (clerkAuth.isSignedIn) {
      void refreshSession();
      return;
    }

    setSession(EMPTY_STATE);
    setError(null);
    setNotice(null);
    setBootstrapped(true);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkAuth.isLoaded, clerkAuth.isSignedIn]);

  const value = useMemo<AuthContextValue>(() => ({
    ...session,
    bootstrapped,
    loading,
    error,
    notice,
    refreshSession,
    register: async ({ companyName, displayName }) => {
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyName, displayName }),
        });
        const payload = await readJsonResponse<SessionPayload>(response);
        if (!response.ok || !payload.registered) {
          throw new Error(String(payload.error ?? 'Failed to create the workspace.'));
        }

        // The register response only confirms creation - it does not carry
        // the new session/tenant, so pull that with a normal session fetch.
        await refreshSession();
        setNotice(payload.notice ?? 'Workspace created.');
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create the workspace.');
        return false;
      } finally {
        setLoading(false);
      }
    },
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
        // POST /api/auth/logout still does real work post-Clerk: it clears
        // any active impersonation overlay and best-effort revokes the
        // Clerk session server-side. Clerk's own signOut() is still what
        // clears the actual browser-side identity cookie - Pulse never owned
        // that cookie and has no way to clear it directly.
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        await clerkAuth.signOut();
      } finally {
        disconnectHubSocket();
        setSession(EMPTY_STATE);
        setNotice(null);
        setError(null);
        setLoading(false);
      }
    },
    clearError: () => setError(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [bootstrapped, error, loading, notice, session]);

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
