import { Request, Response, Router } from 'express';
import { requireSession } from '../serverAuth';
import {
  getAlertDeliveryHealth,
  sendTenantEmail,
  sendTenantTelegram,
} from '../services/alerting';
import { sendPushToTenant } from './push';

type AlertChannel = 'email' | 'telegram' | 'push';

function isAlertChannel(value: unknown): value is AlertChannel {
  return value === 'email' || value === 'telegram' || value === 'push';
}

export function createAlertTestRouter(): Router {
  const router = Router();

  router.post('/test', requireSession, async (req: Request, res: Response) => {
    const { channel } = req.body as Record<string, unknown>;

    if (!isAlertChannel(channel)) {
      return res.status(400).json({
        ok: false,
        error: 'channel must be one of: email, telegram, push',
      });
    }

    const session = req.auth;
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Sign in required.' });
    }

    const tenantId = session.tenantId;
    const subject = 'TEST ALERT — Clarix Pulse';
    const body = `This is a test alert from Clarix Pulse. Your ${channel} alerting is working correctly. Time: ${new Date().toISOString()}`;

    try {
      if (channel === 'email') {
        await sendTenantEmail(tenantId, subject, body);
      } else if (channel === 'telegram') {
        await sendTenantTelegram(tenantId, body);
      } else {
        await sendPushToTenant(tenantId, subject, body, `test-alert-${tenantId}`);
      }

      const deliveryHealth = getAlertDeliveryHealth();

      return res.json({
        ok: true,
        channel,
        message: `Test alert sent on channel: ${channel}`,
        deliveryHealth,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error sending test alert';
      console.error(`[alertTest] Test alert failed for channel ${channel}:`, err);
      return res.status(500).json({ ok: false, error });
    }
  });

  return router;
}
