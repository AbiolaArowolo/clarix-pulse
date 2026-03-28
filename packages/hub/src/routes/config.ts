import { Request, Response, Router } from 'express';
import { INSTANCE_MAP } from '../config/instances';
import { getNodeDesiredConfig, getPlayerNodeConfig } from '../config/nodeConfigs';
import { getAlertSettings, updateAlertSettings } from '../store/alertSettings';
import { getInstanceControls, updateInstanceControls } from '../store/instanceControls';
import { getMirroredPlayerConfig } from '../store/nodeConfigMirror';

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

function normalizeOptionalStringList(values: unknown): string[] | null {
  if (!Array.isArray(values)) return null;
  return values
    .slice(0, 3)
    .map((value) => asString(value))
    .filter(Boolean);
}

interface TelegramTarget {
  chatId: string;
  recipient: string;
  title: string;
  subtitle: string;
}

function formatTelegramTarget(chat: Record<string, unknown>): TelegramTarget | null {
  const chatId = asString(chat.id);
  if (!chatId) return null;

  const chatType = asString(chat.type, 'private');
  const username = asString(chat.username);
  const firstName = asString(chat.first_name);
  const lastName = asString(chat.last_name);
  const title = asString(chat.title);
  const displayTitle = title || [firstName, lastName].filter(Boolean).join(' ').trim() || username || chatId;
  const subtitleParts = [chatType];
  if (username) {
    subtitleParts.push(`@${username}`);
  }

  return {
    chatId,
    recipient: username ? `@${username}` : chatId,
    title: displayTitle,
    subtitle: subtitleParts.join(' | '),
  };
}

async function listTelegramTargets(): Promise<TelegramTarget[]> {
  const token = asString(process.env.TELEGRAM_BOT_TOKEN);
  if (!token) {
    return [];
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    if (!response.ok) {
      return [];
    }

    const payload = await response.json() as { result?: Array<Record<string, unknown>> };
    const updates = Array.isArray(payload.result) ? payload.result : [];
    const targets = new Map<string, TelegramTarget>();

    for (const update of updates.slice(-50)) {
      const message = (
        update.message
        ?? update.edited_message
        ?? update.channel_post
        ?? update.edited_channel_post
      ) as Record<string, unknown> | undefined;
      const chat = message && typeof message.chat === 'object' && !Array.isArray(message.chat)
        ? message.chat as Record<string, unknown>
        : null;
      if (!chat) continue;

      const target = formatTelegramTarget(chat);
      if (!target) continue;
      targets.set(target.chatId, target);
    }

    return Array.from(targets.values()).reverse();
  } catch {
    return [];
  }
}

export function createConfigRouter(): Router {
  const router = Router();
  const tokenToNode = parseAgentTokens();

  router.get('/player/:playerId', async (req: Request, res: Response) => {
    const player = await getMirroredPlayerConfig(req.params.playerId) ?? getPlayerNodeConfig(req.params.playerId);
    if (!player) {
      return res.status(404).json({ error: 'Unknown player config.' });
    }

    return res.json(player);
  });

  router.post('/player/:playerId', (req: Request, res: Response) => {
    return res.status(409).json({
      error: 'This player is configured locally on the node. Open Pulse on the node to edit settings there.',
    });
  });

  router.get('/instance/:playerId/controls', (req: Request, res: Response) => {
    const instance = INSTANCE_MAP.get(req.params.playerId);
    if (!instance) {
      return res.status(404).json({ error: 'Unknown player.' });
    }

    return res.json({
      instanceId: instance.id,
      controls: getInstanceControls(instance.id),
    });
  });

  router.post('/instance/:playerId/controls', async (req: Request, res: Response) => {
    const instance = INSTANCE_MAP.get(req.params.playerId);
    if (!instance) {
      return res.status(404).json({ error: 'Unknown player.' });
    }

    const monitoringEnabled = req.body && Object.prototype.hasOwnProperty.call(req.body, 'monitoringEnabled')
      ? asBool(req.body.monitoringEnabled, true)
      : undefined;
    const maintenanceMode = req.body && Object.prototype.hasOwnProperty.call(req.body, 'maintenanceMode')
      ? asBool(req.body.maintenanceMode, false)
      : undefined;

    const controls = await updateInstanceControls(instance.id, {
      monitoringEnabled,
      maintenanceMode,
    });

    return res.json({
      ok: true,
      instanceId: instance.id,
      controls,
    });
  });

  router.get('/alerts', async (req: Request, res: Response) => {
    return res.json({
      settings: await getAlertSettings(),
      capabilities: {
        emailDeliveryConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
        telegramDeliveryConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        phoneDeliveryConfigured: false,
      },
    });
  });

  router.get('/alerts/telegram-targets', async (req: Request, res: Response) => {
    return res.json({
      targets: await listTelegramTargets(),
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    });
  });

  router.post('/alerts', async (req: Request, res: Response) => {
    const emailRecipients = normalizeOptionalStringList(req.body?.emailRecipients);
    const telegramChatIds = normalizeOptionalStringList(req.body?.telegramChatIds);
    const phoneNumbers = normalizeOptionalStringList(req.body?.phoneNumbers);
    const emailEnabled = asBool(req.body?.emailEnabled, true);
    const telegramEnabled = asBool(req.body?.telegramEnabled, true);
    const phoneEnabled = asBool(req.body?.phoneEnabled, true);

    if (!emailRecipients || !telegramChatIds || !phoneNumbers) {
      return res.status(400).json({
        error: 'emailRecipients, telegramChatIds, and phoneNumbers must each be arrays of up to 3 values.',
      });
    }

    const settings = await updateAlertSettings({
      emailRecipients,
      telegramChatIds,
      phoneNumbers,
      emailEnabled,
      telegramEnabled,
      phoneEnabled,
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
