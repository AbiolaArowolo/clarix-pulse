import { Request, Response, Router } from 'express';
import { Server as SocketServer } from 'socket.io';
import {
  buildEnrollmentInput,
  buildMirrorPayload,
  normalizeRemoteSetupDraft,
  parseRemoteSetupReport,
  serializeAgentConfigYaml,
} from '../config/remoteSetup';
import { requireSession } from '../serverAuth';
import { createBundleDownloadLink, createInstallHandoffLink, createNodeConfigDownloadLink, verifyDownloadToken } from '../services/downloadTokens';
import { appendAdminAuditEvent, findTenantByEnrollmentKey, getTenantAccessSummary, getTenantEnrollmentKey } from '../store/auth';
import { getAlertSettings, updateAlertSettings } from '../store/alertSettings';
import { getInstanceControls, updateInstanceControls } from '../store/instanceControls';
import { getMirroredNodeConfig, getMirroredPlayerConfig, updateMirroredNodeConfig, updateMirroredPlayerStreamUrl } from '../store/nodeConfigMirror';
import { enrollNode, getActiveAgentToken, getNode, getPlayer, removeNode, resolveNodeAuthForAnyToken, resolveNodeAuthForToken } from '../store/registry';

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

function tenantAccessError(input: {
  enabled: boolean;
  disabledReason: string | null;
  accessKeyExpiresAt: string | null;
}): string | null {
  if (!input.enabled) {
    return input.disabledReason?.trim() || 'Workspace access is currently disabled.';
  }

  if (input.accessKeyExpiresAt) {
    const expiry = new Date(input.accessKeyExpiresAt);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) {
      return 'Workspace access has expired.';
    }
  }

  return null;
}

function isLocalStreamUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol === 'udp:') return true;
    const privateRanges = [
      /^127\./,
      /^localhost$/i,
      /^192\.168\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^22[4-9]\./,
      /^23[0-9]\./,
    ];
    return privateRanges.some((r) => r.test(hostname));
  } catch {
    return false;
  }
}

function emitRemovedPlayers(io: SocketServer, tenantId: string, nodeId: string, playerIds: readonly string[]): void {
  for (const playerId of playerIds) {
    io.to(`tenant:${tenantId}`).emit('player_removed', { playerId, nodeId });
  }
}

function emitNodeRemoved(io: SocketServer, tenantId: string, nodeId: string): void {
  io.to(`tenant:${tenantId}`).emit('node_removed', { nodeId });
}

export function createConfigRouter(io: SocketServer): Router {
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

  router.post('/node/mirror', async (req: Request, res: Response) => {
    const token = bearerToken(req);
    const nodeAuth = token ? await resolveNodeAuthForToken(token) : null;
    if (!nodeAuth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const mirrorUpdate = await updateMirroredNodeConfig(nodeAuth.tenantId, nodeAuth.nodeId, req.body);
      if (!mirrorUpdate) {
        return res.status(400).json({ error: 'Invalid mirrored node payload.' });
      }

      emitRemovedPlayers(io, nodeAuth.tenantId, nodeAuth.nodeId, mirrorUpdate.removedPlayerIds);

      return res.json({
        ok: true,
        nodeId: nodeAuth.nodeId,
        removedPlayerIds: mirrorUpdate.removedPlayerIds,
        updatedAt: mirrorUpdate.config.updatedAt,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to update mirrored node config.',
      });
    }
  });

  router.post('/node/decommission', async (req: Request, res: Response) => {
    const token = bearerToken(req);
    const tokenAuth = token ? await resolveNodeAuthForToken(token) : null;
    const tokenAnyAuth = !tokenAuth && token ? await resolveNodeAuthForAnyToken(token) : null;
    const requestedNodeId = asString(req.body?.nodeId ?? req.body?.node_id);

    let tenantId = tokenAuth?.tenantId ?? '';
    let nodeId = tokenAuth?.nodeId ?? requestedNodeId;

    // Allow decommission with an inactive historical token only when the
    // request explicitly names the same nodeId. This keeps uninstall resilient
    // after token rotation while still constraining scope.
    if (!tokenAuth && tokenAnyAuth && requestedNodeId && tokenAnyAuth.nodeId === requestedNodeId) {
      tenantId = tokenAnyAuth.tenantId;
      nodeId = tokenAnyAuth.nodeId;
    } else if (!tokenAuth) {
      const enrollmentKey = asString(req.body?.enrollmentKey ?? req.body?.enrollment_key);
      if (!requestedNodeId || !enrollmentKey) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const tenant = await findTenantByEnrollmentKey(enrollmentKey);
      if (!tenant) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      tenantId = tenant.tenantId;
      nodeId = requestedNodeId;
    }

    if (!tenantId || !nodeId) {
      return res.status(400).json({ error: 'nodeId is required.' });
    }

    const node = await getNode(tenantId, nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Unknown node.' });
    }

    const removal = await removeNode(nodeId, tenantId);
    emitRemovedPlayers(io, tenantId, nodeId, removal.removedPlayerIds);
    emitNodeRemoved(io, tenantId, nodeId);

    return res.json({
      ok: true,
      nodeId,
      removedPlayerIds: removal.removedPlayerIds,
    });
  });

  router.get('/remote/install-handoff', async (req: Request, res: Response) => {
    const token = asString(req.query.token);
    const claims = token ? verifyDownloadToken(token) : null;
    if (!claims || claims.kind !== 'install-handoff') {
      return res.status(401).json({ error: 'A valid install handoff link is required.' });
    }

    const tenant = await getTenantAccessSummary(claims.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Unknown workspace.' });
    }

    const accessError = tenantAccessError({
      enabled: tenant.enabled,
      disabledReason: tenant.disabledReason,
      accessKeyExpiresAt: tenant.accessKeyExpiresAt,
    });
    if (accessError) {
      return res.status(403).json({ error: accessError });
    }

    const node = await getNode(claims.tenantId, claims.nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Unknown node.' });
    }

    const mirror = await getMirroredNodeConfig(claims.nodeId, claims.tenantId);
    if (!mirror) {
      return res.status(404).json({ error: 'No mirrored config is available for this node.' });
    }

    if (mirror.updatedAt !== claims.mirrorUpdatedAt) {
      return res.status(409).json({ error: 'This handoff link is stale. Generate a fresh one from the dashboard.' });
    }

    const baseUrl = requestBaseUrl(req);
    const installerBundleName = (process.env.PULSE_DOWNLOAD_BUNDLE_NAME ?? '').trim() || 'clarix-pulse-latest.zip';
    const installerLink = createBundleDownloadLink({
      baseUrl,
      tenantId: claims.tenantId,
      fileName: installerBundleName,
      expiresAt: claims.expiresAt,
    });
    const configLink = createNodeConfigDownloadLink({
      baseUrl,
      tenantId: claims.tenantId,
      nodeId: claims.nodeId,
      fileName: `${claims.nodeId}-pulse-config.yaml`,
      agentToken: claims.agentToken,
      mirrorUpdatedAt: claims.mirrorUpdatedAt,
      expiresAt: claims.expiresAt,
    });

    await appendAdminAuditEvent({
      actorUserId: null,
      actorEmail: 'public-install-handoff',
      targetTenantId: claims.tenantId,
      action: 'install_handoff_link_opened',
      details: {
        nodeId: node.nodeId,
        nodeName: node.nodeName,
        siteId: node.siteId,
        expiresAt: claims.expiresAt,
      },
    });

    return res.json({
      ok: true,
      tenant: {
        tenantId: tenant.tenantId,
        name: tenant.tenantName,
        slug: tenant.tenantSlug,
      },
      node: {
        nodeId: node.nodeId,
        nodeName: node.nodeName,
        siteId: node.siteId,
      },
      handoff: {
        expiresAt: claims.expiresAt,
        installerUrl: installerLink.url,
        configUrl: configLink.url,
      },
      metrics: {
        openedEvent: 'install_handoff_link_opened',
      },
    });
  });

  router.use(requireSession);

  router.post('/remote/install-handoff-link', async (req: Request, res: Response) => {
    const nodeId = asString(req.body?.nodeId);
    if (!nodeId) {
      return res.status(400).json({ error: 'nodeId is required.' });
    }

    const node = await getNode(req.auth!.tenantId, nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Unknown node.' });
    }

    const mirror = await getMirroredNodeConfig(node.nodeId, req.auth!.tenantId);
    if (!mirror) {
      return res.status(404).json({ error: 'No mirrored config is available for this node yet.' });
    }

    const agentToken = await getActiveAgentToken(node.nodeId, req.auth!.tenantId);
    if (!agentToken) {
      return res.status(409).json({ error: 'No active agent token is available for this node.' });
    }

    try {
      const link = createInstallHandoffLink({
        baseUrl: requestBaseUrl(req),
        tenantId: req.auth!.tenantId,
        nodeId: node.nodeId,
        agentToken,
        mirrorUpdatedAt: mirror.updatedAt,
      });

      await appendAdminAuditEvent({
        actorUserId: req.auth!.userId,
        actorEmail: req.auth!.email,
        targetTenantId: req.auth!.tenantId,
        action: 'install_handoff_link_created',
        details: {
          nodeId: node.nodeId,
          nodeName: node.nodeName,
          siteId: node.siteId,
          expiresAt: link.expiresAt,
        },
      });

      return res.json({
        ok: true,
        nodeId: node.nodeId,
        nodeName: node.nodeName,
        url: link.url,
        expiresAt: link.expiresAt,
        metrics: {
          createdEvent: 'install_handoff_link_created',
          openedEvent: 'install_handoff_link_opened',
        },
      });
    } catch (error) {
      return res.status(503).json({
        error: error instanceof Error ? error.message : 'Install handoff links are not configured on this server.',
      });
    }
  });

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

  router.patch('/player/:playerId', async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const { playerId } = req.params;

    const udpInputId = asString(req.body?.udpInputId);
    const streamUrl = asString(req.body?.stream_url);

    if (!udpInputId) {
      return res.status(400).json({ error: 'udpInputId is required.' });
    }
    if (!streamUrl) {
      return res.status(400).json({ error: 'stream_url is required.' });
    }
    if (!isLocalStreamUrl(streamUrl)) {
      return res.status(422).json({
        error: 'Stream URL must be on the node\'s local network (private IP, localhost, UDP multicast, or HTTP stream from local address).',
      });
    }

    const player = await getPlayer(playerId, tenantId);
    if (!player) {
      return res.status(404).json({ error: 'Unknown player.' });
    }

    const result = await updateMirroredPlayerStreamUrl(playerId, tenantId, udpInputId, streamUrl);
    if (!result.ok) {
      return res.status(404).json({ error: result.error ?? 'Failed to update stream URL.' });
    }

    return res.json({ ok: true, playerId, udpInputId, stream_url: streamUrl });
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
        emailDeliveryConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
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
        emailDeliveryConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
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
      const mirroredUpdate = await updateMirroredNodeConfig(req.auth!.tenantId, draft.nodeId, buildMirrorPayload(draft));
      const mirrored = mirroredUpdate?.config ?? null;
      emitRemovedPlayers(io, req.auth!.tenantId, draft.nodeId, mirroredUpdate?.removedPlayerIds ?? []);

      for (const player of draft.players) {
        await updateInstanceControls(player.playerId, {
          monitoringEnabled: player.monitoringEnabled,
        });
      }

      const enrollmentKey = await getTenantEnrollmentKey(req.auth!.tenantId);
      const configYaml = serializeAgentConfigYaml(draft, enrollment.agentToken, enrollmentKey);
      let configPullUrl: string | null = null;
      let configPullExpiresAt: string | null = null;
      if (mirrored) {
        try {
          const signedLink = createNodeConfigDownloadLink({
            baseUrl: requestBaseUrl(req),
            tenantId: req.auth!.tenantId,
            nodeId: draft.nodeId,
            fileName: `${draft.nodeId}-pulse-config.yaml`,
            agentToken: enrollment.agentToken,
            mirrorUpdatedAt: mirrored.updatedAt,
          });
          configPullUrl = signedLink.url;
          configPullExpiresAt = signedLink.expiresAt;
        } catch {
          configPullUrl = null;
          configPullExpiresAt = null;
        }
      }

      return res.json({
        ok: true,
        nodeId: enrollment.nodeId,
        siteId: enrollment.siteId,
        agentToken: enrollment.agentToken,
        localUiUrl: 'http://127.0.0.1:3210/',
        configYaml,
        downloadFileName: `${draft.nodeId}-pulse-config.yaml`,
        configPullUrl,
        configPullExpiresAt,
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

  router.delete('/remote/node/:nodeId', async (req: Request, res: Response) => {
    const nodeId = asString(req.params.nodeId);
    if (!nodeId) {
      return res.status(400).json({ error: 'nodeId is required.' });
    }

    const node = await getNode(req.auth!.tenantId, nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Unknown node.' });
    }

    const removal = await removeNode(nodeId, req.auth!.tenantId);
    if (!removal.removed) {
      return res.status(409).json({ error: 'Node could not be removed.' });
    }

    emitRemovedPlayers(io, req.auth!.tenantId, nodeId, removal.removedPlayerIds);
    emitNodeRemoved(io, req.auth!.tenantId, nodeId);
    await appendAdminAuditEvent({
      actorUserId: req.auth!.userId,
      actorEmail: req.auth!.email,
      targetTenantId: req.auth!.tenantId,
      action: 'node_removed',
      details: {
        nodeId,
        nodeName: node.nodeName,
        siteId: node.siteId,
        removedPlayerCount: removal.removedPlayerIds.length,
      },
    });

    return res.json({
      ok: true,
      nodeId,
      removedPlayerIds: removal.removedPlayerIds,
    });
  });

  return router;
}
