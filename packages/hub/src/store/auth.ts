import crypto from 'crypto';
import { QueryResultRow } from 'pg';
import { exec, queryOne, withTransaction } from './db';

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  enrollmentKey: string;
  defaultAlertEmail: string | null;
  email: string;
  displayName: string;
  expiresAt: string;
}

interface SessionRow extends QueryResultRow {
  session_id: string;
  user_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  enrollment_key: string;
  default_alert_email: string | null;
  email: string;
  display_name: string;
  expires_at: Date | string;
}

interface UserRow extends QueryResultRow {
  user_id: string;
}

interface TenantRow extends QueryResultRow {
  tenant_id: string;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDisplayName(value: string, fallback: string): string {
  const cleaned = value.trim();
  return cleaned || fallback;
}

function normalizeTenantName(value: string, fallback: string): string {
  const cleaned = value.trim();
  return cleaned || fallback;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'clarix-pulse';
}

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(10).toString('hex')}`;
}

function randomSecret(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function scryptHash(secret: string, salt: string): Promise<string> {
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(secret, salt, 64, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key as Buffer);
    });
  });

  return derived.toString('hex');
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomSecret(16);
  const digest = await scryptHash(password, salt);
  return `scrypt:${salt}:${digest}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, digest] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !digest) {
    return false;
  }

  const candidate = await scryptHash(password, salt);
  const expected = Buffer.from(digest, 'hex');
  const actual = Buffer.from(candidate, 'hex');
  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

function rowToSession(row: SessionRow): AuthenticatedSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    enrollmentKey: row.enrollment_key,
    defaultAlertEmail: row.default_alert_email,
    email: row.email,
    displayName: row.display_name,
    expiresAt: toIso(row.expires_at),
  };
}

async function sessionForHash(sessionTokenHash: string): Promise<AuthenticatedSession | null> {
  const row = await queryOne<SessionRow>(`
    SELECT
      s.session_id,
      u.user_id,
      t.tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug,
      t.enrollment_key,
      t.default_alert_email,
      u.email,
      u.display_name,
      s.expires_at
    FROM sessions s
    JOIN users u ON u.user_id = s.user_id
    JOIN tenants t ON t.tenant_id = u.tenant_id
    WHERE s.session_token_hash = $1
      AND s.expires_at > NOW()
  `, [sessionTokenHash]);

  return row ? rowToSession(row) : null;
}

async function resolveUniqueTenantSlug(baseSlug: string, client?: Parameters<typeof exec>[2]): Promise<string> {
  const normalized = slugify(baseSlug);
  let candidate = normalized;
  let suffix = 2;

  for (;;) {
    const existing = await queryOne<TenantRow>(`
      SELECT tenant_id
      FROM tenants
      WHERE slug = $1
    `, [candidate], client);

    if (!existing) {
      return candidate;
    }

    candidate = `${normalized}-${suffix}`;
    suffix += 1;
  }
}

async function ensureUniqueUserEmail(email: string, client?: Parameters<typeof exec>[2]): Promise<void> {
  const existing = await queryOne<UserRow>(`
    SELECT user_id
    FROM users
    WHERE email = $1
  `, [email], client);

  if (existing) {
    throw new Error('That email is already registered. Try signing in instead.');
  }
}

export async function registerTenantOwner(input: {
  companyName: string;
  displayName: string;
  email: string;
  password: string;
}): Promise<{ sessionToken: string; session: AuthenticatedSession }> {
  const email = normalizeEmail(input.email);
  const companyName = normalizeTenantName(input.companyName, email);
  const displayName = normalizeDisplayName(input.displayName, companyName);
  const password = input.password;

  if (!email || !email.includes('@')) {
    throw new Error('Enter a valid email address.');
  }
  if (!companyName) {
    throw new Error('Company name is required.');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const passwordHash = await hashPassword(password);
  const tenantId = randomId('tenant');
  const userId = randomId('user');
  const timestamp = new Date().toISOString();
  const enrollmentKey = randomSecret(24);

  await withTransaction(async (client) => {
    await ensureUniqueUserEmail(email, client);
    const tenantSlug = await resolveUniqueTenantSlug(companyName, client);

    await exec(`
      INSERT INTO tenants (
        tenant_id,
        name,
        slug,
        enrollment_key,
        default_alert_email,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6)
    `, [tenantId, companyName, tenantSlug, enrollmentKey, email, timestamp], client);

    await exec(`
      INSERT INTO users (
        user_id,
        tenant_id,
        email,
        display_name,
        password_hash,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6)
    `, [userId, tenantId, email, displayName, passwordHash, timestamp], client);

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
      VALUES ($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, TRUE, TRUE, TRUE, $3)
      ON CONFLICT (tenant_id) DO NOTHING
    `, [tenantId, JSON.stringify([email]), timestamp], client);
  });

  return createSessionForUser(userId);
}

export async function authenticateUser(emailInput: string, password: string): Promise<{ userId: string } | null> {
  const email = normalizeEmail(emailInput);
  const row = await queryOne<{
    user_id: string;
    password_hash: string;
  }>(`
    SELECT user_id, password_hash
    FROM users
    WHERE email = $1
  `, [email]);

  if (!row) {
    return null;
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    return null;
  }

  return {
    userId: row.user_id,
  };
}

export async function createSessionForUser(userId: string): Promise<{ sessionToken: string; session: AuthenticatedSession }> {
  const sessionId = randomId('session');
  const sessionToken = randomSecret(32);
  const sessionTokenHash = hashSessionToken(sessionToken);
  const timestamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await exec(`
    INSERT INTO sessions (
      session_id,
      user_id,
      session_token_hash,
      expires_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $5)
  `, [sessionId, userId, sessionTokenHash, expiresAt, timestamp]);

  const session = await sessionForHash(sessionTokenHash);
  if (!session) {
    throw new Error('Failed to create a session.');
  }

  return {
    sessionToken,
    session,
  };
}

export async function getSessionFromToken(sessionToken: string): Promise<AuthenticatedSession | null> {
  const trimmed = sessionToken.trim();
  if (!trimmed) {
    return null;
  }

  return sessionForHash(hashSessionToken(trimmed));
}

export async function deleteSession(sessionToken: string): Promise<void> {
  const trimmed = sessionToken.trim();
  if (!trimmed) {
    return;
  }

  await exec(`
    DELETE FROM sessions
    WHERE session_token_hash = $1
  `, [hashSessionToken(trimmed)]);
}

export async function findTenantByEnrollmentKey(enrollmentKey: string): Promise<{
  tenantId: string;
  tenantName: string;
} | null> {
  const row = await queryOne<{
    tenant_id: string;
    name: string;
  }>(`
    SELECT tenant_id, name
    FROM tenants
    WHERE enrollment_key = $1
  `, [enrollmentKey.trim()]);

  if (!row) {
    return null;
  }

  return {
    tenantId: row.tenant_id,
    tenantName: row.name,
  };
}
