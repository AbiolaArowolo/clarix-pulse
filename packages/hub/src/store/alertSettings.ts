import { db } from './db';

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
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .slice(0, MAX_CONTACTS_PER_CHANNEL);
  } catch {
    return [];
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeToken(value: string): string {
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

function normalizeList(
  values: unknown,
  normalize: (value: string) => string
): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const deduped = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const cleaned = normalize(value);
    if (!cleaned || deduped.has(cleaned)) {
      continue;
    }

    deduped.add(cleaned);
    normalized.push(cleaned);

    if (normalized.length >= MAX_CONTACTS_PER_CHANNEL) {
      break;
    }
  }

  return normalized;
}

function rowToAlertSettings(row: Record<string, unknown>): AlertSettings {
  return {
    emailRecipients: parseStoredList(row.email_recipients),
    telegramChatIds: parseStoredList(row.telegram_chat_ids),
    phoneNumbers: parseStoredList(row.phone_numbers),
    emailEnabled: asBool(row.email_enabled, true),
    telegramEnabled: asBool(row.telegram_enabled, true),
    phoneEnabled: asBool(row.phone_enabled, true),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

export async function getAlertSettings(): Promise<AlertSettings> {
  const result = await db.execute('SELECT * FROM alert_settings WHERE id = 1');
  if (result.rows.length === 0) {
    const timestamp = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO alert_settings
              (id, email_recipients, telegram_chat_ids, phone_numbers, updated_at)
            VALUES (1, '[]', '[]', '[]', ?)`,
      args: [timestamp],
    });

    return {
      emailRecipients: [],
      telegramChatIds: [],
      phoneNumbers: [],
      emailEnabled: true,
      telegramEnabled: true,
      phoneEnabled: true,
      updatedAt: timestamp,
    };
  }

  return rowToAlertSettings(result.rows[0] as Record<string, unknown>);
}

export async function updateAlertSettings(input: {
  emailRecipients?: unknown;
  telegramChatIds?: unknown;
  phoneNumbers?: unknown;
  emailEnabled?: unknown;
  telegramEnabled?: unknown;
  phoneEnabled?: unknown;
}): Promise<AlertSettings> {
  const next: AlertSettings = {
    emailRecipients: normalizeList(input.emailRecipients, normalizeEmail),
    telegramChatIds: normalizeList(input.telegramChatIds, normalizeToken),
    phoneNumbers: normalizeList(input.phoneNumbers, normalizePhone),
    emailEnabled: asBool(input.emailEnabled, true),
    telegramEnabled: asBool(input.telegramEnabled, true),
    phoneEnabled: asBool(input.phoneEnabled, true),
    updatedAt: new Date().toISOString(),
  };

  await db.execute({
    sql: `INSERT INTO alert_settings
            (id, email_recipients, telegram_chat_ids, phone_numbers, email_enabled, telegram_enabled, phone_enabled, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            email_recipients = excluded.email_recipients,
            telegram_chat_ids = excluded.telegram_chat_ids,
            phone_numbers = excluded.phone_numbers,
            email_enabled = excluded.email_enabled,
            telegram_enabled = excluded.telegram_enabled,
            phone_enabled = excluded.phone_enabled,
            updated_at = excluded.updated_at`,
    args: [
      JSON.stringify(next.emailRecipients),
      JSON.stringify(next.telegramChatIds),
      JSON.stringify(next.phoneNumbers),
      next.emailEnabled ? 1 : 0,
      next.telegramEnabled ? 1 : 0,
      next.phoneEnabled ? 1 : 0,
      next.updatedAt,
    ],
  });

  return next;
}
