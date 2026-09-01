import { NextFunction, Request, Response } from 'express';
import { clerkClient, clerkMiddleware, getAuth, type User as ClerkUser } from '@clerk/express';
import {
  AuthenticatedSession,
  buildSessionForUserId,
  deleteImpersonationSession,
  getIdentitySessionForClerkUser,
  getImpersonationSessionFromToken,
  resolveUserIdByEmail,
} from './store/auth';

// Re-exported so index.ts only needs to import from one place for the auth
// wiring (`app.use(clerkMiddleware())` must run before any route that calls
// getSessionFromRequest/getAuth).
export { clerkMiddleware };

// LEARN: two different cookies, two different owners.
// Clerk owns its own session cookie (name/shape are Clerk's implementation
// detail -- we never read or write it directly, clerkMiddleware() handles
// it). The ONLY cookie Pulse still mints itself is this one, and it carries
// nothing about identity -- just "which impersonation session, if any, is
// currently overlaid on top of whichever Clerk identity is signed in".
export const IMPERSONATION_COOKIE_NAME = 'clarix_pulse_impersonation';

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

// --- Temporary login bypass -------------------------------------------------
// Off by default everywhere, including production. Only activates when BOTH
// PULSE_DISABLE_LOGIN=true and PULSE_DISABLE_LOGIN_EMAIL point at a real,
// already-enabled user -- misconfiguration (missing env var, unknown email,
// disabled tenant) falls straight back to requiring a normal (Clerk) sign-in
// rather than failing open. This is orthogonal to the auth mechanism: it
// bypassed the old cookie check before Clerk existed, and it bypasses Clerk
// the same way now -- it never even looks at req.headers for a Clerk cookie.
// Do not enable this on a deployment holding real tenant data unless that
// exposure is intentional.
let bypassSessionCache: { session: AuthenticatedSession; cachedAt: number } | null = null;
const BYPASS_CACHE_MS = 5 * 60 * 1000;

function loginBypassEnabled(): boolean {
  return asBool(process.env.PULSE_DISABLE_LOGIN, false);
}

function loginBypassEmail(): string | null {
  const value = process.env.PULSE_DISABLE_LOGIN_EMAIL;
  return value && value.trim() ? value.trim() : null;
}

async function resolveBypassSession(): Promise<AuthenticatedSession | null> {
  const email = loginBypassEmail();
  if (!email) {
    return null;
  }

  if (bypassSessionCache && Date.now() - bypassSessionCache.cachedAt < BYPASS_CACHE_MS) {
    return bypassSessionCache.session;
  }

  try {
    const userId = await resolveUserIdByEmail(email);
    if (!userId) {
      console.warn(`[auth] PULSE_DISABLE_LOGIN_EMAIL "${email}" does not match any user; login bypass inactive.`);
      return null;
    }

    const expiresAt = new Date(Date.now() + BYPASS_CACHE_MS).toISOString();
    const session = await buildSessionForUserId(userId, expiresAt);
    if (!session) {
      console.warn(`[auth] PULSE_DISABLE_LOGIN_EMAIL "${email}" cannot sign in (tenant disabled?); login bypass inactive.`);
      return null;
    }

    bypassSessionCache = { session, cachedAt: Date.now() };
    return session;
  } catch (err) {
    console.warn('[auth] Login bypass could not resolve a session; falling back to normal sign-in.', err);
    return null;
  }
}

function shouldUseSecureCookie(): boolean {
  if (process.env.PULSE_COOKIE_SECURE !== undefined) {
    return asBool(process.env.PULSE_COOKIE_SECURE, false);
  }

  return process.env.NODE_ENV === 'production';
}

function cookieAttributes(maxAgeSeconds: number): string[] {
  const attributes = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];

  if (shouldUseSecureCookie()) {
    attributes.push('Secure');
  }

  return attributes;
}

export function serializeImpersonationCookie(sessionToken: string, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  const encoded = encodeURIComponent(sessionToken);
  return `${IMPERSONATION_COOKIE_NAME}=${encoded}; ${cookieAttributes(maxAgeSeconds).join('; ')}`;
}

export function serializeClearedImpersonationCookie(): string {
  return `${IMPERSONATION_COOKIE_NAME}=; ${cookieAttributes(0).join('; ')}`;
}

export function readCookie(headerValue: string | undefined, cookieName: string): string | null {
  if (!headerValue) {
    return null;
  }

  const segments = headerValue.split(';');
  for (const segment of segments) {
    const [rawName, ...rest] = segment.trim().split('=');
    if (rawName !== cookieName) {
      continue;
    }

    const value = rest.join('=').trim();
    return value ? decodeURIComponent(value) : null;
  }

  return null;
}

// A verified primary email is required before we will use it to link or
// look up a Pulse account -- an unverified address on a Clerk user is not
// proof of ownership of that mailbox, and account linking (store/auth.ts)
// depends on that proof.
function primaryVerifiedEmail(user: ClerkUser): string | null {
  const primary = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== 'verified') {
    return null;
  }

  return primary.emailAddress;
}

export interface ClerkIdentity {
  clerkUserId: string;
  email: string;
}

// Resolves a verified Clerk identity with no assumption that a Pulse account
// exists for it yet -- used directly by the registration route, which is the
// one place we need "who is this Clerk user" without also requiring an
// already-linked Pulse session.
async function resolveVerifiedClerkIdentity(userId: string | null): Promise<ClerkIdentity | null> {
  if (!userId) {
    return null;
  }

  const clerkUser = await clerkClient.users.getUser(userId).catch((err) => {
    console.error('[auth] Failed to load Clerk user record', err);
    return null;
  });
  if (!clerkUser) {
    return null;
  }

  const email = primaryVerifiedEmail(clerkUser);
  if (!email) {
    return null;
  }

  return { clerkUserId: userId, email };
}

// For routes that need "who is signed in through Clerk" before any Pulse
// account necessarily exists for them (registration). Returns null if there
// is no valid Clerk session, or the Clerk user has no verified primary email.
export function getClerkIdentityFromRequest(req: Request): Promise<ClerkIdentity | null> {
  return resolveVerifiedClerkIdentity(getAuth(req).userId);
}

// Shared by both the Express request path (getAuth(req)) and the Socket.IO
// handshake path (clerkClient.authenticateRequest) below -- both end up with
// the same shape (a Clerk userId + optional sessionClaims), so the Pulse
// identity resolution only needs to be written once.
async function identitySessionFromClerkAuth(auth: {
  userId: string | null;
  sessionClaims: { exp?: number } | null;
}): Promise<AuthenticatedSession | null> {
  const identity = await resolveVerifiedClerkIdentity(auth.userId);
  if (!identity) {
    return null;
  }

  const expClaim = auth.sessionClaims?.exp;
  const expiresAt = expClaim
    ? new Date(expClaim * 1000).toISOString()
    : new Date(Date.now() + 60 * 60 * 1000).toISOString();

  return getIdentitySessionForClerkUser({ ...identity, expiresAt });
}

// The impersonation cookie only ever overlays on top of the identity session
// that is *currently signed in through Clerk* -- a stale or foreign cookie
// (e.g. a browser tab left open after the admin's own account changed) is
// silently ignored rather than trusted, so possessing the cookie alone can
// never elevate or redirect someone else's session.
async function resolveImpersonationOverlay(
  cookieHeader: string | undefined,
  identitySession: AuthenticatedSession,
): Promise<AuthenticatedSession | null> {
  const token = readCookie(cookieHeader, IMPERSONATION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const impersonationSession = await getImpersonationSessionFromToken(token);
  if (!impersonationSession || !impersonationSession.impersonatorUserId) {
    return null;
  }

  if (impersonationSession.impersonatorUserId !== identitySession.userId || !identitySession.isPlatformAdmin) {
    return null;
  }

  return impersonationSession;
}

export async function getSessionFromRequest(req: Request, res?: Response): Promise<AuthenticatedSession | null> {
  if (req.pulseSession) {
    return req.pulseSession;
  }

  const clerkAuth = getAuth(req);
  const identitySession = await identitySessionFromClerkAuth({
    userId: clerkAuth.userId,
    sessionClaims: clerkAuth.sessionClaims as { exp?: number } | null,
  });

  if (identitySession) {
    const overlay = await resolveImpersonationOverlay(req.headers.cookie, identitySession);
    req.pulseSession = overlay ?? identitySession;
    return req.pulseSession;
  }

  if (loginBypassEnabled()) {
    const bypass = await resolveBypassSession();
    if (bypass) {
      req.pulseSession = bypass;
      return bypass;
    }
  }

  return null;
}

// Socket.IO handshakes are not Express requests, so clerkMiddleware()/getAuth
// never runs for them. This authenticates the raw handshake cookie header
// directly against Clerk using the same backend client, then funnels through
// the same identity + impersonation-overlay resolution as HTTP requests.
export async function resolveSessionFromHandshakeCookies(cookieHeader: string | undefined): Promise<AuthenticatedSession | null> {
  if (!cookieHeader) {
    return null;
  }

  const request = new Request('https://pulse.internal/socket.io', {
    headers: { cookie: cookieHeader },
  });

  const requestState = await clerkClient.authenticateRequest(request, {
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  }).catch((err) => {
    console.error('[auth] Failed to authenticate Socket.IO handshake against Clerk', err);
    return null;
  });
  if (!requestState) {
    return null;
  }

  const clerkAuth = requestState.toAuth();
  const identitySession = await identitySessionFromClerkAuth({
    userId: clerkAuth?.userId ?? null,
    sessionClaims: (clerkAuth?.sessionClaims as { exp?: number } | null) ?? null,
  });
  if (!identitySession) {
    return null;
  }

  const overlay = await resolveImpersonationOverlay(cookieHeader, identitySession);
  return overlay ?? identitySession;
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await getSessionFromRequest(req, res);
  if (!session) {
    res.status(401).json({ error: 'Sign in required.' });
    return;
  }

  next();
}

export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await getSessionFromRequest(req, res);
  if (!session) {
    res.status(401).json({ error: 'Sign in required.' });
    return;
  }

  if (!session.isPlatformAdmin) {
    res.status(403).json({ error: 'Platform admin access required.' });
    return;
  }

  next();
}

export function requireRole(roles: string[]): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session = await getSessionFromRequest(req, res);
    if (!session) {
      res.status(401).json({ error: 'Sign in required.' });
      return;
    }

    if (!roles.includes(session.role)) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    next();
  };
}

export async function blockSupportDeletes(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method !== 'DELETE') {
    next();
    return;
  }

  const session = await getSessionFromRequest(req, res);
  if (session && session.role === 'support') {
    res.status(403).json({ error: 'Support accounts cannot perform delete operations.' });
    return;
  }

  next();
}

// "Logout" from the backend's point of view now only means: end whatever
// Pulse-owned impersonation overlay is active, and best-effort revoke the
// underlying Clerk session server-side. Clearing the actual Clerk identity
// cookie is the frontend's job (it calls Clerk's own signOut()) -- Pulse
// never owned that cookie and has no way to clear it directly.
export async function clearPulseSessionState(req: Request, res: Response): Promise<void> {
  const impersonationToken = readCookie(req.headers.cookie, IMPERSONATION_COOKIE_NAME);
  if (impersonationToken) {
    await deleteImpersonationSession(impersonationToken);
  }

  const clerkAuth = getAuth(req);
  if (clerkAuth.sessionId) {
    try {
      await clerkClient.sessions.revokeSession(clerkAuth.sessionId);
    } catch (err) {
      // Non-fatal -- the frontend's Clerk signOut() call still clears the
      // browser-side cookie even if the server-side revoke fails here.
      console.error('[auth] Failed to revoke Clerk session on logout', err);
    }
  }

  res.setHeader('Set-Cookie', serializeClearedImpersonationCookie());
  req.pulseSession = undefined;
}
