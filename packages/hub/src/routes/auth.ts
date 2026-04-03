import { Request, Response, Router } from 'express';
import {
  authenticateUser,
  createPasswordResetForEmail,
  createSessionForUser,
  deleteSession,
  getSessionFromToken,
  recordImpersonationEnded,
  registerTenantOwner,
  resetPasswordWithToken,
  rotateAccessKeyForTenant,
} from '../store/auth';
import {
  ADMIN_RETURN_COOKIE_NAME,
  clearSessionFromRequest,
  getSessionFromRequest,
  readCookie,
  SESSION_COOKIE_NAME,
  serializeClearedAdminReturnCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from '../serverAuth';
import { accountEmailReady, sendAccessKeyResendEmail, sendPasswordResetEmail, sendRegistrationAccessKeyEmail } from '../services/accountEmail';

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
    impersonation: session.impersonating ? {
      active: true,
      impersonatorUserId: session.impersonatorUserId,
      impersonatorEmail: session.impersonatorEmail,
      startedAt: session.impersonationStartedAt,
    } : {
      active: false,
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

      res.setHeader('Set-Cookie', [
        serializeClearedSessionCookie(),
        serializeClearedAdminReturnCookie(),
      ]);
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
      res.setHeader('Set-Cookie', [
        serializeSessionCookie(result.sessionToken),
        serializeClearedAdminReturnCookie(),
      ]);
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

  router.post('/forgot-password', async (req: Request, res: Response) => {
    const email = asString(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    try {
      const reset = await createPasswordResetForEmail({
        email,
      });

      if (reset) {
        try {
          await sendPasswordResetEmail({
            to: reset.email,
            companyName: reset.tenantName,
            displayName: reset.displayName,
            resetUrl: `${requestBaseUrl(req)}/reset-password?token=${encodeURIComponent(reset.resetToken)}`,
            expiresAt: reset.expiresAt,
            appUrl: requestBaseUrl(req),
          });
        } catch (error) {
          console.error('[auth] Failed to send password reset email', error);
        }
      }

      return res.json({
        ok: true,
        notice: accountEmailReady()
          ? 'If that email is registered, a password reset link has been sent.'
          : 'If that email is registered, a reset request has been recorded. Email delivery is currently unavailable, so contact Clarix support for the link.',
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to start the password reset.',
      });
    }
  });

  router.post('/reset-password', async (req: Request, res: Response) => {
    const token = asString(req.body?.token);
    const password = asString(req.body?.password);
    if (!token || !password) {
      return res.status(400).json({ error: 'Reset token and new password are required.' });
    }

    try {
      const result = await resetPasswordWithToken({ token, password });
      res.setHeader('Set-Cookie', [serializeClearedSessionCookie(), serializeClearedAdminReturnCookie()]);
      return res.json({
        ok: true,
        notice: `Password updated for ${result.email}. Sign in with your new password.`,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to reset the password.',
      });
    }
  });

  router.post('/resend-access-key', async (req: Request, res: Response) => {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ error: 'Sign in required.' });
    }

    try {
      const rotation = await rotateAccessKeyForTenant(session.tenantId);
      let emailSent = false;
      try {
        emailSent = await sendAccessKeyResendEmail({
          to: session.email,
          companyName: session.tenantName,
          displayName: session.displayName,
          accessKey: rotation.accessKey,
          accessKeyExpiresAt: rotation.accessKeyExpiresAt,
          appUrl: requestBaseUrl(req),
        });
      } catch (err) {
        console.error('[auth] Failed to send access key resend email', err);
      }

      return res.json({
        ok: true,
        emailSent,
        accessKeyHint: rotation.accessKeyHint,
        notice: emailSent
          ? 'A new access key has been sent to your email address.'
          : 'A new access key was generated but the email could not be delivered. Contact Clarix support.',
      });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to rotate access key.',
      });
    }
  });

  router.post('/impersonation/stop', async (req: Request, res: Response) => {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ error: 'Sign in required.' });
    }

    if (!session.impersonating || !session.impersonatorUserId || !session.impersonatorEmail) {
      return res.status(400).json({ error: 'No impersonation session is active.' });
    }

    const currentSessionToken = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    const adminReturnToken = readCookie(req.headers.cookie, ADMIN_RETURN_COOKIE_NAME);
    if (!currentSessionToken || !adminReturnToken) {
      res.setHeader('Set-Cookie', [serializeClearedSessionCookie(), serializeClearedAdminReturnCookie()]);
      return res.status(400).json({ error: 'The saved admin session is no longer available. Sign in again.' });
    }

    const adminSession = await getSessionFromToken(adminReturnToken);
    if (!adminSession || !adminSession.isPlatformAdmin || adminSession.impersonating) {
      await clearSessionFromRequest(req, res);
      req.auth = undefined;
      return res.status(401).json({ error: 'The saved admin session has expired. Sign in again.' });
    }

    await recordImpersonationEnded({
      actorUserId: session.impersonatorUserId,
      actorEmail: session.impersonatorEmail,
      targetTenantId: session.tenantId,
      targetUserId: session.userId,
      targetEmail: session.email,
    });

    await deleteSession(currentSessionToken);
    res.setHeader('Set-Cookie', [
      serializeSessionCookie(adminReturnToken),
      serializeClearedAdminReturnCookie(),
    ]);
    req.auth = adminSession;
    return res.json({
      ok: true,
      notice: `Returned to the admin workspace for ${adminSession.email}.`,
    });
  });

  return router;
}
