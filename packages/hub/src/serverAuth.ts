import { NextFunction, Request, Response } from 'express';
import {
  AuthenticatedSession,
  createSessionForUser,
  deleteSession,
  getSessionFromToken,
  resolveUserIdByEmail,
} from './store/auth';

export const SESSION_COOKIE_NAME = 'clarix_pulse_session';
export const ADMIN_RETURN_COOKIE_NAME = 'clarix_pulse_admin_return';

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

// --- Temporary login bypass -------------------------------------------------
// Off by default everywhere, including production. Only activates when BOTH
// PULSE_DISABLE_LOGIN=true and PULSE_DISABLE_LOGIN_EMAIL point at a real,
// already-enabled user — misconfiguration (missing env var, unknown email,
// disabled tenant) falls straight back to requiring a normal login rather
// than failing open. Do not enable this on a deployment holding real tenant
// data unless that exposure is intentional.
let bypassSessionCache: { sessionToken: string; session: AuthenticatedSession; cachedAt: number } | null = null;
const BYPASS_CACHE_MS = 5 * 60 * 1000;

function loginBypassEnabled(): boolean {
  return asBool(process.env.PULSE_DISABLE_LOGIN, false);
}

function loginBypassEmail(): string | null {
  const value = process.env.PULSE_DISABLE_LOGIN_EMAIL;
  return value && value.trim() ? value.trim() : null;
}

async function resolveBypassSession(): Promise<{ sessionToken: string; session: AuthenticatedSession } | null> {
  const email = loginBypassEmail();
  if (!email) {
    return null;
  }

  if (bypassSessionCache && Date.now() - bypassSessionCache.cachedAt < BYPASS_CACHE_MS) {
    return bypassSessionCache;
  }

  try {
    const userId = await resolveUserIdByEmail(email);
    if (!userId) {
      console.warn(`[auth] PULSE_DISABLE_LOGIN_EMAIL "${email}" does not match any user; login bypass inactive.`);
      return null;
    }

    const created = await createSessionForUser(userId);
    bypassSessionCache = { ...created, cachedAt: Date.now() };
    return bypassSessionCache;
  } catch (err) {
    console.warn('[auth] Login bypass could not create a session; falling back to normal login.', err);
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

export function serializeSessionCookie(sessionToken: string, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  const encoded = encodeURIComponent(sessionToken);
  return `${SESSION_COOKIE_NAME}=${encoded}; ${cookieAttributes(maxAgeSeconds).join('; ')}`;
}

export function serializeAdminReturnCookie(sessionToken: string, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  const encoded = encodeURIComponent(sessionToken);
  return `${ADMIN_RETURN_COOKIE_NAME}=${encoded}; ${cookieAttributes(maxAgeSeconds).join('; ')}`;
}

export function serializeClearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes(0).join('; ')}`;
}

export function serializeClearedAdminReturnCookie(): string {
  return `${ADMIN_RETURN_COOKIE_NAME}=; ${cookieAttributes(0).join('; ')}`;
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

export async function getSessionFromRequest(req: Request, res?: Response): Promise<AuthenticatedSession | null> {
  if (req.auth) {
    return req.auth;
  }

  const sessionToken = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (sessionToken) {
    const session = await getSessionFromToken(sessionToken);
    if (session) {
      req.auth = session;
      return session;
    }
  }

  if (loginBypassEnabled()) {
    const bypass = await resolveBypassSession();
    if (bypass) {
      req.auth = bypass.session;
      if (res) {
        res.setHeader('Set-Cookie', serializeSessionCookie(bypass.sessionToken));
      }
      return bypass.session;
    }
  }

  return null;
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

export async function clearSessionFromRequest(req: Request, res: Response): Promise<void> {
  const sessionToken = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  const adminReturnToken = readCookie(req.headers.cookie, ADMIN_RETURN_COOKIE_NAME);
  if (sessionToken) {
    await deleteSession(sessionToken);
  }
  if (adminReturnToken && adminReturnToken !== sessionToken) {
    await deleteSession(adminReturnToken);
  }

  res.setHeader('Set-Cookie', [
    serializeClearedSessionCookie(),
    serializeClearedAdminReturnCookie(),
  ]);
}
