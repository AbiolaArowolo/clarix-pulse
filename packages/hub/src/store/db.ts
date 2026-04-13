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

export async function checkDbHealth(): Promise<{
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}> {
  const startedAt = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: 'database unavailable',
    };
  }
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
    const seedEmailRecipients = parseSeedList(process.env.SMTP_TO ?? '', normalizeEmail);
    const seedTelegramChatIds = parseSeedList(process.env.TELEGRAM_CHAT_ID ?? '', normalizeToken);
    const timestamp = new Date().toISOString();
    const legacyTenantId = 'legacy-hub';
    const legacyEnrollmentKey = normalizeToken(process.env.PULSE_ENROLLMENT_KEY ?? '') || 'legacy-hub-enrollment-disabled';

    await exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        tenant_id            TEXT PRIMARY KEY,
        name                 TEXT NOT NULL,
        slug                 TEXT NOT NULL,
        enrollment_key       TEXT NOT NULL,
        default_alert_email  TEXT,
        enabled              BOOLEAN NOT NULL DEFAULT FALSE,
        disabled_reason      TEXT,
        enabled_at           TIMESTAMPTZ,
        disabled_at          TIMESTAMPTZ,
        access_key_hash      TEXT NOT NULL DEFAULT '',
        access_key_hint      TEXT,
        access_key_generated_at TIMESTAMPTZ,
        access_key_expires_at   TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL,
        updated_at           TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE;
    `, [], client);

    await exec(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
    `, [], client);

    await exec(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS enabled_at TIMESTAMPTZ;
    `, [], client);

    await exec(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
    `, [], client);

    await exec(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS access_key_hash TEXT NOT NULL DEFAULT '';
    `, [], client);

    await exec(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS access_key_hint TEXT;
    `, [], client);

    await exec(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS access_key_generated_at TIMESTAMPTZ;
    `, [], client);

    await exec(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS access_key_expires_at TIMESTAMPTZ;
    `, [], client);

    await exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug
      ON tenants(slug);
    `, [], client);

    await exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_enrollment_key
      ON tenants(enrollment_key);
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id         TEXT PRIMARY KEY,
        tenant_id       TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        email           TEXT NOT NULL,
        display_name    TEXT NOT NULL,
        password_hash   TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL,
        updated_at      TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
      ON users(email);
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id           TEXT PRIMARY KEY,
        user_id              TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        session_token_hash   TEXT NOT NULL,
        impersonator_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
        impersonator_email   TEXT,
        impersonation_started_at TIMESTAMPTZ,
        expires_at           TIMESTAMPTZ NOT NULL,
        created_at           TIMESTAMPTZ NOT NULL,
        updated_at           TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS impersonator_user_id TEXT;
    `, [], client);

    await exec(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS impersonator_email TEXT;
    `, [], client);

    await exec(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS impersonation_started_at TIMESTAMPTZ;
    `, [], client);

    await exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'sessions_impersonator_user_id_fkey'
        ) THEN
          ALTER TABLE sessions
          ADD CONSTRAINT sessions_impersonator_user_id_fkey
          FOREIGN KEY (impersonator_user_id) REFERENCES users(user_id) ON DELETE SET NULL;
        END IF;
      END
      $$;
    `, [], client);

    await exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
      ON sessions(session_token_hash);
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id
      ON sessions(user_id);
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_impersonator_user_id
      ON sessions(impersonator_user_id);
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        reset_id            TEXT PRIMARY KEY,
        user_id             TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        token_hash          TEXT NOT NULL,
        created_by_admin    BOOLEAN NOT NULL DEFAULT FALSE,
        actor_user_id       TEXT REFERENCES users(user_id) ON DELETE SET NULL,
        actor_email         TEXT,
        expires_at          TIMESTAMPTZ NOT NULL,
        consumed_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL,
        updated_at          TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
      ON password_reset_tokens(token_hash);
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
      ON password_reset_tokens(user_id);
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS admin_audit_events (
        event_id            TEXT PRIMARY KEY,
        actor_user_id       TEXT REFERENCES users(user_id) ON DELETE SET NULL,
        actor_email         TEXT NOT NULL,
        target_tenant_id    TEXT REFERENCES tenants(tenant_id) ON DELETE SET NULL,
        target_user_id      TEXT REFERENCES users(user_id) ON DELETE SET NULL,
        target_email        TEXT,
        action              TEXT NOT NULL,
        details             JSONB,
        created_at          TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_events_created_at
      ON admin_audit_events(created_at DESC);
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_events_target_tenant_id
      ON admin_audit_events(target_tenant_id);
    `, [], client);

    await exec(`
      INSERT INTO tenants (
        tenant_id,
        name,
        slug,
        enrollment_key,
        default_alert_email,
        enabled,
        disabled_reason,
        enabled_at,
        disabled_at,
        access_key_hash,
        access_key_hint,
        access_key_generated_at,
        access_key_expires_at,
        created_at,
        updated_at
      )
      VALUES (
        $1, 'Legacy Hub', 'legacy-hub', $2, $3,
        TRUE, NULL, $4, NULL, 'legacy-access-key-disabled', NULL, $4, NULL,
        $4, $4
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        enrollment_key = EXCLUDED.enrollment_key,
        default_alert_email = COALESCE(tenants.default_alert_email, EXCLUDED.default_alert_email),
        enabled = TRUE,
        disabled_reason = NULL,
        enabled_at = COALESCE(tenants.enabled_at, EXCLUDED.enabled_at),
        updated_at = EXCLUDED.updated_at;
    `, [legacyTenantId, legacyEnrollmentKey, seedEmailRecipients[0] ?? null, timestamp], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS sites (
        site_id            TEXT PRIMARY KEY,
        site_name          TEXT NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL,
        updated_at         TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      ALTER TABLE sites
      ADD COLUMN IF NOT EXISTS tenant_id TEXT;
    `, [], client);

    await exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'sites_tenant_id_fkey'
        ) THEN
          ALTER TABLE sites
          ADD CONSTRAINT sites_tenant_id_fkey
          FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE RESTRICT;
        END IF;
      END
      $$;
    `, [], client);

    await exec(`
      UPDATE sites
      SET tenant_id = $1
      WHERE tenant_id IS NULL OR tenant_id = '';
    `, [legacyTenantId], client);

    await exec(`
      ALTER TABLE sites
      ALTER COLUMN tenant_id SET NOT NULL;
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_sites_tenant_id
      ON sites(tenant_id);
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
      CREATE TABLE IF NOT EXISTS node_bootstrap_claims (
        claim_hash        TEXT PRIMARY KEY,
        node_id           TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
        tenant_id         TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        description       TEXT NOT NULL DEFAULT '',
        expires_at        TIMESTAMPTZ NOT NULL,
        consumed_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL,
        updated_at        TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_node_bootstrap_claims_node_id
      ON node_bootstrap_claims(node_id);
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_node_bootstrap_claims_tenant_id
      ON node_bootstrap_claims(tenant_id);
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_node_bootstrap_claims_expires_at
      ON node_bootstrap_claims(expires_at);
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS node_decommission_locks (
        node_id           TEXT PRIMARY KEY,
        tenant_id         TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        locked_until      TIMESTAMPTZ NOT NULL,
        reason            TEXT,
        created_at        TIMESTAMPTZ NOT NULL,
        updated_at        TIMESTAMPTZ NOT NULL
      );
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_node_decommission_locks_tenant_id
      ON node_decommission_locks(tenant_id);
    `, [], client);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_node_decommission_locks_locked_until
      ON node_decommission_locks(locked_until);
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
      CREATE TABLE IF NOT EXISTS tenant_alert_settings (
        tenant_id          TEXT PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        email_recipients   JSONB NOT NULL DEFAULT '[]'::jsonb,
        telegram_chat_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
        phone_numbers      JSONB NOT NULL DEFAULT '[]'::jsonb,
        email_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
        telegram_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
        phone_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at         TIMESTAMPTZ NOT NULL
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

    await exec(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    `, [], client);

    await exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        tenant_id   TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
        endpoint    TEXT NOT NULL,
        subscription JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (id)
      );
    `, [], client);

    await exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
      ON push_subscriptions(endpoint);
    `, [], client);

    await exec(`
      INSERT INTO alert_settings
        (id, email_recipients, telegram_chat_ids, phone_numbers, email_enabled, telegram_enabled, phone_enabled, updated_at)
      VALUES
        (1, $1::jsonb, $2::jsonb, '[]'::jsonb, TRUE, TRUE, TRUE, $3)
      ON CONFLICT (id) DO NOTHING;
    `, [JSON.stringify(seedEmailRecipients), JSON.stringify(seedTelegramChatIds), timestamp], client);

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
      SELECT
        $1,
        COALESCE((SELECT email_recipients FROM alert_settings WHERE id = 1), $2::jsonb),
        COALESCE((SELECT telegram_chat_ids FROM alert_settings WHERE id = 1), $3::jsonb),
        COALESCE((SELECT phone_numbers FROM alert_settings WHERE id = 1), '[]'::jsonb),
        COALESCE((SELECT email_enabled FROM alert_settings WHERE id = 1), TRUE),
        COALESCE((SELECT telegram_enabled FROM alert_settings WHERE id = 1), TRUE),
        COALESCE((SELECT phone_enabled FROM alert_settings WHERE id = 1), TRUE),
        $4
      ON CONFLICT (tenant_id) DO NOTHING;
    `, [legacyTenantId, JSON.stringify(seedEmailRecipients), JSON.stringify(seedTelegramChatIds), timestamp], client);
  });
}
