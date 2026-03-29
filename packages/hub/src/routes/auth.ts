import { Request, Response, Router } from 'express';
import {
  authenticateUser,
  createSessionForUser,
  registerTenantOwner,
} from '../store/auth';
import {
  clearSessionFromRequest,
  getSessionFromRequest,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from '../serverAuth';
import { sendRegistrationAccessKeyEmail } from '../services/accountEmail';

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
}

function requestBaseUrl(req: Request): string {
  const forwardedProto = asString(req.headers['x-forwarded-proto']);
  const forwardedHost = asString(req.headers['x-forwarded-host']);
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = req.get('host');
  if (!host) {
    return 'https://pulse.clarixtech.com';
  }

  return `${req.protocol}://${host}`;
}

function sessionPayload(req: Request) {
  const session = req.auth;
  if (!session) {
    return {
      authenticated: false,
    };
  }

  return {
    authenticated: true,
    user: {
      userId: session.userId,
      email: session.email,
      displayName: session.displayName,
      isPlatformAdmin: session.isPlatformAdmin,
    },
    tenant: {
      tenantId: session.tenantId,
      name: session.tenantName,
      slug: session.tenantSlug,
      enrollmentKey: session.enrollmentKey,
      defaultAlertEmail: session.defaultAlertEmail,
      enabled: session.tenantEnabled,
      disabledReason: session.disabledReason,
      accessKeyHint: session.accessKeyHint,
      accessKeyExpiresAt: session.accessKeyExpiresAt,
    },
    session: {
      expiresAt: session.expiresAt,
    },
  };
}

export function createAuthRouter(): Router {
  const router = Router();

  router.get('/session', async (req: Request, res: Response) => {
    await getSessionFromRequest(req);
    return res.json(sessionPayload(req));
  });

  router.post('/register', async (req: Request, res: Response) => {
    try {
      const result = await registerTenantOwner({
        companyName: asString(req.body?.companyName),
        displayName: asString(req.body?.displayName),
        email: asString(req.body?.email),
        password: asString(req.body?.password),
      });

      let emailSent = false;
      try {
        emailSent = await sendRegistrationAccessKeyEmail({
          to: result.ownerEmail,
          companyName: result.tenantName,
          displayName: result.ownerDisplayName,
          accessKey: result.accessKey,
          accessKeyExpiresAt: result.accessKeyExpiresAt,
          appUrl: requestBaseUrl(req),
          enabled: false,
        });
      } catch (error) {
        console.error('[auth] Failed to send registration access email', error);
      }

      res.setHeader('Set-Cookie', serializeClearedSessionCookie());
      return res.status(201).json({
        authenticated: false,
        registered: true,
        notice: emailSent
          ? 'Account created. Your 365-day access key was emailed and the account is now pending activation.'
          : 'Account created. The access key email could not be delivered automatically, so the key is shown below once. Keep it safe while the account is pending activation.',
        registration: {
          companyName: result.tenantName,
          email: result.ownerEmail,
          accessKey: emailSent ? null : result.accessKey,
          accessKeyHint: result.accessKeyHint,
          accessKeyExpiresAt: result.accessKeyExpiresAt,
          pendingActivation: true,
          emailSent,
        },
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create the account.',
      });
    }
  });

  router.post('/login', async (req: Request, res: Response) => {
    const email = asString(req.body?.email);
    const password = asString(req.body?.password);
    const accessKey = asString(req.body?.accessKey);
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const auth = await authenticateUser(email, password, accessKey);
    if (!auth.ok || !auth.userId) {
      return res.status(auth.statusCode).json({ error: auth.error ?? 'Unable to sign in.' });
    }

    try {
      const result = await createSessionForUser(auth.userId);
      req.auth = result.session;
      res.setHeader('Set-Cookie', serializeSessionCookie(result.sessionToken));
      return res.json(sessionPayload(req));
    } catch (error) {
      return res.status(403).json({
        error: error instanceof Error ? error.message : 'Unable to create a session.',
      });
    }
  });

  router.post('/logout', async (req: Request, res: Response) => {
    await clearSessionFromRequest(req, res);
    req.auth = undefined;
    return res.json({ ok: true });
  });

  return router;
}
