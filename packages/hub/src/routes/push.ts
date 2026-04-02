import { Router, Request, Response } from 'express';
import webpush from 'web-push';
import { requireSession } from '../serverAuth';
import { exec, query, queryOne } from '../store/db';

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const mailto = process.env.VAPID_MAILTO?.trim() ?? 'mailto:pulse@clarixtech.com';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(mailto, pub, priv);
  vapidConfigured = true;
  return true;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export async function savePushSubscription(
  tenantId: string,
  subscription: PushSubscriptionPayload,
): Promise<void> {
  await exec(
    `INSERT INTO push_subscriptions (tenant_id, endpoint, subscription, created_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (endpoint) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       subscription = EXCLUDED.subscription`,
    [tenantId, subscription.endpoint, JSON.stringify(subscription)],
  );
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await exec('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

export async function sendPushToTenant(
  tenantId: string,
  title: string,
  body: string,
  tag = 'pulse-alert',
): Promise<void> {
  if (!ensureVapid()) return;

  const rows = await query<{ subscription: PushSubscriptionPayload }>(
    'SELECT subscription FROM push_subscriptions WHERE tenant_id = $1',
    [tenantId],
  );

  const payload = JSON.stringify({ title, body, tag });

  const removals: string[] = [];
  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription as webpush.PushSubscription, payload);
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          removals.push(row.subscription.endpoint);
        } else {
          console.error('[push] send failed:', err instanceof Error ? err.message : err);
        }
      }
    }),
  );

  for (const endpoint of removals) {
    await removePushSubscription(endpoint).catch(() => undefined);
  }
}

export function createPushRouter(): Router {
  const router = Router();

  router.get('/vapid-key', (_req: Request, res: Response) => {
    const key = process.env.VAPID_PUBLIC_KEY?.trim();
    if (!key) {
      return res.status(503).json({ error: 'Push notifications are not configured on this server.' });
    }
    return res.json({ ok: true, publicKey: key });
  });

  router.post('/subscribe', requireSession, async (req: Request, res: Response) => {
    const sub = req.body as PushSubscriptionPayload;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return res.status(400).json({ error: 'Invalid push subscription object.' });
    }

    try {
      await savePushSubscription(req.auth!.tenantId, sub);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[push] subscribe error:', err);
      return res.status(500).json({ error: 'Failed to save push subscription.' });
    }
  });

  router.delete('/subscribe', requireSession, async (req: Request, res: Response) => {
    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required.' });
    }

    try {
      await removePushSubscription(endpoint);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[push] unsubscribe error:', err);
      return res.status(500).json({ error: 'Failed to remove push subscription.' });
    }
  });

  return router;
}
