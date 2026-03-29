import { exec, queryOne } from './db';

export interface AlertSettings {
  emailRecipients: string[];
  telegramChatIds: string[];
  phoneNumbers: string[];
  emailEnabled: boolean;
  telegramEnabled: boolean;
  phoneEnabled: boolean;
  updatedAt: string | null;
}

const MAX_CONTACTS_PER_CHANNEL = 3;

function parseStoredList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parseStoredList(parsed) : [];
    } catch {
      return [];
    }
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_CONTACTS_PER_CHANNEL);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTelegramRecipient(value: string): string {
  return value.trim();
}

function normalizePhone(value: string): string {
  return value.trim();
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return fallback;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeList(values: unknown, normalize: (value: string) => string): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;

    const cleaned = normalize(value);
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);

    if (normalized.length >= MAX_CONTACTS_PER_CHANNEL) {
      break;
    }
  }

  return normalized;
}

function rowToSettings(row: Record<string, unknown>): AlertSettings {
  return {
    emailRecipients: parseStoredList(row.email_recipients),
    telegramChatIds: parseStoredList(row.telegram_chat_ids),
    phoneNumbers: parseStoredList(row.phone_numbers),
    emailEnabled: asBool(row.email_enabled, true),
    telegramEnabled: asBool(row.telegram_enabled, true),
    phoneEnabled: asBool(row.phone_enabled, true),
    updatedAt: toIso(row.updated_at as Date | string | null | undefined),
  };
}

async function ensureTenantAlertSettings(tenantId: string): Promise<AlertSettings> {
  const tenant = await queryOne<Record<string, unknown>>(`
    SELECT default_alert_email
    FROM tenants
    WHERE tenant_id = $1
  `, [tenantId]);

  const defaultEmail = typeof tenant?.default_alert_email === 'string'
    ? normalizeEmail(tenant.default_alert_email)
    : '';
  const row = await queryOne<Record<string, unknown>>(`
    SELECT
      email_recipients,
      telegram_chat_ids,
      phone_numbers,
      email_enabled,
      telegram_enabled,
      phone_enabled,
      updated_at
    FROM tenant_alert_settings
    WHERE tenant_id = $1
  `, [tenantId]);

  if (row) {
    return rowToSettings(row);
  }

  const timestamp = new Date().toISOString();
  await exec(`
    INSERT INTO tenant_alert_settings (
      tenant_id, email_recipients, telegram_chat_ids, phone_numbers,
      email_enabled, telegram_enabled, phone_enabled, updated_at
    )
    VALUES ($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, TRUE, TRUE, TRUE, $3)
    ON CONFLICT (tenant_id) DO NOTHING
  `, [tenantId, JSON.stringify(defaultEmail ? [defaultEmail] : []), timestamp]);

  return {
    emailRecipients: defaultEmail ? [defaultEmail] : [],
    telegramChatIds: [],
    phoneNumbers: [],
    emailEnabled: true,
    telegramEnabled: true,
    phoneEnabled: true,
    updatedAt: timestamp,
  };
}

export async function getAlertSettings(tenantId: string): Promise<AlertSettings> {
  return ensureTenantAlertSettings(tenantId);
}

export async function updateAlertSettings(input: {
  tenantId: string;
  emailRecipients?: unknown;
  telegramChatIds?: unknown;
  phoneNumbers?: unknown;
  emailEnabled?: unknown;
  telegramEnabled?: unknown;
  phoneEnabled?: unknown;
}): Promise<AlertSettings> {
  await ensureTenantAlertSettings(input.tenantId);

  const next: AlertSettings = {
    emailRecipients: normalizeList(input.emailRecipients, normalizeEmail),
    telegramChatIds: normalizeList(input.telegramChatIds, normalizeTelegramRecipient),
    phoneNumbers: normalizeList(input.phoneNumbers, normalizePhone),
    emailEnabled: asBool(input.emailEnabled, true),
    telegramEnabled: asBool(input.telegramEnabled, true),
    phoneEnabled: asBool(input.phoneEnabled, true),
    updatedAt: new Date().toISOString(),
  };

  await exec(`
    INSERT INTO tenant_alert_settings (
      tenant_id,
      email_recipients,
      telegram_chat_ids,
      phone_numbers,
      email_enabled,
      telegram_enabled,
      phone_enabled,
      updated_at
    )
    VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7, $8)
    ON CONFLICT (tenant_id) DO UPDATE SET
      email_recipients = EXCLUDED.email_recipients,
      telegram_chat_ids = EXCLUDED.telegram_chat_ids,
      phone_numbers = EXCLUDED.phone_numbers,
      email_enabled = EXCLUDED.email_enabled,
      telegram_enabled = EXCLUDED.telegram_enabled,
      phone_enabled = EXCLUDED.phone_enabled,
      updated_at = EXCLUDED.updated_at
  `, [
    input.tenantId,
    JSON.stringify(next.emailRecipients),
    JSON.stringify(next.telegramChatIds),
    JSON.stringify(next.phoneNumbers),
    next.emailEnabled,
    next.telegramEnabled,
    next.phoneEnabled,
    next.updatedAt,
  ]);

  return next;
}
