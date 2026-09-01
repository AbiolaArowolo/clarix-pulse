import { Request, Response, Router } from 'express';
import {
  deleteImpersonationSession,
  recordImpersonationEnded,
  registerTenantOwner,
} from '../store/auth';
import {
  clearPulseSessionState,
  getClerkIdentityFromRequest,
  getSessionFromRequest,
  IMPERSONATION_COOKIE_NAME,
  readCookie,
  serializeClearedImpersonationCookie,
} from '../serverAuth';

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
}

function sessionPayload(req: Request) {
  const session = req.pulseSession;
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
      role: session.role,
    },
    tenant: {
      tenantId: session.tenantId,
      name: session.tenantName,
      slug: session.tenantSlug,
      enrollmentKey: session.enrollmentKey,
      defaultAlertEmail: session.defaultAlertEmail,
      enabled: session.tenantEnabled,
      disabledReason: session.disabledReason,
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
    await getSessionFromRequest(req, res);
    return res.json(sessionPayload(req));
  });

  // Creates a brand-new tenant workspace for the Clerk identity that is
  // currently signed in, and makes that identity its owner. This is the one
  // self-service path left: a person proves who they are via Clerk (sign-up
  // handled entirely on the frontend), then calls this endpoint to spin up
  // their own company workspace. Adding a *second* user to an *existing*
  // tenant is still admin-only -- there is no such endpoint, same as before
  // Clerk.
  router.post('/register', async (req: Request, res: Response) => {
    const identity = await getClerkIdentityFromRequest(req);
    if (!identity) {
      return res.status(401).json({
        error: 'Sign in with Clerk first, with a verified email address, then register your workspace.',
      });
    }

    try {
      const result = await registerTenantOwner({
        companyName: asString(req.body?.companyName),
        displayName: asString(req.body?.displayName),
        clerkUserId: identity.clerkUserId,
        email: identity.email,
      });

      req.pulseSession = undefined;
      res.setHeader('Set-Cookie', serializeClearedImpersonationCookie());
      return res.status(201).json({
        registered: true,
        notice: `Workspace "${result.tenantName}" created. You're signed in as its owner.`,
        registration: {
          companyName: result.tenantName,
          email: result.ownerEmail,
        },
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create the workspace.',
      });
    }
  });

  // No POST /login route: Clerk's own sign-in UI/hooks (frontend) establish
  // the session directly with Clerk. Every authenticated Pulse route re-
  // resolves the Pulse session from the live Clerk cookie via
  // getSessionFromRequest -- there is nothing left for the backend to
  // "log in" separately.

  router.post('/logout', async (req: Request, res: Response) => {
    await clearPulseSessionState(req, res);
    return res.json({ ok: true });
  });

  router.post('/impersonation/stop', async (req: Request, res: Response) => {
    const session = await getSessionFromRequest(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Sign in required.' });
    }

    if (!session.impersonating || !session.impersonatorUserId || !session.impersonatorEmail) {
      return res.status(400).json({ error: 'No impersonation session is active.' });
    }

    const impersonationToken = readCookie(req.headers.cookie, IMPERSONATION_COOKIE_NAME);
    if (impersonationToken) {
      await deleteImpersonationSession(impersonationToken);
    }

    await recordImpersonationEnded({
      actorUserId: session.impersonatorUserId,
      actorEmail: session.impersonatorEmail,
      targetTenantId: session.tenantId,
      targetUserId: session.userId,
      targetEmail: session.email,
    });

    res.setHeader('Set-Cookie', serializeClearedImpersonationCookie());

    // The admin's own Clerk cookie was never touched by impersonation, so
    // re-resolving the session now (with the impersonation row just deleted,
    // and req.pulseSession cleared so it isn't served from cache) naturally
    // falls back to their own identity -- no cookie-swap dance needed.
    req.pulseSession = undefined;
    const adminSession = await getSessionFromRequest(req, res);

    return res.json({
      ok: true,
      notice: `Returned to the admin workspace for ${adminSession?.email ?? session.impersonatorEmail}.`,
    });
  });

  return router;
}
