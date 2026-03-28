import nodemailer from 'nodemailer';
import { BroadcastHealth, RuntimeHealth } from '../store/db';
import { getAlertSettings } from '../store/alertSettings';
import { isAlertingSuppressed } from '../store/instanceControls';
import { getPlayer } from '../store/registry';
import { logEvent, wasAlertSentForCurrentIncident } from '../store/state';

interface AlertContext {
  instanceId: string;
  instanceLabel: string;
  siteName?: string;
  nodeId?: string;
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  previousBroadcast: BroadcastHealth | undefined;
  observations: Record<string, unknown>;
}

interface TelegramResolvedTarget {
  chatId: string;
  username: string;
}

interface AlertMessage {
  subject: string;
  body: string;
}

function normalizeTelegramRecipient(value: string): string {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

function isNumericTelegramChatId(value: string): boolean {
  return /^-?\d+$/.test(value.trim());
}

async function listTelegramTargets(token: string): Promise<TelegramResolvedTarget[]> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    if (!response.ok) {
      return [];
    }

    const payload = await response.json() as { result?: Array<Record<string, unknown>> };
    const updates = Array.isArray(payload.result) ? payload.result : [];
    const targets = new Map<string, TelegramResolvedTarget>();

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

      const chatId = typeof chat.id === 'string' || typeof chat.id === 'number'
        ? String(chat.id)
        : '';
      const username = typeof chat.username === 'string'
        ? normalizeTelegramRecipient(chat.username)
        : '';
      if (!chatId || !username) continue;

      targets.set(username, { chatId, username });
    }

    return Array.from(targets.values());
  } catch {
    return [];
  }
}

async function sendTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const settings = await getAlertSettings();
  if (!settings.telegramEnabled) return;
  if (settings.telegramChatIds.length === 0) return;

  const discoveredTargets = await listTelegramTargets(token);
  const targetByUsername = new Map(
    discoveredTargets.map((target) => [target.username, target.chatId]),
  );

  for (const recipient of settings.telegramChatIds) {
    const trimmedRecipient = recipient.trim();
    if (!trimmedRecipient) continue;

    const resolvedChatId = isNumericTelegramChatId(trimmedRecipient)
      ? trimmedRecipient
      : targetByUsername.get(normalizeTelegramRecipient(trimmedRecipient)) ?? trimmedRecipient;

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: resolvedChatId, text: message, parse_mode: 'HTML' }),
      });

      const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
      if (!response.ok || payload?.ok === false) {
        console.error(
          `[alerting] Telegram send failed for recipient ${trimmedRecipient}: ${payload?.description ?? response.statusText}`,
        );
      }
    } catch (err) {
      console.error(`[alerting] Telegram send failed for recipient ${trimmedRecipient}:`, err);
    }
  }
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatToken(token: string): string {
  switch (token) {
    case 'paused':
      return 'player log reported Paused';
    case 'fully_played':
      return 'player log reported Fully Played';
    case 'skipped':
      return 'player log reported Skipped';
    case 'stopxxx2':
      return 'player log reported a stop event';
    case 'app_exited':
      return 'player log reported application exit';
    case 'reinit':
      return 'player log reported player reinitialization';
    default:
      return `player log token: ${token}`;
  }
}

function deriveLikelyCauses(ctx: AlertContext): string[] {
  const reasons: string[] = [];
  const observations = ctx.observations;
  const runtimeRaw = asText(observations.insta_runningstatus_raw);
  const logToken = asText(observations.log_last_token);
  const udpInputCount = asNumber(observations.udp_input_count) ?? 0;
  const udpHealthyInputCount = asNumber(observations.udp_healthy_input_count) ?? 0;
  const udpSelectedInputId = asText(observations.udp_selected_input_id);
  const outputSignalPresent = asNumber(observations.output_signal_present);
  const fnfNewEntries = asNumber(observations.fnf_new_entries) ?? 0;
  const playlistscanNewEntries = asNumber(observations.playlistscan_new_entries) ?? 0;
  const filebarDelta60 = asNumber(observations.filebar_position_delta_60s);
  const frameDelta60 = asNumber(observations.frame_delta_60s);

  if (ctx.runtimeHealth === 'paused') {
    reasons.push('The player reported PAUSED on the node.');
  } else if (ctx.runtimeHealth === 'stopped') {
    reasons.push('The player reported STOPPED on the node.');
  } else if (ctx.runtimeHealth === 'stalled') {
    reasons.push('Playback stopped advancing on the node.');
  } else if (ctx.runtimeHealth === 'content_error') {
    reasons.push('The node detected a content or playlist error.');
  } else if (ctx.runtimeHealth === 'restarting') {
    reasons.push('The player is restarting on the node.');
  }

  if (filebarDelta60 === 0 || frameDelta60 === 0) {
    reasons.push('Playback position did not advance during the last minute.');
  }

  if (fnfNewEntries > 0 || playlistscanNewEntries > 0) {
    const parts: string[] = [];
    if (fnfNewEntries > 0) {
      parts.push(`FNF log activity: ${fnfNewEntries}`);
    }
    if (playlistscanNewEntries > 0) {
      parts.push(`playlist scan activity: ${playlistscanNewEntries}`);
    }
    reasons.push(`Local error logs changed on the node (${parts.join(', ')}).`);
  }

  if (udpInputCount > 0) {
    if (udpHealthyInputCount === 0) {
      reasons.push(
        `Enabled stream monitoring is unhealthy (0/${udpInputCount} healthy${udpSelectedInputId ? `, selected input ${udpSelectedInputId}` : ''}).`,
      );
    } else if (udpHealthyInputCount < udpInputCount) {
      reasons.push(`Some enabled streams are unhealthy (${udpHealthyInputCount}/${udpInputCount} healthy).`);
    }
  }

  if (outputSignalPresent === 0) {
    reasons.push('The selected stream is not currently present.');
  }

  if (logToken) {
    reasons.push(`Latest node log signal: ${formatToken(logToken)}.`);
  }

  if (runtimeRaw) {
    reasons.push(`Local running status: ${runtimeRaw}.`);
  }

  return Array.from(new Set(reasons));
}

function buildAlertMessage(
  prefix: 'RECOVERED' | 'NETWORK ISSUE' | 'OFF AIR' | 'OFF AIR LIKELY',
  ctx: AlertContext,
): AlertMessage {
  const siteName = ctx.siteName ?? ctx.instanceLabel;
  const nodeId = ctx.nodeId ?? 'unknown-node';
  const playerId = ctx.instanceId;
  const causes = deriveLikelyCauses(ctx);
  const bodyLines = [
    `Pulse Alert: ${prefix}`,
    `Time: ${new Date().toISOString()}`,
    `Site: ${siteName}`,
    `Node: ${nodeId}`,
    `Player: ${playerId}`,
    `Label: ${ctx.instanceLabel}`,
    `Broadcast health: ${ctx.broadcastHealth}`,
    `Runtime health: ${ctx.runtimeHealth}`,
  ];

  if (causes.length > 0) {
    bodyLines.push('', 'Likely cause(s):');
    for (const cause of causes) {
      bodyLines.push(`- ${cause}`);
    }
  } else {
    bodyLines.push('', 'Likely cause(s):', '- No specific node-side cause was available in the latest heartbeat.');
  }

  return {
    subject: `${prefix}: ${ctx.instanceLabel} [${nodeId}]`,
    body: bodyLines.join('\n'),
  };
}

async function sendEmail(subject: string, body: string): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;

  const settings = await getAlertSettings();
  if (!settings.emailEnabled) return;
  if (settings.emailRecipients.length === 0) return;

  try {
    await getTransporter().sendMail({
      from: {
        name: process.env.SMTP_FROM_NAME ?? 'Pulse Alerts',
        address: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      },
      to: settings.emailRecipients.join(', '),
      subject,
      text: body,
    });
  } catch (err) {
    console.error('[alerting] Email send failed:', err);
  }
}

function isCritical(broadcastHealth: BroadcastHealth): boolean {
  return broadcastHealth === 'off_air_confirmed' || broadcastHealth === 'off_air_likely';
}

function isRecovery(prev: BroadcastHealth | undefined, current: BroadcastHealth): boolean {
  if (!prev) return false;
  return isCritical(prev) && current === 'healthy';
}

export async function evaluateAlert(ctx: AlertContext): Promise<void> {
  const { instanceId, broadcastHealth, runtimeHealth, previousBroadcast, observations } = ctx;

  if (isAlertingSuppressed(instanceId)) {
    await logEvent(
      instanceId,
      'state_change_suppressed',
      { broadcastHealth: previousBroadcast ?? 'unknown' },
      { broadcastHealth, runtimeHealth },
      observations,
      false,
    );
    return;
  }

  if (isRecovery(previousBroadcast, broadcastHealth)) {
    const alert = buildAlertMessage('RECOVERED', {
      ...ctx,
      broadcastHealth: 'healthy',
      runtimeHealth,
    });
    console.log(`[alert] RECOVERY ${instanceId}`);
    await sendTelegram(alert.body);
    await sendEmail(alert.subject, alert.body);
    await logEvent(
      instanceId,
      'alert_recovered',
      { broadcastHealth: previousBroadcast },
      { broadcastHealth, runtimeHealth },
      observations,
      true,
    );
    return;
  }

  if (isCritical(broadcastHealth)) {
    if (await wasAlertSentForCurrentIncident(instanceId, broadcastHealth)) return;

    const label = broadcastHealth === 'off_air_confirmed' ? 'OFF AIR' : 'OFF AIR LIKELY';
    const alert = buildAlertMessage(label, ctx);
    console.log(`[alert] CRITICAL ${instanceId} - ${broadcastHealth}`);
    await sendTelegram(alert.body);
    await sendEmail(alert.subject, alert.body);
    await logEvent(
      instanceId,
      'state_change',
      { broadcastHealth: previousBroadcast ?? 'unknown' },
      { broadcastHealth, runtimeHealth },
      observations,
      true,
    );
    return;
  }

  await logEvent(
    instanceId,
    'state_change',
    { broadcastHealth: previousBroadcast ?? 'unknown' },
    { broadcastHealth, runtimeHealth },
    observations,
    false,
  );
}

export async function sendNetworkIssueAlert(instanceId: string, instanceLabel: string): Promise<void> {
  if (isAlertingSuppressed(instanceId)) return;

  const player = await getPlayer(instanceId);
  const alert = buildAlertMessage('NETWORK ISSUE', {
    instanceId,
    instanceLabel,
    siteName: player?.siteName,
    nodeId: player?.nodeId,
    broadcastHealth: 'unknown',
    runtimeHealth: 'unknown',
    previousBroadcast: undefined,
    observations: {},
  });

  console.log(`[alert] NETWORK ISSUE ${instanceId}`);
  await sendTelegram(alert.body);
  await sendEmail(alert.subject, `${alert.body}\n- Heartbeat missing, so the latest playback state is unknown.`);
}
