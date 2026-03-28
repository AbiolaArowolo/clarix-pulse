import dotenv from 'dotenv';
import path from 'path';
import { Pool, PoolClient, QueryResultRow } from 'pg';

const repoRoot = path.resolve(__dirname, '../../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function resolveDatabaseUrl(): string {
  const configured = process.env.PULSE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (configured) {
    return configured;
  }

  return 'postgres://postgres:postgres@127.0.0.1:5432/clarix_pulse';
}

function shouldUseSsl(connectionString: string): boolean {
  if (process.env.PULSE_DATABASE_SSL !== undefined) {
    return asBool(process.env.PULSE_DATABASE_SSL, false);
  }

  return /sslmode=require/i.test(connectionString) || /[?&]ssl=true/i.test(connectionString);
}

function maskDatabaseUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

export const DATABASE_URL = resolveDatabaseUrl();
export const DATABASE_URL_DISPLAY = maskDatabaseUrl(DATABASE_URL);

const sslEnabled = shouldUseSsl(DATABASE_URL);
const sslRejectUnauthorized = asBool(process.env.PULSE_DATABASE_SSL_REJECT_UNAUTHORIZED, false);

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PULSE_DB_POOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.PULSE_DB_IDLE_TIMEOUT_MS ?? 30_000),
  ssl: sslEnabled ? { rejectUnauthorized: sslRejectUnauthorized } : undefined,
});

pool.on('error', (err) => {
  console.error('[db] PostgreSQL pool error', err);
});

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
  thumbnailAt: string | null;
  broadcastStartedAt: string;
  runtimeStartedAt: string;
  updatedAt: string;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
  client?: PoolClient,
): Promise<T[]> {
  const executor = client ?? pool;
  const result = await executor.query<T>(text, Array.from(params));
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
  client?: PoolClient,
): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

export async function exec(
  text: string,
  params: readonly unknown[] = [],
  client?: PoolClient,
): Promise<void> {
  const executor = client ?? pool;
  await executor.query(text, Array.from(params));
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures; the original error is more useful.
    }
    throw err;
  } finally {
    client.release();
  }
}

function parseSeedList(raw: string, normalize: (value: string) => string): string[] {
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

export async function initDb(): Promise<void> {
  await withTransaction(async (client) => {
    await exec(`
      CREATE TABLE IF NOT EXISTS sites (
        site_id            TEXT PRIMARY KEY,
        site_name          TEXT NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL,
        updated_at         TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        node_id            TEXT PRIMARY KEY,
        site_id            TEXT NOT NULL REFERENCES sites(site_id) ON DELETE RESTRICT,
        node_name          TEXT NOT NULL,
        local_ui_url       TEXT NOT NULL DEFAULT 'http://127.0.0.1:3210/',
        commissioned       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at         TIMESTAMPTZ NOT NULL,
        updated_at         TIMESTAMPTZ NOT NULL,
        last_enrolled_at   TIMESTAMPTZ
      );
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS players (
        player_id               TEXT PRIMARY KEY,
        node_id                 TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
        site_id                 TEXT NOT NULL REFERENCES sites(site_id) ON DELETE RESTRICT,
        label                   TEXT NOT NULL,
        playout_type            TEXT NOT NULL,
        udp_monitoring_capable  BOOLEAN NOT NULL DEFAULT TRUE,
        commissioned            BOOLEAN NOT NULL DEFAULT TRUE,
        created_at              TIMESTAMPTZ NOT NULL,
        updated_at              TIMESTAMPTZ NOT NULL,
        last_seen_at            TIMESTAMPTZ
      );
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS agent_tokens (
        token             TEXT PRIMARY KEY,
        node_id           TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
        description       TEXT NOT NULL DEFAULT '',
        active            BOOLEAN NOT NULL DEFAULT TRUE,
        created_at        TIMESTAMPTZ NOT NULL,
        updated_at        TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tokens_active_node
      ON agent_tokens(node_id)
      WHERE active = TRUE;
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS instance_state (
        instance_id           TEXT PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
        agent_id              TEXT NOT NULL,
        broadcast_health      TEXT NOT NULL DEFAULT 'unknown',
        runtime_health        TEXT NOT NULL DEFAULT 'unknown',
        connectivity_health   TEXT NOT NULL DEFAULT 'offline',
        last_heartbeat_at     TIMESTAMPTZ,
        last_observations     JSONB,
        thumbnail_at          TIMESTAMPTZ,
        broadcast_started_at  TIMESTAMPTZ NOT NULL,
        runtime_started_at    TIMESTAMPTZ NOT NULL,
        updated_at            TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS events (
        id              BIGSERIAL PRIMARY KEY,
        instance_id     TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
        event_type      TEXT NOT NULL,
        from_state      JSONB,
        to_state        JSONB,
        observations    JSONB,
        alert_sent      BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_events_instance_id ON events(instance_id);
    `, [], client);
    await exec(`
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
    `, [], client);
    await exec(`
      CREATE INDEX IF NOT EXISTS idx_players_site_id ON players(site_id);
    `, [], client);
    await exec(`
      CREATE INDEX IF NOT EXISTS idx_players_node_id ON players(node_id);
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS alert_settings (
        id                SMALLINT PRIMARY KEY,
        email_recipients  JSONB NOT NULL DEFAULT '[]'::jsonb,
        telegram_chat_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        phone_numbers     JSONB NOT NULL DEFAULT '[]'::jsonb,
        email_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
        telegram_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
        phone_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at        TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS node_config_mirror (
        node_id           TEXT PRIMARY KEY REFERENCES nodes(node_id) ON DELETE CASCADE,
        payload           JSONB NOT NULL,
        updated_at        TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS instance_controls (
        instance_id          TEXT PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
        monitoring_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
        maintenance_mode     BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at           TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    const seedEmailRecipients = parseSeedList(process.env.SMTP_TO ?? '', normalizeEmail);
    const seedTelegramChatIds = parseSeedList(process.env.TELEGRAM_CHAT_ID ?? '', normalizeToken);
    const timestamp = new Date().toISOString();

    await exec(`
      INSERT INTO alert_settings
        (id, email_recipients, telegram_chat_ids, phone_numbers, email_enabled, telegram_enabled, phone_enabled, updated_at)
      VALUES
        (1, $1::jsonb, $2::jsonb, '[]'::jsonb, TRUE, TRUE, TRUE, $3)
      ON CONFLICT (id) DO NOTHING;
    `, [JSON.stringify(seedEmailRecipients), JSON.stringify(seedTelegramChatIds), timestamp], client);
  });
}
