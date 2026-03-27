import nodemailer from 'nodemailer';
import { BroadcastHealth, RuntimeHealth } from '../store/db';
import { wasAlertSentForCurrentIncident, logEvent } from '../store/state';
import { getAlertSettings } from '../store/alertSettings';


interface AlertContext {
  instanceId: string;
  instanceLabel: string;
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  previousBroadcast: BroadcastHealth | undefined;
  observations: Record<string, unknown>;
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const settings = await getAlertSettings();
  if (settings.telegramChatIds.length === 0) return;

  for (const chatId of settings.telegramChatIds) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
      });
    } catch (err) {
      console.error(`[alerting] Telegram send failed for chat ${chatId}:`, err);
    }
  }
}

// ─── Email ───────────────────────────────────────────────────────────────────

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

async function sendEmail(subject: string, body: string): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;

  const settings = await getAlertSettings();
  if (settings.emailRecipients.length === 0) return;

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM ?? 'alerts@example.com',
      to: settings.emailRecipients.join(', '),
      subject,
      text: body,
    });
  } catch (err) {
    console.error('[alerting] Email send failed:', err);
  }
}

// ─── Alert logic ─────────────────────────────────────────────────────────────

function isCritical(broadcastHealth: BroadcastHealth): boolean {
  return broadcastHealth === 'off_air_confirmed' || broadcastHealth === 'off_air_likely';
}

function isRecovery(prev: BroadcastHealth | undefined, current: BroadcastHealth): boolean {
  if (!prev) return false;
  return isCritical(prev) && current === 'healthy';
}

export async function evaluateAlert(ctx: AlertContext): Promise<void> {
  const { instanceId, instanceLabel, broadcastHealth, runtimeHealth, previousBroadcast, observations } = ctx;

  const stateJson = JSON.stringify({ broadcastHealth, runtimeHealth });

  // Recovery alert
  if (isRecovery(previousBroadcast, broadcastHealth)) {
    const msg = `✅ RECOVERED: ${instanceLabel}\nBroadcast health restored to HEALTHY.`;
    console.log(`[alert] RECOVERY ${instanceId}`);
    await sendTelegram(msg);
    await sendEmail(`RECOVERED: ${instanceLabel}`, msg);
    await logEvent(instanceId, 'alert_recovered',
      { broadcastHealth: previousBroadcast },
      { broadcastHealth, runtimeHealth },
      observations, true
    );
    return;
  }

  // Critical alert — check dedup
  if (isCritical(broadcastHealth)) {
    if (await wasAlertSentForCurrentIncident(instanceId, broadcastHealth)) return; // already alerted

    const label = broadcastHealth === 'off_air_confirmed' ? '🔴 OFF AIR' : '🟠 OFF AIR LIKELY';
    const msg = `${label}: ${instanceLabel}\nBroadcast: ${broadcastHealth}\nRuntime: ${runtimeHealth}`;
    console.log(`[alert] CRITICAL ${instanceId} — ${broadcastHealth}`);
    await sendTelegram(msg);
    await sendEmail(`${label}: ${instanceLabel}`, msg);
    await logEvent(instanceId, 'state_change',
      { broadcastHealth: previousBroadcast ?? 'unknown' },
      { broadcastHealth, runtimeHealth },
      observations, true
    );
    return;
  }

  // Log state change without alert
  await logEvent(instanceId, 'state_change',
    { broadcastHealth: previousBroadcast ?? 'unknown' },
    { broadcastHealth, runtimeHealth },
    observations, false
  );
}

export async function sendNetworkIssueAlert(instanceId: string, instanceLabel: string): Promise<void> {
  const msg = `⚠️ NETWORK ISSUE: ${instanceLabel}\nHeartbeat missing — playback state unknown.`;
  console.log(`[alert] NETWORK ISSUE ${instanceId}`);
  await sendTelegram(msg);
  await sendEmail(`NETWORK ISSUE: ${instanceLabel}`, msg);
}
