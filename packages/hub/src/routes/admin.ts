import { Request, Response, Router } from 'express';
import {
  listTenantsForAdmin,
  rotateTenantAccessKey,
  updateTenantEnabledState,
} from '../store/auth';
import { sendRegistrationAccessKeyEmail } from '../services/accountEmail';

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

  router.post('/tenants/:tenantId/access', async (req: Request, res: Response) => {
    try {
      const summary = await updateTenantEnabledState({
        tenantId: req.params.tenantId,
        enabled: asBool(req.body?.enabled, false),
        disabledReason: asString(req.body?.disabledReason),
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

  return router;
}
