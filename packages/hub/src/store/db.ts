import { createClient, Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const repoRoot = path.resolve(__dirname, '../../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

const DEFAULT_DATA_DIR = path.join(__dirname, '../../data');

function resolveDbPath(): string {
  const configuredDbPath = process.env.PULSE_DB_PATH?.trim();
  if (configuredDbPath) {
    return path.resolve(configuredDbPath);
  }

  const configuredDataDir = process.env.PULSE_DATA_DIR?.trim();
  if (configuredDataDir) {
    return path.join(path.resolve(configuredDataDir), 'clarix.db');
  }

  return path.join(DEFAULT_DATA_DIR, 'clarix.db');
}

export const DB_PATH = resolveDbPath();
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Create libsql client pointing to a local SQLite file
export const db: Client = createClient({ url: `file:${DB_PATH}` });

async function ensureColumn(
  tableName: string,
  columnName: string,
  definition: string
): Promise<void> {
  const result = await db.execute(`PRAGMA table_info(${tableName})`);
  const hasColumn = result.rows.some((row) => row.name === columnName);
  if (!hasColumn) {
    await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export async function initDb(): Promise<void> {
  await db.execute('PRAGMA journal_mode = WAL');
  await db.execute('PRAGMA synchronous = NORMAL');
  await db.execute('PRAGMA busy_timeout = 5000');

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS instance_state (
      instance_id         TEXT PRIMARY KEY,
      agent_id            TEXT NOT NULL,
      broadcast_health    TEXT NOT NULL DEFAULT 'unknown',
      runtime_health      TEXT NOT NULL DEFAULT 'unknown',
      connectivity_health TEXT NOT NULL DEFAULT 'offline',
      last_heartbeat_at   TEXT,
      last_observations   TEXT,
      thumbnail_data      TEXT,
      thumbnail_at        TEXT,
      updated_at          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id    TEXT NOT NULL,
      event_type     TEXT NOT NULL,
      from_state     TEXT,
      to_state       TEXT,
      observations   TEXT,
      alert_sent     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_instance_id ON events(instance_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

    CREATE TABLE IF NOT EXISTS alert_settings (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      email_recipients  TEXT NOT NULL DEFAULT '[]',
      telegram_chat_ids TEXT NOT NULL DEFAULT '[]',
      phone_numbers     TEXT NOT NULL DEFAULT '[]',
      email_enabled     INTEGER NOT NULL DEFAULT 1,
      telegram_enabled  INTEGER NOT NULL DEFAULT 1,
      phone_enabled     INTEGER NOT NULL DEFAULT 1,
      updated_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS node_config_mirror (
      node_id           TEXT PRIMARY KEY,
      payload           TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS instance_controls (
      instance_id         TEXT PRIMARY KEY,
      monitoring_enabled  INTEGER NOT NULL DEFAULT 1,
      maintenance_mode    INTEGER NOT NULL DEFAULT 0,
      updated_at          TEXT NOT NULL
    );
  `);

  await ensureColumn('instance_state', 'runtime_started_at', 'TEXT');
  await ensureColumn('instance_state', 'broadcast_started_at', 'TEXT');
  await ensureColumn('alert_settings', 'email_enabled', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('alert_settings', 'telegram_enabled', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('alert_settings', 'phone_enabled', 'INTEGER NOT NULL DEFAULT 1');
  await db.execute(`
    UPDATE instance_state
    SET runtime_started_at = COALESCE(runtime_started_at, updated_at)
    WHERE runtime_started_at IS NULL
  `);
  await db.execute(`
    UPDATE instance_state
    SET broadcast_started_at = COALESCE(broadcast_started_at, updated_at)
    WHERE broadcast_started_at IS NULL
  `);

  const seedEmailRecipients = JSON.stringify(parseSeedList(process.env.SMTP_TO ?? '', normalizeEmail));
  const seedTelegramChatIds = JSON.stringify(parseSeedList(process.env.TELEGRAM_CHAT_ID ?? '', normalizeToken));
  const seedPhoneNumbers = JSON.stringify([]);
  const timestamp = new Date().toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO alert_settings
            (id, email_recipients, telegram_chat_ids, phone_numbers, email_enabled, telegram_enabled, phone_enabled, updated_at)
          VALUES (1, ?, ?, ?, 1, 1, 1, ?)`,
    args: [seedEmailRecipients, seedTelegramChatIds, seedPhoneNumbers, timestamp],
  });
}

function parseSeedList(
  raw: string,
  normalize: (value: string) => string
): string[] {
  const values = raw
    .split(/[\n,;]+/)
    .map((entry) => normalize(entry))
    .filter(Boolean);

  return Array.from(new Set(values)).slice(0, 3);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeToken(value: string): string {
  return value.trim();
}

export type BroadcastHealth = 'healthy' | 'degraded' | 'off_air_likely' | 'off_air_confirmed' | 'unknown';
export type RuntimeHealth = 'healthy' | 'paused' | 'restarting' | 'stalled' | 'stopped' | 'content_error' | 'unknown';
export type ConnectivityHealth = 'online' | 'stale' | 'offline';

export interface HealthState {
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  connectivityHealth: ConnectivityHealth;
}

export interface InstanceState {
  instanceId: string;
  agentId: string;
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  connectivityHealth: ConnectivityHealth;
  lastHeartbeatAt: string | null;
  lastObservations: Record<string, unknown> | null;
  thumbnailData: string | null; // base64 stored as TEXT in libsql
  thumbnailAt: string | null;
  broadcastStartedAt: string;
  runtimeStartedAt: string;
  updatedAt: string;
}
