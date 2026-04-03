import crypto from 'crypto';
import { QueryResultRow } from 'pg';
import { exec, query, queryOne, withTransaction } from './db';
import { clearInstanceControlsCacheForInstances } from './instanceControls';
import { clearStateCacheForInstances } from './state';
import { deleteThumbnailsForPlayers } from './thumbnails';

export type UserRole = 'super_admin' | 'admin' | 'support' | 'user';

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
  role: UserRole;
  isPlatformAdmin: boolean;
  tenantEnabled: boolean;
  disabledReason: string | null;
  accessKeyHint: string | null;
  accessKeyExpiresAt: string | null;
  impersonating: boolean;
  impersonatorUserId: string | null;
  impersonatorEmail: string | null;
  impersonationStartedAt: string | null;
}

export interface RegistrationResult {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  ownerEmail: string;
  ownerDisplayName: string;
  enrollmentKey: string;
  defaultAlertEmail: string;
  accessKey: string;
  accessKeyHint: string;
  accessKeyExpiresAt: string;
}

export interface TenantAccessSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  defaultAlertEmail: string | null;
  enabled: boolean;
  disabledReason: string | null;
  accessKeyHint: string | null;
  accessKeyGeneratedAt: string | null;
  accessKeyExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantAccessKeyRotation {
  summary: TenantAccessSummary;
  accessKey: string;
}

export interface TenantDeletionResult {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  deletedAt: string;
  deletedSiteCount: number;
  deletedPlayerCount: number;
}

export interface AdminAuditEvent {
  eventId: string;
  actorEmail: string;
  targetTenantId: string | null;
  targetTenantName: string | null;
  targetUserId: string | null;
  targetEmail: string | null;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface PasswordResetIssueResult {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  tenantName: string;
  resetToken: string;
  expiresAt: string;
}

export interface AuthenticationResult {
  ok: boolean;
  statusCode: number;
  error?: string;
  userId?: string;
}

export interface PasswordResetRequestResult {
  resetToken: string;
  resetUrl: string;
  expiresAt: string;
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  tenantName: string;
  createdByAdmin: boolean;
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
  role: string;
  expires_at: Date | string;
  enabled: boolean;
  disabled_reason: string | null;
  access_key_hint: string | null;
  access_key_expires_at: Date | string | null;
  impersonator_user_id: string | null;
  impersonator_email: string | null;
  impersonation_started_at: Date | string | null;
}

interface UserRow extends QueryResultRow {
  user_id: string;
}

interface TenantRow extends QueryResultRow {
  tenant_id: string;
}

interface UserAuthRow extends QueryResultRow {
  user_id: string;
  password_hash: string;
  email: string;
  tenant_id: string;
  enabled: boolean;
  disabled_reason: string | null;
  access_key_hash: string;
  access_key_expires_at: Date | string | null;
}

interface UserAccessRow extends QueryResultRow {
  user_id: string;
  email: string;
  display_name: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  enabled: boolean;
  disabled_reason: string | null;
  access_key_expires_at: Date | string | null;
}

interface TenantOwnerRow extends QueryResultRow {
  user_id: string;
  email: string;
  display_name: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
}

interface PasswordResetRow extends QueryResultRow {
  reset_id: string;
  user_id: string;
  email: string;
  display_name: string;
  tenant_id: string;
  tenant_name: string;
  token_hash: string;
  expires_at: Date | string;
  created_by_admin: boolean;
  actor_user_id: string | null;
  actor_email: string | null;
  consumed_at: Date | string | null;
}

interface TenantSummaryRow extends QueryResultRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  owner_email: string | null;
  owner_display_name: string | null;
  default_alert_email: string | null;
  enabled: boolean;
  disabled_reason: string | null;
  access_key_hint: string | null;
  access_key_generated_at: Date | string | null;
  access_key_expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AdminAuditEventRow extends QueryResultRow {
  event_id: string;
  actor_email: string;
  target_tenant_id: string | null;
  target_tenant_name: string | null;
  target_user_id: string | null;
  target_email: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: Date | string;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function passwordResetValidityMinutes(): number {
  const parsed = Number.parseInt(process.env.PULSE_PASSWORD_RESET_TTL_MINUTES ?? '60', 10);
  if (!Number.isFinite(parsed)) {
    return 60;
  }

  return Math.min(24 * 60, Math.max(5, parsed));
}

function accessKeyValidityDays(): number {
  const parsed = Number.parseInt(process.env.PULSE_ACCESS_KEY_TTL_DAYS ?? '365', 10);
  if (!Number.isFinite(parsed)) {
    return 365;
  }

  return Math.min(3650, Math.max(1, parsed));
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toOptionalIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return toIso(value);
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

function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeAccessKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatAccessKey(value: string): string {
  return normalizeAccessKey(value).match(/.{1,4}/g)?.join('-') ?? normalizeAccessKey(value);
}

function accessKeyHint(value: string): string {
  const normalized = normalizeAccessKey(value);
  const tail = normalized.slice(-6) || normalized;
  return `...${tail}`;
}

function createAccessKey(): string {
  return formatAccessKey(crypto.randomBytes(12).toString('hex').toUpperCase());
}

function accessKeyExpiryIso(validityDays = accessKeyValidityDays()): string {
  return new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString();
}

function passwordResetExpiryIso(validityMinutes = passwordResetValidityMinutes()): string {
  return new Date(Date.now() + validityMinutes * 60 * 1000).toISOString();
}

function platformAdminEmails(): Set<string> {
  const raw = [
    process.env.PULSE_PLATFORM_ADMIN_EMAILS ?? '',
    process.env.PULSE_ADMIN_EMAILS ?? '',
  ]
    .join(',')
    .split(/[,\n;]+/)
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

  return new Set(raw);
}

export function isPlatformAdminEmail(email: string): boolean {
  return platformAdminEmails().has(normalizeEmail(email));
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

async function hashSecret(secret: string): Promise<string> {
  const salt = randomSecret(16);
  const digest = await scryptHash(secret, salt);
  return `scrypt:${salt}:${digest}`;
}

async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [algorithm, salt, digest] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !digest) {
    return false;
  }

  const candidate = await scryptHash(secret, salt);
  const expected = Buffer.from(digest, 'hex');
  const actual = Buffer.from(candidate, 'hex');
  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

async function hashPassword(password: string): Promise<string> {
  return hashSecret(password);
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return verifySecret(password, stored);
}

async function hashAccessKey(accessKey: string): Promise<string> {
  return hashSecret(normalizeAccessKey(accessKey));
}

async function verifyAccessKey(accessKey: string, stored: string): Promise<boolean> {
  return verifySecret(normalizeAccessKey(accessKey), stored);
}

function tenantAccessError(input: {
  enabled: boolean;
  disabledReason: string | null;
  accessKeyExpiresAt: Date | string | null;
  isPlatformAdmin: boolean;
}): string | null {
  if (input.isPlatformAdmin) {
    return null;
  }

  if (!input.enabled) {
    return input.disabledReason?.trim() || 'Account pending activation. Clarix must enable this account before you can sign in.';
  }

  if (input.accessKeyExpiresAt) {
    const expiry = new Date(input.accessKeyExpiresAt);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) {
      return 'Your access key has expired. Contact Clarix to renew it.';
    }
  }

  return null;
}

const VALID_ROLES: ReadonlySet<string> = new Set(['super_admin', 'admin', 'support', 'user']);

function resolveRole(row: SessionRow, isPlatformAdmin: boolean): UserRole {
  // Email-based super_admin takes precedence over the DB role.
  if (isPlatformAdmin) {
    return 'super_admin';
  }

  const dbRole = row.role ?? 'user';
  return VALID_ROLES.has(dbRole) ? (dbRole as UserRole) : 'user';
}

function rowToSession(row: SessionRow, isPlatformAdmin: boolean): AuthenticatedSession {
  const impersonating = Boolean(row.impersonator_user_id);
  const effectivePlatformAdmin = impersonating ? false : isPlatformAdmin;
  const role = impersonating ? 'user' : resolveRole(row, isPlatformAdmin);
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
    role,
    isPlatformAdmin: effectivePlatformAdmin || role === 'super_admin',
    tenantEnabled: !!row.enabled,
    disabledReason: row.disabled_reason,
    accessKeyHint: row.access_key_hint,
    accessKeyExpiresAt: toOptionalIso(row.access_key_expires_at),
    impersonating,
    impersonatorUserId: row.impersonator_user_id,
    impersonatorEmail: row.impersonator_email,
    impersonationStartedAt: toOptionalIso(row.impersonation_started_at),
  };
}

function rowToTenantSummary(row: TenantSummaryRow): TenantAccessSummary {
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    ownerEmail: row.owner_email,
    ownerDisplayName: row.owner_display_name,
    defaultAlertEmail: row.default_alert_email,
    enabled: !!row.enabled,
    disabledReason: row.disabled_reason,
    accessKeyHint: row.access_key_hint,
    accessKeyGeneratedAt: toOptionalIso(row.access_key_generated_at),
    accessKeyExpiresAt: toOptionalIso(row.access_key_expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToAdminAuditEvent(row: AdminAuditEventRow): AdminAuditEvent {
  return {
    eventId: row.event_id,
    actorEmail: row.actor_email,
    targetTenantId: row.target_tenant_id,
    targetTenantName: row.target_tenant_name,
    targetUserId: row.target_user_id,
    targetEmail: row.target_email,
    action: row.action,
    details: row.details ?? null,
    createdAt: toIso(row.created_at),
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
      t.enabled,
      t.disabled_reason,
      t.access_key_hint,
      t.access_key_expires_at,
      u.email,
      u.display_name,
      u.role,
      s.expires_at,
      s.impersonator_user_id,
      s.impersonator_email,
      s.impersonation_started_at
    FROM sessions s
    JOIN users u ON u.user_id = s.user_id
    JOIN tenants t ON t.tenant_id = u.tenant_id
    WHERE s.session_token_hash = $1
      AND s.expires_at > NOW()
  `, [sessionTokenHash]);

  if (!row) {
    return null;
  }

  const isPlatformAdmin = isPlatformAdminEmail(row.email);
  const bypassTenantAccess = Boolean(row.impersonator_user_id || isPlatformAdmin);
  const accessError = tenantAccessError({
    enabled: !!row.enabled,
    disabledReason: row.disabled_reason,
    accessKeyExpiresAt: row.access_key_expires_at,
    isPlatformAdmin: bypassTenantAccess,
  });

  if (accessError) {
    return null;
  }

  return rowToSession(row, isPlatformAdmin);
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

async function deleteSessionsForTenant(tenantId: string, client?: Parameters<typeof exec>[2]): Promise<void> {
  await exec(`
    DELETE FROM sessions s
    USING users u
    WHERE s.user_id = u.user_id
      AND u.tenant_id = $1
  `, [tenantId], client);
}

async function deleteSessionsForUser(userId: string, client?: Parameters<typeof exec>[2]): Promise<void> {
  await exec(`
    DELETE FROM sessions
    WHERE user_id = $1
       OR impersonator_user_id = $1
  `, [userId], client);
}

async function deletePasswordResetTokensForUser(userId: string, client?: Parameters<typeof exec>[2]): Promise<void> {
  await exec(`
    DELETE FROM password_reset_tokens
    WHERE user_id = $1
  `, [userId], client);
}

async function tenantOwnerRowForTenantId(tenantId: string, client?: Parameters<typeof exec>[2]): Promise<TenantOwnerRow | null> {
  return queryOne<TenantOwnerRow>(`
    SELECT
      u.user_id,
      u.email,
      u.display_name,
      t.tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug
    FROM tenants t
    JOIN users u ON u.tenant_id = t.tenant_id
    WHERE t.tenant_id = $1
    ORDER BY u.created_at ASC
    LIMIT 1
  `, [tenantId], client);
}

async function recordAdminAuditEvent(input: {
  actorUserId: string | null;
  actorEmail: string;
  targetTenantId?: string | null;
  targetUserId?: string | null;
  targetEmail?: string | null;
  action: string;
  details?: Record<string, unknown>;
}, client?: Parameters<typeof exec>[2]): Promise<void> {
  await exec(`
    INSERT INTO admin_audit_events (
      event_id,
      actor_user_id,
      actor_email,
      target_tenant_id,
      target_user_id,
      target_email,
      action,
      details,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
  `, [
    randomId('audit'),
    input.actorUserId,
    normalizeEmail(input.actorEmail),
    input.targetTenantId ?? null,
    input.targetUserId ?? null,
    input.targetEmail ? normalizeEmail(input.targetEmail) : null,
    input.action,
    JSON.stringify(input.details ?? {}),
    new Date().toISOString(),
  ], client);
}

export async function appendAdminAuditEvent(input: {
  actorUserId: string | null;
  actorEmail: string;
  targetTenantId?: string | null;
  targetUserId?: string | null;
  targetEmail?: string | null;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await recordAdminAuditEvent(input);
}

async function userAccessRowForUserId(userId: string): Promise<UserAccessRow | null> {
  return queryOne<UserAccessRow>(`
    SELECT
      u.user_id,
      u.email,
      u.display_name,
      t.tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug,
      t.enabled,
      t.disabled_reason,
      t.access_key_expires_at
    FROM users u
    JOIN tenants t ON t.tenant_id = u.tenant_id
    WHERE u.user_id = $1
  `, [userId]);
}

export async function registerTenantOwner(input: {
  companyName: string;
  displayName: string;
  email: string;
  password: string;
}): Promise<RegistrationResult> {
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
  const accessKey = createAccessKey();
  const accessKeyHash = await hashAccessKey(accessKey);
  const tenantId = randomId('tenant');
  const userId = randomId('user');
  const timestamp = new Date().toISOString();
  const enrollmentKey = randomSecret(24);
  const accessKeyExpiresAt = accessKeyExpiryIso();
  let tenantSlug = '';

  await withTransaction(async (client) => {
    await ensureUniqueUserEmail(email, client);
    tenantSlug = await resolveUniqueTenantSlug(companyName, client);

    await exec(`
      INSERT INTO tenants (
        tenant_id,
        name,
        slug,
        enrollment_key,
        default_alert_email,
        enabled,
        disabled_reason,
        access_key_hash,
        access_key_hint,
        access_key_generated_at,
        access_key_expires_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9, $10, $9, $9)
    `, [
      tenantId,
      companyName,
      tenantSlug,
      enrollmentKey,
      email,
      null,
      accessKeyHash,
      accessKeyHint(accessKey),
      timestamp,
      accessKeyExpiresAt,
    ], client);

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

  return {
    tenantId,
    tenantName: companyName,
    tenantSlug,
    ownerEmail: email,
    ownerDisplayName: displayName,
    enrollmentKey,
    defaultAlertEmail: email,
    accessKey,
    accessKeyHint: accessKeyHint(accessKey),
    accessKeyExpiresAt,
  };
}

export async function authenticateUser(
  emailInput: string,
  password: string,
  accessKeyInput: string,
): Promise<AuthenticationResult> {
  const email = normalizeEmail(emailInput);
  const row = await queryOne<UserAuthRow>(`
    SELECT
      u.user_id,
      u.password_hash,
      u.email,
      t.tenant_id,
      t.enabled,
      t.disabled_reason,
      t.access_key_hash,
      t.access_key_expires_at
    FROM users u
    JOIN tenants t ON t.tenant_id = u.tenant_id
    WHERE u.email = $1
  `, [email]);

  if (!row) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Invalid email or password.',
    };
  }

  const validPassword = await verifyPassword(password, row.password_hash);
  if (!validPassword) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Invalid email or password.',
    };
  }

  const isPlatformAdmin = isPlatformAdminEmail(row.email);
  const accessError = tenantAccessError({
    enabled: !!row.enabled,
    disabledReason: row.disabled_reason,
    accessKeyExpiresAt: row.access_key_expires_at,
    isPlatformAdmin,
  });
  if (accessError) {
    return {
      ok: false,
      statusCode: 403,
      error: accessError,
    };
  }

  // Access key is only required while the tenant is pending activation (enabled=false).
  // Once the admin enables the account the user signs in with email + password only.
  // If the user supplies a key anyway, validate it so they can still use it as a
  // second factor (e.g., shared team workspace logins).
  if (!isPlatformAdmin && !row.enabled) {
    if (!normalizeAccessKey(accessKeyInput)) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Access key is required while your account is pending activation.',
      };
    }

    const validAccessKey = await verifyAccessKey(accessKeyInput, row.access_key_hash);
    if (!validAccessKey) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Invalid access key.',
      };
    }
  } else if (!isPlatformAdmin && normalizeAccessKey(accessKeyInput)) {
    // Account is enabled and user supplied a key — validate it as an optional check.
    const validAccessKey = await verifyAccessKey(accessKeyInput, row.access_key_hash);
    if (!validAccessKey) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Invalid access key.',
      };
    }
  }

  return {
    ok: true,
    statusCode: 200,
    userId: row.user_id,
  };
}

export async function createSessionForUser(userId: string): Promise<{ sessionToken: string; session: AuthenticatedSession }> {
  const access = await userAccessRowForUserId(userId);
  if (!access) {
    throw new Error('Unknown user.');
  }

  const isPlatformAdmin = isPlatformAdminEmail(access.email);
  const accessError = tenantAccessError({
    enabled: !!access.enabled,
    disabledReason: access.disabled_reason,
    accessKeyExpiresAt: access.access_key_expires_at,
    isPlatformAdmin,
  });
  if (accessError) {
    throw new Error(accessError);
  }

  return createStoredSession({
    userId,
  });
}

export async function listAdminAuditEvents(input?: {
  tenantId?: string | null;
  limit?: number;
}): Promise<AdminAuditEvent[]> {
  const limit = Math.min(100, Math.max(1, input?.limit ?? 40));
  const rows = await query<AdminAuditEventRow>(`
    SELECT
      e.event_id,
      e.actor_email,
      e.target_tenant_id,
      COALESCE(t.name, e.details->>'tenantName') AS target_tenant_name,
      e.target_user_id,
      e.target_email,
      e.action,
      e.details,
      e.created_at
    FROM admin_audit_events e
    LEFT JOIN tenants t ON t.tenant_id = e.target_tenant_id
    WHERE ($1::text IS NULL OR e.target_tenant_id = $1)
    ORDER BY e.created_at DESC
    LIMIT $2
  `, [input?.tenantId ?? null, limit]);

  return rows.map(rowToAdminAuditEvent);
}

async function createStoredSession(input: {
  userId: string;
  impersonatorUserId?: string | null;
  impersonatorEmail?: string | null;
}): Promise<{ sessionToken: string; session: AuthenticatedSession }> {
  const sessionId = randomId('session');
  const sessionToken = randomSecret(32);
  const sessionTokenHash = hashSessionToken(sessionToken);
  const timestamp = new Date().toISOString();
  const impersonationStartedAt = input.impersonatorUserId ? timestamp : null;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await exec(`
    INSERT INTO sessions (
      session_id,
      user_id,
      session_token_hash,
      impersonator_user_id,
      impersonator_email,
      impersonation_started_at,
      expires_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
  `, [
    sessionId,
    input.userId,
    sessionTokenHash,
    input.impersonatorUserId ?? null,
    input.impersonatorEmail ? normalizeEmail(input.impersonatorEmail) : null,
    impersonationStartedAt,
    expiresAt,
    timestamp,
  ]);

  const session = await sessionForHash(sessionTokenHash);
  if (!session) {
    throw new Error('Failed to create a session.');
  }

  return {
    sessionToken,
    session,
  };
}

export async function createImpersonationSessionForTenant(input: {
  tenantId: string;
  adminUserId: string;
  adminEmail: string;
}): Promise<{ sessionToken: string; session: AuthenticatedSession; target: TenantOwnerRow }> {
  const adminAccess = await userAccessRowForUserId(input.adminUserId);
  if (!adminAccess || !isPlatformAdminEmail(adminAccess.email)) {
    throw new Error('Platform admin access required.');
  }

  const target = await tenantOwnerRowForTenantId(input.tenantId);
  if (!target) {
    throw new Error('Unknown tenant owner.');
  }

  if (target.user_id === input.adminUserId) {
    throw new Error('You are already in this workspace.');
  }

  const created = await createStoredSession({
    userId: target.user_id,
    impersonatorUserId: input.adminUserId,
    impersonatorEmail: input.adminEmail,
  });

  await recordAdminAuditEvent({
    actorUserId: input.adminUserId,
    actorEmail: input.adminEmail,
    targetTenantId: target.tenant_id,
    targetUserId: target.user_id,
    targetEmail: target.email,
    action: 'impersonation_started',
    details: {
      tenantSlug: target.tenant_slug,
      tenantName: target.tenant_name,
    },
  });

  return {
    ...created,
    target,
  };
}

export async function rotateAccessKeyForTenant(tenantId: string): Promise<{
  accessKey: string;
  accessKeyHint: string;
  accessKeyExpiresAt: string;
}> {
  const accessKey = createAccessKey();
  const accessKeyHash = await hashOpaqueToken(accessKey);
  const hint = accessKeyHint(accessKey);
  const expiresAt = accessKeyExpiryIso();
  const now = new Date().toISOString();

  await exec(`
    UPDATE tenants
    SET access_key_hash = $1,
        access_key_hint = $2,
        access_key_expires_at = $3,
        access_key_generated_at = $4,
        updated_at = $4
    WHERE tenant_id = $5
  `, [accessKeyHash, hint, expiresAt, now, tenantId]);

  return { accessKey, accessKeyHint: hint, accessKeyExpiresAt: expiresAt };
}

export async function createPasswordResetForEmail(input: {
  email: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  createdByAdmin?: boolean;
}): Promise<{
  ok: boolean;
  email: string;
  displayName: string;
  tenantId: string;
  tenantName: string;
  resetToken: string;
  expiresAt: string;
  createdByAdmin: boolean;
} | null> {
  const email = normalizeEmail(input.email);
  if (!email) {
    return null;
  }

  const owner = await queryOne<TenantOwnerRow>(`
    SELECT
      u.user_id,
      u.email,
      u.display_name,
      t.tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug
    FROM users u
    JOIN tenants t ON t.tenant_id = u.tenant_id
    WHERE u.email = $1
  `, [email]);

  if (!owner) {
    return null;
  }

  const resetToken = randomSecret(32);
  const resetTokenHash = hashOpaqueToken(resetToken);
  const expiresAt = passwordResetExpiryIso();
  const timestamp = new Date().toISOString();
  const createdByAdmin = Boolean(input.createdByAdmin && input.actorEmail);

  await withTransaction(async (client) => {
    await deletePasswordResetTokensForUser(owner.user_id, client);

    await exec(`
      INSERT INTO password_reset_tokens (
        reset_id,
        user_id,
        token_hash,
        created_by_admin,
        actor_user_id,
        actor_email,
        expires_at,
        consumed_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $8)
    `, [
      randomId('reset'),
      owner.user_id,
      resetTokenHash,
      createdByAdmin,
      input.actorUserId ?? null,
      input.actorEmail ? normalizeEmail(input.actorEmail) : null,
      expiresAt,
      timestamp,
    ], client);

    if (createdByAdmin && input.actorEmail) {
      await recordAdminAuditEvent({
        actorUserId: input.actorUserId ?? null,
        actorEmail: input.actorEmail,
        targetTenantId: owner.tenant_id,
        targetUserId: owner.user_id,
        targetEmail: owner.email,
        action: 'password_reset_issued',
        details: {
          expiresAt,
          tenantSlug: owner.tenant_slug,
          tenantName: owner.tenant_name,
        },
      }, client);
    }
  });

  return {
    ok: true,
    email: owner.email,
    displayName: owner.display_name,
    tenantId: owner.tenant_id,
    tenantName: owner.tenant_name,
    resetToken,
    expiresAt,
    createdByAdmin,
  };
}

export async function createPasswordResetForTenantOwner(input: {
  tenantId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  createdByAdmin?: boolean;
}) {
  const owner = await tenantOwnerRowForTenantId(input.tenantId);
  if (!owner) {
    throw new Error('Unknown tenant owner.');
  }

  return createPasswordResetForEmail({
    email: owner.email,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    createdByAdmin: input.createdByAdmin,
  });
}

export async function recordImpersonationEnded(input: {
  actorUserId: string;
  actorEmail: string;
  targetTenantId: string;
  targetUserId: string;
  targetEmail: string;
}): Promise<void> {
  await recordAdminAuditEvent({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    targetTenantId: input.targetTenantId,
    targetUserId: input.targetUserId,
    targetEmail: input.targetEmail,
    action: 'impersonation_ended',
  });
}

export async function resetPasswordWithToken(input: {
  token: string;
  password: string;
}): Promise<{ email: string; tenantName: string }> {
  const token = input.token.trim();
  if (!token) {
    throw new Error('Reset token is required.');
  }
  if (input.password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const tokenHash = hashOpaqueToken(token);
  const row = await queryOne<PasswordResetRow>(`
    SELECT
      pr.reset_id,
      pr.user_id,
      pr.token_hash,
      pr.expires_at,
      pr.created_by_admin,
      pr.actor_user_id,
      pr.actor_email,
      pr.consumed_at,
      u.email,
      u.display_name,
      t.tenant_id,
      t.name AS tenant_name
    FROM password_reset_tokens pr
    JOIN users u ON u.user_id = pr.user_id
    JOIN tenants t ON t.tenant_id = u.tenant_id
    WHERE pr.token_hash = $1
    LIMIT 1
  `, [tokenHash]);

  if (!row) {
    throw new Error('That reset link is invalid or has already been used.');
  }

  if (row.consumed_at) {
    throw new Error('That reset link has already been used.');
  }

  const expiry = new Date(row.expires_at);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() < Date.now()) {
    throw new Error('That reset link has expired. Request a new one.');
  }

  const passwordHash = await hashPassword(input.password);
  const timestamp = new Date().toISOString();

  await withTransaction(async (client) => {
    await exec(`
      UPDATE users
      SET
        password_hash = $2,
        updated_at = $3
      WHERE user_id = $1
    `, [row.user_id, passwordHash, timestamp], client);

    await exec(`
      UPDATE password_reset_tokens
      SET
        consumed_at = $2,
        updated_at = $2
      WHERE reset_id = $1
    `, [row.reset_id, timestamp], client);

    await deletePasswordResetTokensForUser(row.user_id, client);
    await deleteSessionsForUser(row.user_id, client);

    await recordAdminAuditEvent({
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email ?? row.email,
      targetTenantId: row.tenant_id,
      targetUserId: row.user_id,
      targetEmail: row.email,
      action: row.created_by_admin ? 'password_reset_completed' : 'self_service_password_reset_completed',
      details: {
        tenantName: row.tenant_name,
      },
    }, client);
  });

  return {
    email: row.email,
    tenantName: row.tenant_name,
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
    enabled: boolean;
    disabled_reason: string | null;
    access_key_expires_at: Date | string | null;
  }>(`
    SELECT tenant_id, name, enabled, disabled_reason, access_key_expires_at
    FROM tenants
    WHERE enrollment_key = $1
  `, [enrollmentKey.trim()]);

  if (!row) {
    return null;
  }

  const accessError = tenantAccessError({
    enabled: !!row.enabled,
    disabledReason: row.disabled_reason,
    accessKeyExpiresAt: row.access_key_expires_at,
    isPlatformAdmin: false,
  });
  if (accessError) {
    return null;
  }

  return {
    tenantId: row.tenant_id,
    tenantName: row.name,
  };
}

export async function listTenantsForAdmin(): Promise<TenantAccessSummary[]> {
  const rows = await query<TenantSummaryRow>(`
    SELECT
      t.tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug,
      owner.email AS owner_email,
      owner.display_name AS owner_display_name,
      t.default_alert_email,
      t.enabled,
      t.disabled_reason,
      t.access_key_hint,
      t.access_key_generated_at,
      t.access_key_expires_at,
      t.created_at,
      t.updated_at
    FROM tenants t
    LEFT JOIN LATERAL (
      SELECT u.email, u.display_name
      FROM users u
      WHERE u.tenant_id = t.tenant_id
      ORDER BY u.created_at ASC
      LIMIT 1
    ) owner ON TRUE
    ORDER BY t.created_at DESC, t.name ASC
  `);

  return rows.map(rowToTenantSummary);
}

export async function getTenantAccessSummary(tenantId: string): Promise<TenantAccessSummary | null> {
  const row = await queryOne<TenantSummaryRow>(`
    SELECT
      t.tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug,
      owner.email AS owner_email,
      owner.display_name AS owner_display_name,
      t.default_alert_email,
      t.enabled,
      t.disabled_reason,
      t.access_key_hint,
      t.access_key_generated_at,
      t.access_key_expires_at,
      t.created_at,
      t.updated_at
    FROM tenants t
    LEFT JOIN LATERAL (
      SELECT u.email, u.display_name
      FROM users u
      WHERE u.tenant_id = t.tenant_id
      ORDER BY u.created_at ASC
      LIMIT 1
    ) owner ON TRUE
    WHERE t.tenant_id = $1
  `, [tenantId]);

  return row ? rowToTenantSummary(row) : null;
}

export async function updateTenantEnabledState(input: {
  tenantId: string;
  enabled: boolean;
  disabledReason?: string | null;
}): Promise<TenantAccessSummary> {
  const timestamp = new Date().toISOString();
  const reason = (input.disabledReason ?? '').trim();

  await withTransaction(async (client) => {
    await exec(`
      UPDATE tenants
      SET
        enabled = $2,
        disabled_reason = CASE WHEN $2 THEN NULL ELSE $3 END,
        enabled_at = CASE WHEN $2 THEN $4 ELSE enabled_at END,
        disabled_at = CASE WHEN $2 THEN NULL ELSE $4 END,
        updated_at = $4
      WHERE tenant_id = $1
    `, [
      input.tenantId,
      input.enabled,
      reason || 'Disabled by administrator.',
      timestamp,
    ], client);

    if (!input.enabled) {
      await deleteSessionsForTenant(input.tenantId, client);
    }
  });

  const summary = await getTenantAccessSummary(input.tenantId);
  if (!summary) {
    throw new Error('Unknown tenant.');
  }

  return summary;
}

export async function rotateTenantAccessKey(input: {
  tenantId: string;
  validityDays?: number;
}): Promise<TenantAccessKeyRotation> {
  const accessKey = createAccessKey();
  const accessKeyHash = await hashAccessKey(accessKey);
  const timestamp = new Date().toISOString();
  const accessKeyExpiresAt = accessKeyExpiryIso(input.validityDays ?? accessKeyValidityDays());

  await withTransaction(async (client) => {
    await exec(`
      UPDATE tenants
      SET
        access_key_hash = $2,
        access_key_hint = $3,
        access_key_generated_at = $4,
        access_key_expires_at = $5,
        updated_at = $4
      WHERE tenant_id = $1
    `, [
      input.tenantId,
      accessKeyHash,
      accessKeyHint(accessKey),
      timestamp,
      accessKeyExpiresAt,
    ], client);

    await deleteSessionsForTenant(input.tenantId, client);
  });

  const summary = await getTenantAccessSummary(input.tenantId);
  if (!summary) {
    throw new Error('Unknown tenant.');
  }

  return {
    summary,
    accessKey,
  };
}

export async function deleteTenantAccount(input: {
  tenantId: string;
  actorUserId: string;
  actorEmail: string;
  actorTenantId: string;
}): Promise<TenantDeletionResult> {
  const summary = await getTenantAccessSummary(input.tenantId);
  if (!summary) {
    throw new Error('Unknown tenant.');
  }

  if (summary.tenantId === 'legacy-hub' || summary.tenantSlug === 'legacy-hub') {
    throw new Error('The built-in legacy workspace cannot be deleted.');
  }

  if (input.actorTenantId === input.tenantId) {
    throw new Error('You cannot delete the workspace you are currently signed into.');
  }

  const deletedAt = new Date().toISOString();
  const playerIds = await query<{ player_id: string }>(`
    SELECT p.player_id
    FROM players p
    JOIN sites s ON s.site_id = p.site_id
    WHERE s.tenant_id = $1
  `, [input.tenantId]);
  const playerIdList = playerIds.map((row) => row.player_id);
  const siteRows = await query<{ site_id: string }>(`
    SELECT site_id
    FROM sites
    WHERE tenant_id = $1
  `, [input.tenantId]);
  const siteIds = siteRows.map((row) => row.site_id);

  await withTransaction(async (client) => {
    const tenantUsers = await query<{ email: string }>(`
      SELECT email
      FROM users
      WHERE tenant_id = $1
    `, [input.tenantId], client);

    if (tenantUsers.some((row) => isPlatformAdminEmail(row.email))) {
      throw new Error('A platform-admin workspace cannot be deleted.');
    }

    await recordAdminAuditEvent({
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      targetTenantId: summary.tenantId,
      targetEmail: summary.ownerEmail,
      action: 'tenant_deleted',
      details: {
        tenantName: summary.tenantName,
        tenantSlug: summary.tenantSlug,
        ownerEmail: summary.ownerEmail,
        deletedSiteCount: siteIds.length,
        deletedPlayerCount: playerIdList.length,
      },
    }, client);

    if (siteIds.length > 0) {
      await exec(`
        DELETE FROM nodes
        WHERE site_id = ANY($1::text[])
      `, [siteIds], client);

      await exec(`
        DELETE FROM sites
        WHERE tenant_id = $1
      `, [input.tenantId], client);
    }

    await deleteSessionsForTenant(input.tenantId, client);

    await exec(`
      DELETE FROM tenants
      WHERE tenant_id = $1
    `, [input.tenantId], client);
  });

  clearStateCacheForInstances(playerIdList);
  clearInstanceControlsCacheForInstances(playerIdList);
  await deleteThumbnailsForPlayers(playerIdList);

  return {
    tenantId: summary.tenantId,
    tenantName: summary.tenantName,
    tenantSlug: summary.tenantSlug,
    ownerEmail: summary.ownerEmail,
    ownerDisplayName: summary.ownerDisplayName,
    deletedAt,
    deletedSiteCount: siteIds.length,
    deletedPlayerCount: playerIdList.length,
  };
}
