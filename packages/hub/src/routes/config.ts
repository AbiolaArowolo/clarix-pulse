import { Request, Response, Router } from 'express';
import { getAlertSettings, updateAlertSettings } from '../store/alertSettings';
import { getInstanceControls, updateInstanceControls } from '../store/instanceControls';
import { getMirroredNodeConfig, getMirroredPlayerConfig } from '../store/nodeConfigMirror';
import { enrollNode, getNode, getPlayer, resolveNodeIdForToken } from '../store/registry';

function bearerToken(req: Request): string | null {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
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
    recipient: chatId,
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

function validateEnrollmentKey(value: unknown): boolean {
  const expected = process.env.PULSE_ENROLLMENT_KEY?.trim();
  if (!expected) {
    return false;
  }

  return asString(value) === expected;
}

export function createConfigRouter(): Router {
  const router = Router();

  router.get('/player/:playerId', async (req: Request, res: Response) => {
    const mirrored = await getMirroredPlayerConfig(req.params.playerId);
    if (mirrored) {
      return res.json(mirrored);
    }

    const player = await getPlayer(req.params.playerId);
    if (!player) {
      return res.status(404).json({ error: 'Unknown player config.' });
    }

    return res.json({
      nodeId: player.nodeId,
      playerId: player.playerId,
      playoutType: player.playoutType,
      paths: {},
      processSelectors: {},
      logSelectors: {},
      udpInputs: [],
      updatedAt: player.updatedAt,
      sourcePath: 'hub://registry',
      source: 'hub',
    });
  });

  router.post('/player/:playerId', (_req: Request, res: Response) => {
    return res.status(409).json({
      error: 'This player is configured locally on the node. Open Pulse on the node to edit settings there.',
    });
  });

  router.get('/instance/:playerId/controls', async (req: Request, res: Response) => {
    const player = await getPlayer(req.params.playerId);
    if (!player) {
      return res.status(404).json({ error: 'Unknown player.' });
    }

    return res.json({
      instanceId: player.playerId,
      controls: getInstanceControls(player.playerId),
    });
  });

  router.post('/instance/:playerId/controls', async (req: Request, res: Response) => {
    const player = await getPlayer(req.params.playerId);
    if (!player) {
      return res.status(404).json({ error: 'Unknown player.' });
    }

    const monitoringEnabled = req.body && Object.prototype.hasOwnProperty.call(req.body, 'monitoringEnabled')
      ? asBool(req.body.monitoringEnabled, true)
      : undefined;
    const maintenanceMode = req.body && Object.prototype.hasOwnProperty.call(req.body, 'maintenanceMode')
      ? asBool(req.body.maintenanceMode, false)
      : undefined;

    const controls = await updateInstanceControls(player.playerId, {
      monitoringEnabled,
      maintenanceMode,
    });

    return res.json({
      ok: true,
      instanceId: player.playerId,
      controls,
    });
  });

  router.get('/alerts', async (_req: Request, res: Response) => {
    return res.json({
      settings: await getAlertSettings(),
      capabilities: {
        emailDeliveryConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
        telegramDeliveryConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        phoneDeliveryConfigured: false,
      },
    });
  });

  router.get('/alerts/telegram-targets', async (_req: Request, res: Response) => {
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

  router.post('/enroll', async (req: Request, res: Response) => {
    if (!process.env.PULSE_ENROLLMENT_KEY?.trim()) {
      return res.status(503).json({ error: 'Enrollment is not configured on this hub.' });
    }

    if (!validateEnrollmentKey(req.body?.enrollmentKey)) {
      return res.status(403).json({ error: 'Invalid enrollment key.' });
    }

    const nodeId = asString(req.body?.nodeId);
    const nodeName = asString(req.body?.nodeName, nodeId);
    const siteId = asString(req.body?.siteId, nodeId);
    const playersRaw: unknown[] = Array.isArray(req.body?.players) ? req.body.players : [];

    if (!nodeId) {
      return res.status(400).json({ error: 'nodeId is required.' });
    }
    if (playersRaw.length === 0) {
      return res.status(400).json({ error: 'At least one player is required for enrollment.' });
    }

    const players = playersRaw
      .map((entry: unknown) => {
        const record = entry && typeof entry === 'object' && !Array.isArray(entry)
          ? entry as Record<string, unknown>
          : {};
        const playoutType: 'insta' | 'admax' = asString(record.playoutType ?? record.playout_type, 'insta') === 'admax'
          ? 'admax'
          : 'insta';
        return {
          playerId: asString(record.playerId ?? record.player_id),
          playoutType,
          label: asString(record.label),
        };
      })
      .filter((entry: { playerId: string }) => entry.playerId);

    if (players.length === 0) {
      return res.status(400).json({ error: 'Enrollment did not include any valid player IDs.' });
    }

    const enrollment = await enrollNode({
      nodeId,
      nodeName,
      siteId,
      players,
    });

    return res.json({
      ok: true,
      nodeId: enrollment.nodeId,
      siteId: enrollment.siteId,
      agentToken: enrollment.agentToken,
      localUiUrl: 'http://127.0.0.1:3210/',
      players: enrollment.players,
      updatedAt: enrollment.updatedAt,
    });
  });

  router.get('/node', async (req: Request, res: Response) => {
    const token = bearerToken(req);
    const nodeId = token ? await resolveNodeIdForToken(token) : null;
    if (!nodeId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const node = await getNode(nodeId);
    const mirror = await getMirroredNodeConfig(nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Unknown node.' });
    }

    return res.json({
      nodeId: node.nodeId,
      siteId: node.siteId,
      nodeName: node.nodeName,
      commissioned: node.commissioned,
      localUiUrl: node.localUiUrl,
      updatedAt: node.updatedAt,
      mirror,
    });
  });

  return router;
}
