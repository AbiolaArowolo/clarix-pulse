import { Request, Response, Router } from 'express';
import { getNodeDesiredConfig, getPlayerNodeConfig, updatePlayerUdpInputs, UdpInputConfig } from '../config/nodeConfigs';
import { getAlertSettings, updateAlertSettings } from '../store/alertSettings';

function parseAgentTokens(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.AGENT_TOKENS ?? '';
  for (const pair of raw.split(',')) {
    const [nodeId, token] = pair.trim().split(':');
    if (nodeId && token) map.set(token, nodeId);
  }
  return map;
}

function validateAgentToken(req: Request, tokenToNode: Map<string, string>): string | null {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  return tokenToNode.get(token) ?? null;
}

function getWriteKey(): string {
  return (process.env.CONFIG_WRITE_KEY ?? '').trim();
}

function requireWriteKey(req: Request, res: Response): boolean {
  const configuredKey = getWriteKey();
  if (!configuredKey) {
    res.status(503).json({ error: 'Config editing is not enabled on this hub.' });
    return false;
  }

  const providedKey = String(req.headers['x-config-write-key'] ?? '').trim();
  if (!providedKey || providedKey !== configuredKey) {
    res.status(401).json({ error: 'Invalid config write key.' });
    return false;
  }

  return true;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return fallback;
}

function clampInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(asString(value), 10);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(maximum, Math.max(minimum, normalized));
}

function normalizeUdpInputs(playerId: string, udpInputs: unknown): UdpInputConfig[] | null {
  if (!Array.isArray(udpInputs)) return null;
  if (udpInputs.length > 5) return null;

  return udpInputs.map((entry, index) => {
    const input = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : {};

    return {
      udpInputId: asString(input.udpInputId ?? input.udp_input_id, `${playerId}-udp-${index + 1}`),
      enabled: asBool(input.enabled, false),
      streamUrl: asString(input.streamUrl ?? input.stream_url),
      thumbnailIntervalS: clampInt(input.thumbnailIntervalS ?? input.thumbnail_interval_s, 10, 1, 300),
    };
  });
}

function normalizeOptionalStringList(values: unknown): string[] | null {
  if (!Array.isArray(values)) return null;
  return values
    .slice(0, 3)
    .map((value) => asString(value))
    .filter(Boolean);
}

export function createConfigRouter(): Router {
  const router = Router();
  const tokenToNode = parseAgentTokens();

  router.get('/player/:playerId', (req: Request, res: Response) => {
    if (!requireWriteKey(req, res)) return;

    const player = getPlayerNodeConfig(req.params.playerId);
    if (!player) {
      return res.status(404).json({ error: 'Unknown player config.' });
    }

    return res.json(player);
  });

  router.post('/player/:playerId', (req: Request, res: Response) => {
    if (!requireWriteKey(req, res)) return;

    const udpInputs = normalizeUdpInputs(req.params.playerId, req.body?.udpInputs);
    if (!udpInputs) {
      return res.status(400).json({ error: 'udpInputs must be an array of up to 5 inputs.' });
    }

    const updated = updatePlayerUdpInputs(req.params.playerId, udpInputs);
    if (!updated) {
      return res.status(404).json({ error: 'Unknown player config.' });
    }

    return res.json({
      ok: true,
      player: updated,
      appliedOnNextHeartbeat: true,
    });
  });

  router.get('/alerts', async (req: Request, res: Response) => {
    if (!requireWriteKey(req, res)) return;

    return res.json({
      settings: await getAlertSettings(),
      capabilities: {
        emailDeliveryConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
        telegramDeliveryConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        phoneDeliveryConfigured: false,
      },
    });
  });

  router.post('/alerts', async (req: Request, res: Response) => {
    if (!requireWriteKey(req, res)) return;

    const emailRecipients = normalizeOptionalStringList(req.body?.emailRecipients);
    const telegramChatIds = normalizeOptionalStringList(req.body?.telegramChatIds);
    const phoneNumbers = normalizeOptionalStringList(req.body?.phoneNumbers);

    if (!emailRecipients || !telegramChatIds || !phoneNumbers) {
      return res.status(400).json({
        error: 'emailRecipients, telegramChatIds, and phoneNumbers must each be arrays of up to 3 values.',
      });
    }

    const settings = await updateAlertSettings({
      emailRecipients,
      telegramChatIds,
      phoneNumbers,
    });

    return res.json({
      ok: true,
      settings,
      capabilities: {
        emailDeliveryConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
        telegramDeliveryConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        phoneDeliveryConfigured: false,
      },
    });
  });

  router.get('/node', (req: Request, res: Response) => {
    const nodeId = validateAgentToken(req, tokenToNode);
    if (!nodeId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return res.json(getNodeDesiredConfig(nodeId) ?? { nodeId, players: [], updatedAt: null });
  });

  return router;
}
