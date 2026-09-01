import { Request, Response, Router } from 'express';
import { blockSupportDeletes, requireRole, requireSession } from '../serverAuth';
import {
  createTeammateInvite,
  listTeammatesForTenant,
  removeTeammateFromTenant,
  revokeTeammateInvite,
  updateTeammateRole,
} from '../store/auth';
import { buildInviteSignUpUrl, sendTeammateInviteEmail } from '../services/inviteEmail';

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

// Tenant admin OR platform admin may manage teammates. A plain tenant
// 'admin' resolves to role: 'admin'; a platform admin (email allowlist)
// always resolves to role: 'super_admin' (see resolveRole in store/auth.ts)
// -- listing both here is how "role='admin' (or isPlatformAdmin) can
// invite" (the design requirement) is expressed through the existing,
// generic requireRole([...]) middleware rather than a new one.
const MANAGE_TEAM_ROLES = ['admin', 'super_admin'];

export function createTeamRouter(): Router {
  const router = Router();

  router.use(requireSession);

  // Any signed-in tenant member (including 'support' and 'user') can see
  // who is on the team -- only mutating the roster is admin-only below.
  router.get('/members', async (req: Request, res: Response) => {
    const members = await listTeammatesForTenant(req.pulseSession!.tenantId);
    return res.json({ members });
  });

  router.post('/invites', requireRole(MANAGE_TEAM_ROLES), async (req: Request, res: Response) => {
    const session = req.pulseSession!;
    const email = asString(req.body?.email);
    const displayName = asString(req.body?.displayName);
    const role = asString(req.body?.role, 'user') || 'user';

    if (!email) {
      return res.status(400).json({ error: 'email is required.' });
    }

    try {
      const invite = await createTeammateInvite({
        tenantId: session.tenantId,
        inviterUserId: session.userId,
        inviterEmail: session.email,
        email,
        displayName,
        role,
      });

      // The invite row is created either way -- email delivery is
      // best-effort. If SMTP isn't configured the frontend falls back to
      // showing the sign-up link for the admin to copy/paste themselves.
      const signUpUrl = buildInviteSignUpUrl(requestBaseUrl(req));
      const emailResult = await sendTeammateInviteEmail({
        toEmail: invite.email,
        toDisplayName: invite.displayName,
        tenantName: session.tenantName,
        inviterEmail: session.email,
        role: invite.role,
        signUpUrl,
      });

      return res.status(201).json({
        ok: true,
        invite,
        signUpUrl,
        email: emailResult,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create the invite.',
      });
    }
  });

  router.delete(
    '/invites/:userId',
    requireRole(MANAGE_TEAM_ROLES),
    blockSupportDeletes,
    async (req: Request, res: Response) => {
      const session = req.pulseSession!;
      try {
        await revokeTeammateInvite({
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email,
          targetUserId: req.params.userId,
        });
        return res.json({ ok: true });
      } catch (error) {
        return res.status(400).json({
          error: error instanceof Error ? error.message : 'Failed to revoke the invite.',
        });
      }
    },
  );

  router.patch('/members/:userId/role', requireRole(MANAGE_TEAM_ROLES), async (req: Request, res: Response) => {
    const session = req.pulseSession!;
    const role = asString(req.body?.role);
    if (!role) {
      return res.status(400).json({ error: 'role is required.' });
    }

    try {
      const updated = await updateTeammateRole({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        targetUserId: req.params.userId,
        role,
      });
      return res.json({ ok: true, member: updated });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to update the role.',
      });
    }
  });

  router.delete(
    '/members/:userId',
    requireRole(MANAGE_TEAM_ROLES),
    blockSupportDeletes,
    async (req: Request, res: Response) => {
      const session = req.pulseSession!;
      try {
        await removeTeammateFromTenant({
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email,
          targetUserId: req.params.userId,
        });
        return res.json({ ok: true });
      } catch (error) {
        return res.status(400).json({
          error: error instanceof Error ? error.message : 'Failed to remove the teammate.',
        });
      }
    },
  );

  return router;
}
