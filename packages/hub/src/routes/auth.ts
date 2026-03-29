import { Request, Response, Router } from 'express';
import {
  authenticateUser,
  createSessionForUser,
  registerTenantOwner,
} from '../store/auth';
import {
  clearSessionFromRequest,
  getSessionFromRequest,
  serializeSessionCookie,
} from '../serverAuth';

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
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
    },
    tenant: {
      tenantId: session.tenantId,
      name: session.tenantName,
      slug: session.tenantSlug,
      enrollmentKey: session.enrollmentKey,
      defaultAlertEmail: session.defaultAlertEmail,
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

      req.auth = result.session;
      res.setHeader('Set-Cookie', serializeSessionCookie(result.sessionToken));
      return res.status(201).json(sessionPayload(req));
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create the account.',
      });
    }
  });

  router.post('/login', async (req: Request, res: Response) => {
    const email = asString(req.body?.email);
    const password = asString(req.body?.password);
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const auth = await authenticateUser(email, password);
    if (!auth) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const result = await createSessionForUser(auth.userId);
    req.auth = result.session;
    res.setHeader('Set-Cookie', serializeSessionCookie(result.sessionToken));
    return res.json(sessionPayload(req));
  });

  router.post('/logout', async (req: Request, res: Response) => {
    await clearSessionFromRequest(req, res);
    req.auth = undefined;
    return res.json({ ok: true });
  });

  return router;
}
