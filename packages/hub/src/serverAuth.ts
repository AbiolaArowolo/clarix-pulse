import { NextFunction, Request, Response } from 'express';
import { AuthenticatedSession, deleteSession, getSessionFromToken } from './store/auth';

export const SESSION_COOKIE_NAME = 'clarix_pulse_session';

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
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

export function serializeClearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes(0).join('; ')}`;
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

export async function getSessionFromRequest(req: Request): Promise<AuthenticatedSession | null> {
  if (req.auth) {
    return req.auth;
  }

  const sessionToken = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (!sessionToken) {
    return null;
  }

  const session = await getSessionFromToken(sessionToken);
  if (session) {
    req.auth = session;
  }

  return session;
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Sign in required.' });
    return;
  }

  next();
}

export async function clearSessionFromRequest(req: Request, res: Response): Promise<void> {
  const sessionToken = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (sessionToken) {
    await deleteSession(sessionToken);
  }

  res.setHeader('Set-Cookie', serializeClearedSessionCookie());
}
