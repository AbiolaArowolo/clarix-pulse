import { Request, Response, Router } from 'express';
import {
  appendAdminAuditEvent,
  createImpersonationSessionForTenant,
  deleteTenantAccount,
  listAdminAuditEvents,
  listTenantsForAdmin,
  updateTenantEnabledState,
} from '../store/auth';
import { serializeImpersonationCookie } from '../serverAuth';

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
      const session = req.pulseSession;
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

  // Opens a read/write "support mode" view into a tenant owner's workspace.
  // Unlike before Clerk, this does NOT swap the admin's own login cookie --
  // their Clerk session stays exactly as it was. It only sets a Pulse-owned
  // impersonation cookie that getSessionFromRequest overlays on top of their
  // still-valid Clerk identity (see serverAuth.ts).
  router.post('/tenants/:tenantId/impersonate', async (req: Request, res: Response) => {
    try {
      const session = req.pulseSession;
      if (!session) {
        return res.status(401).json({ error: 'Sign in required.' });
      }

      if (session.impersonating) {
        return res.status(400).json({ error: 'Stop the current impersonation session before starting another one.' });
      }

      const impersonation = await createImpersonationSessionForTenant({
        tenantId: req.params.tenantId,
        adminUserId: session.userId,
        adminEmail: session.email,
      });

      res.setHeader('Set-Cookie', serializeImpersonationCookie(impersonation.sessionToken));

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
      const session = req.pulseSession;
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
