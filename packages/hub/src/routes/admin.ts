import { Request, Response, Router } from 'express';
import {
  appendAdminAuditEvent,
  createImpersonationSessionForTenant,
  createPasswordResetForTenantOwner,
  deleteTenantAccount,
  listAdminAuditEvents,
  listTenantsForAdmin,
  rotateTenantAccessKey,
  updateTenantEnabledState,
} from '../store/auth';
import {
  ADMIN_RETURN_COOKIE_NAME,
  readCookie,
  SESSION_COOKIE_NAME,
  serializeAdminReturnCookie,
  serializeSessionCookie,
} from '../serverAuth';
import { sendPasswordResetEmail, sendRegistrationAccessKeyEmail } from '../services/accountEmail';

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return fallback;
}

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

export function createAdminRouter(): Router {
  const router = Router();

  router.get('/tenants', async (_req: Request, res: Response) => {
    return res.json({
      tenants: await listTenantsForAdmin(),
    });
  });

  router.get('/audit', async (req: Request, res: Response) => {
    return res.json({
      events: await listAdminAuditEvents({
        tenantId: asString(req.query?.tenantId, '') || null,
        limit: Number.parseInt(asString(req.query?.limit, '40'), 10) || 40,
      }),
    });
  });

  router.post('/tenants/:tenantId/access', async (req: Request, res: Response) => {
    try {
      const session = req.auth;
      if (!session) {
        return res.status(401).json({ error: 'Sign in required.' });
      }

      const enabled = asBool(req.body?.enabled, false);
      const summary = await updateTenantEnabledState({
        tenantId: req.params.tenantId,
        enabled,
        disabledReason: asString(req.body?.disabledReason),
      });

      await appendAdminAuditEvent({
        actorUserId: session.userId,
        actorEmail: session.email,
        targetTenantId: summary.tenantId,
        targetEmail: summary.ownerEmail,
        action: enabled ? 'tenant_enabled' : 'tenant_disabled',
        details: {
          tenantName: summary.tenantName,
          tenantSlug: summary.tenantSlug,
          disabledReason: summary.disabledReason,
        },
      });

      return res.json({
        ok: true,
        tenant: summary,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to update tenant access.',
      });
    }
  });

  router.post('/tenants/:tenantId/renew-key', async (req: Request, res: Response) => {
    try {
      const session = req.auth;
      if (!session) {
        return res.status(401).json({ error: 'Sign in required.' });
      }

      const rotation = await rotateTenantAccessKey({
        tenantId: req.params.tenantId,
      });
      const emailTenant = rotation.summary;
      const sendEmail = asBool(req.body?.sendEmail, true) && !!emailTenant.ownerEmail;
      const revealKey = asBool(req.body?.revealKey, false);
      let emailed = false;

      if (sendEmail && emailTenant.ownerEmail) {
        try {
          emailed = await sendRegistrationAccessKeyEmail({
            to: emailTenant.ownerEmail,
            companyName: emailTenant.tenantName,
            displayName: emailTenant.ownerDisplayName ?? emailTenant.tenantName,
            accessKey: rotation.accessKey,
            accessKeyExpiresAt: rotation.summary.accessKeyExpiresAt ?? '',
            appUrl: requestBaseUrl(req),
            enabled: rotation.summary.enabled,
          });
        } catch (error) {
          console.error('[admin] Failed to send renewed access key email', error);
        }
      }

      await appendAdminAuditEvent({
        actorUserId: session.userId,
        actorEmail: session.email,
        targetTenantId: rotation.summary.tenantId,
        targetEmail: rotation.summary.ownerEmail,
        action: 'access_key_renewed',
        details: {
          tenantName: rotation.summary.tenantName,
          tenantSlug: rotation.summary.tenantSlug,
          emailed,
          expiresAt: rotation.summary.accessKeyExpiresAt,
        },
      });

      return res.json({
        ok: true,
        tenant: rotation.summary,
        accessKey: (emailed && !revealKey) ? null : rotation.accessKey,
        emailed,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to renew the tenant key.',
      });
    }
  });

  router.post('/tenants/:tenantId/password-reset', async (req: Request, res: Response) => {
    try {
      const session = req.auth;
      if (!session) {
        return res.status(401).json({ error: 'Sign in required.' });
      }

      const issued = await createPasswordResetForTenantOwner({
        tenantId: req.params.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        createdByAdmin: true,
      });
      if (!issued) {
        return res.status(404).json({ error: 'No tenant owner was found for this account.' });
      }

      const sendEmail = asBool(req.body?.sendEmail, true);
      const revealLink = asBool(req.body?.revealLink, false);
      const resetUrl = `${requestBaseUrl(req)}/reset-password?token=${encodeURIComponent(issued.resetToken)}`;
      let emailed = false;

      if (sendEmail) {
        try {
          emailed = await sendPasswordResetEmail({
            to: issued.email,
            companyName: issued.tenantName,
            displayName: issued.displayName,
            resetUrl,
            expiresAt: issued.expiresAt,
            appUrl: requestBaseUrl(req),
          });
        } catch (error) {
          console.error('[admin] Failed to send password reset email', error);
        }
      }

      return res.json({
        ok: true,
        emailed,
        expiresAt: issued.expiresAt,
        resetUrl: (emailed && !revealLink) ? null : resetUrl,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to start the password reset.',
      });
    }
  });

  router.post('/tenants/:tenantId/impersonate', async (req: Request, res: Response) => {
    try {
      const session = req.auth;
      if (!session) {
        return res.status(401).json({ error: 'Sign in required.' });
      }

      if (session.impersonating) {
        return res.status(400).json({ error: 'Stop the current impersonation session before starting another one.' });
      }

      const currentSessionToken = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
      if (!currentSessionToken) {
        return res.status(401).json({ error: 'Your admin session is missing. Sign in again.' });
      }

      if (readCookie(req.headers.cookie, ADMIN_RETURN_COOKIE_NAME)) {
        return res.status(400).json({ error: 'An admin return session is already active. Stop impersonation before starting a new one.' });
      }

      const impersonation = await createImpersonationSessionForTenant({
        tenantId: req.params.tenantId,
        adminUserId: session.userId,
        adminEmail: session.email,
      });

      res.setHeader('Set-Cookie', [
        serializeSessionCookie(impersonation.sessionToken),
        serializeAdminReturnCookie(currentSessionToken),
      ]);

      return res.json({
        ok: true,
        tenantId: impersonation.target.tenant_id,
        tenantName: impersonation.target.tenant_name,
        targetEmail: impersonation.target.email,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to open the tenant workspace.',
      });
    }
  });

  router.delete('/tenants/:tenantId', async (req: Request, res: Response) => {
    try {
      const session = req.auth;
      if (!session) {
        return res.status(401).json({ error: 'Sign in required.' });
      }

      const deleted = await deleteTenantAccount({
        tenantId: req.params.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorTenantId: session.tenantId,
      });

      return res.json({
        ok: true,
        deleted,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to delete the tenant account.',
      });
    }
  });

  return router;
}
