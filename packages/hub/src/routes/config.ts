import { Request, Response, Router } from 'express';
import {
  buildEnrollmentInput,
  buildMirrorPayload,
  normalizeRemoteSetupDraft,
  parseRemoteSetupReport,
  serializeAgentConfigYaml,
} from '../config/remoteSetup';
import { requireSession } from '../serverAuth';
import { findTenantByEnrollmentKey } from '../store/auth';
import { getAlertSettings, updateAlertSettings } from '../store/alertSettings';
import { getInstanceControls, updateInstanceControls } from '../store/instanceControls';
import { getMirroredNodeConfig, getMirroredPlayerConfig, updateMirroredNodeConfig } from '../store/nodeConfigMirror';
import { enrollNode, getNode, getPlayer, resolveNodeAuthForToken } from '../store/registry';

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

function requestBaseUrl(req: Request): string {
  const forwardedProto = asString(req.headers['x-forwarded-proto']);
  const forwardedHost = asString(req.headers['x-forwarded-host']);
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = req.get('host');
  if (!host) {
    return '';
  }

  return `${req.protocol}://${host}`;
}

export function createConfigRouter(): Router {
  const router = Router();

  router.post('/enroll', async (req: Request, res: Response) => {
    const tenant = await findTenantByEnrollmentKey(asString(req.body?.enrollmentKey));
    if (!tenant) {
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
        const playoutType = asString(record.playoutType ?? record.playout_type, 'insta') || 'insta';
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

    try {
      const enrollment = await enrollNode({
        tenantId: tenant.tenantId,
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
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Enrollment failed.',
      });
    }
  });

  router.get('/node', async (req: Request, res: Response) => {
    const token = bearerToken(req);
    const nodeAuth = token ? await resolveNodeAuthForToken(token) : null;
    if (!nodeAuth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const node = await getNode(nodeAuth.tenantId, nodeAuth.nodeId);
    const mirror = await getMirroredNodeConfig(nodeAuth.nodeId, nodeAuth.tenantId);
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

  router.use(requireSession);

  router.get('/player/:playerId', async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const mirrored = await getMirroredPlayerConfig(req.params.playerId, tenantId);
    if (mirrored) {
      return res.json(mirrored);
    }

    const player = await getPlayer(req.params.playerId, tenantId);
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
    const player = await getPlayer(req.params.playerId, req.auth!.tenantId);
    if (!player) {
      return res.status(404).json({ error: 'Unknown player.' });
    }

    return res.json({
      instanceId: player.playerId,
      controls: getInstanceControls(player.playerId),
    });
  });

  router.post('/instance/:playerId/controls', async (req: Request, res: Response) => {
    const player = await getPlayer(req.params.playerId, req.auth!.tenantId);
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

  router.get('/alerts', async (req: Request, res: Response) => {
    return res.json({
      settings: await getAlertSettings(req.auth!.tenantId),
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
      tenantId: req.auth!.tenantId,
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

  router.post('/remote/import-report', async (req: Request, res: Response) => {
    try {
      const reportText = asString(req.body?.reportText);
      const draft = parseRemoteSetupReport(reportText, asString(req.body?.hubUrl, requestBaseUrl(req)));
      return res.json({
        ok: true,
        draft,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to import discovery report.',
      });
    }
  });

  router.post('/remote/provision', async (req: Request, res: Response) => {
    try {
      const normalized = normalizeRemoteSetupDraft(
        req.body?.draft ?? req.body,
        requestBaseUrl(req),
      );
      const draft = {
        ...normalized,
        nodeId: normalized.nodeId.trim(),
        nodeName: normalized.nodeName.trim(),
        siteId: normalized.siteId.trim() || normalized.nodeId.trim(),
        hubUrl: normalized.hubUrl.trim() || requestBaseUrl(req),
        players: normalized.players
          .map((player) => ({
            ...player,
            playerId: player.playerId.trim(),
            label: player.label.trim(),
          }))
          .filter((player) => player.playerId),
      };

      if (!draft.nodeId) {
        return res.status(400).json({ error: 'Node ID is required.' });
      }
      if (!draft.nodeName) {
        return res.status(400).json({ error: 'Node name is required.' });
      }
      if (!draft.siteId) {
        return res.status(400).json({ error: 'Site ID is required.' });
      }
      if (!draft.hubUrl) {
        return res.status(400).json({ error: 'Hub URL is required.' });
      }
      if (draft.players.length === 0) {
        return res.status(400).json({ error: 'Add at least one player before provisioning.' });
      }

      const enrollment = await enrollNode({
        tenantId: req.auth!.tenantId,
        ...buildEnrollmentInput(draft),
      });
      await updateMirroredNodeConfig(req.auth!.tenantId, draft.nodeId, buildMirrorPayload(draft));

      for (const player of draft.players) {
        await updateInstanceControls(player.playerId, {
          monitoringEnabled: player.monitoringEnabled,
        });
      }

      const configYaml = serializeAgentConfigYaml(draft, enrollment.agentToken);

      return res.json({
        ok: true,
        nodeId: enrollment.nodeId,
        siteId: enrollment.siteId,
        agentToken: enrollment.agentToken,
        localUiUrl: 'http://127.0.0.1:3210/',
        configYaml,
        downloadFileName: `${draft.nodeId}-pulse-config.yaml`,
        players: draft.players.map((player) => ({
          playerId: player.playerId,
          monitoringEnabled: player.monitoringEnabled,
          playoutType: player.playoutType,
        })),
        updatedAt: enrollment.updatedAt,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to provision remote node setup.',
      });
    }
  });

  return router;
}
