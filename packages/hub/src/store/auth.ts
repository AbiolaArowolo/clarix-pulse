import crypto from 'crypto';
import { QueryResultRow } from 'pg';
import { exec, query, queryOne, withTransaction } from './db';
import { clearInstanceControlsCacheForInstances } from './instanceControls';
import { clearStateCacheForInstances } from './state';
import { deleteThumbnailsForPlayers } from './thumbnails';

// LEARN: Clerk vs. Pulse's own tables.
// Clerk is a *pure authentication layer* -- it proves "this browser is this
// person" and owns the login session/cookie. It knows nothing about tenants,
// roles, or impersonation, and we deliberately never write that data into
// Clerk (no tenant/role in Clerk metadata). Everything in this file is the
// authorization side: which Pulse tenant a person belongs to, what role they
// hold, whether their tenant is enabled, and (for platform admins) which
// tenant they are currently impersonating. That side stays 100% in Postgres,
// same as before this migration -- only the identity-proving step changed.

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
  createdAt: string;
  updatedAt: string;
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

// A Pulse user row joined with its tenant -- the shared shape every lookup
// (by user_id, by clerk_user_id, by email) returns, so session-building logic
// only needs to live in one place (sessionFromRow).
interface PulseUserRow extends QueryResultRow {
  user_id: string;
  clerk_user_id: string | null;
  email: string;
  display_name: string;
  role: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  enrollment_key: string;
  default_alert_email: string | null;
  enabled: boolean;
  disabled_reason: string | null;
}

interface ImpersonationSessionRow extends PulseUserRow {
  impersonator_user_id: string;
  impersonator_email: string;
  impersonation_started_at: Date | string;
  expires_at: Date | string;
}

interface UserRow extends QueryResultRow {
  user_id: string;
}

interface TenantRow extends QueryResultRow {
  tenant_id: string;
}

interface TenantOwnerRow extends QueryResultRow {
  user_id: string;
  email: string;
  display_name: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
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

// Impersonation sessions are Pulse-issued and Pulse-verified (they are not
// Clerk sessions -- the impersonating admin's own Clerk cookie never
// changes). This TTL bounds how long a "support mode" window can stay open
// before the admin has to re-open it from the admin console.
const IMPERSONATION_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

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

function tenantAccessError(input: {
  enabled: boolean;
  disabledReason: string | null;
  isPlatformAdmin: boolean;
}): string | null {
  if (input.isPlatformAdmin) {
    return null;
  }

  if (!input.enabled) {
    return input.disabledReason?.trim() || 'Account pending activation. Clarix must enable this account before you can sign in.';
  }

  return null;
}

const VALID_ROLES: ReadonlySet<string> = new Set(['super_admin', 'admin', 'support', 'user']);

function resolveRole(dbRole: string, isPlatformAdmin: boolean): UserRole {
  // Email-based super_admin takes precedence over the DB role.
  if (isPlatformAdmin) {
    return 'super_admin';
  }

  return VALID_ROLES.has(dbRole) ? (dbRole as UserRole) : 'user';
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

// Builds the authoritative AuthenticatedSession from a Pulse user+tenant row.
// `impersonation` is non-null only when this session is a platform admin's
// support-mode overlay onto a tenant owner's account; when present, the
// effective role/isPlatformAdmin are always forced down to a plain tenant
// user regardless of the target row's own role, matching the pre-Clerk
// behaviour exactly.
function sessionFromRow(
  row: PulseUserRow,
  impersonation: { userId: string; email: string; startedAt: string } | null,
  expiresAt: string,
): AuthenticatedSession {
  const isPlatformAdmin = isPlatformAdminEmail(row.email);
  const impersonating = Boolean(impersonation);
  const role = impersonating ? 'user' : resolveRole(row.role, isPlatformAdmin);

  return {
    sessionId: impersonation ? `impersonation-${row.user_id}` : `identity-${row.user_id}`,
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    enrollmentKey: row.enrollment_key,
    defaultAlertEmail: row.default_alert_email,
    email: row.email,
    displayName: row.display_name,
    expiresAt,
    role,
    isPlatformAdmin: impersonating ? false : (isPlatformAdmin || role === 'super_admin'),
    tenantEnabled: !!row.enabled,
    disabledReason: row.disabled_reason,
    impersonating,
    impersonatorUserId: impersonation?.userId ?? null,
    impersonatorEmail: impersonation?.email ?? null,
    impersonationStartedAt: impersonation?.startedAt ?? null,
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

const PULSE_USER_SELECT = `
  SELECT
    u.user_id,
    u.clerk_user_id,
    u.email,
    u.display_name,
    u.role,
    t.tenant_id,
    t.name AS tenant_name,
    t.slug AS tenant_slug,
    t.enrollment_key,
    t.default_alert_email,
    t.enabled,
    t.disabled_reason
  FROM users u
  JOIN tenants t ON t.tenant_id = u.tenant_id
`;

async function pulseUserRowForUserId(userId: string): Promise<PulseUserRow | null> {
  return queryOne<PulseUserRow>(`${PULSE_USER_SELECT} WHERE u.user_id = $1`, [userId]);
}

async function pulseUserRowForClerkUserId(clerkUserId: string): Promise<PulseUserRow | null> {
  return queryOne<PulseUserRow>(`${PULSE_USER_SELECT} WHERE u.clerk_user_id = $1`, [clerkUserId]);
}

async function pulseUserRowForEmail(email: string): Promise<PulseUserRow | null> {
  return queryOne<PulseUserRow>(`${PULSE_USER_SELECT} WHERE u.email = $1`, [email]);
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
    throw new Error('That email is already registered. Sign in with Clerk instead of registering again.');
  }
}

async function ensureUniqueClerkUserId(clerkUserId: string, client?: Parameters<typeof exec>[2]): Promise<void> {
  const existing = await queryOne<UserRow>(`
    SELECT user_id
    FROM users
    WHERE clerk_user_id = $1
  `, [clerkUserId], client);

  if (existing) {
    throw new Error('This Clerk account is already linked to a Pulse workspace.');
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

// Account linking. Called on every request that carries a verified Clerk
// identity. Order of resolution:
//   1. clerk_user_id match -- the common case once a user has signed in once.
//   2. Fallback to a verified-email match on a still-unlinked Pulse user
//      (admin-provisioned account, first Clerk sign-in) -- link it.
//   3. No match at all -- this Clerk identity has no Pulse account. Returns
//      null; the caller (serverAuth.getSessionFromRequest) treats that as
//      unauthenticated for protected routes, or the register endpoint uses it
//      to create a brand-new tenant for this identity.
// The partial unique index on users(clerk_user_id) (see store/db.ts) is what
// actually enforces "only link if no other Pulse user already has that
// clerk_user_id" -- the WHERE clerk_user_id IS NULL guard below makes the
// UPDATE a no-op if a concurrent request wins the race first.
export async function resolveOrLinkPulseUserByClerkIdentity(identity: {
  clerkUserId: string;
  email: string;
}): Promise<PulseUserRow | null> {
  const byClerkId = await pulseUserRowForClerkUserId(identity.clerkUserId);
  if (byClerkId) {
    return byClerkId;
  }

  const email = normalizeEmail(identity.email);
  if (!email) {
    return null;
  }

  const byEmail = await pulseUserRowForEmail(email);
  if (!byEmail) {
    return null;
  }

  if (byEmail.clerk_user_id) {
    // This Pulse account is already linked to a *different* Clerk identity.
    // Do not silently reassign it -- that would let anyone who can create a
    // Clerk account with a matching email take over another person's tenant
    // access. Deny rather than link.
    return byEmail.clerk_user_id === identity.clerkUserId ? byEmail : null;
  }

  await exec(`
    UPDATE users
    SET clerk_user_id = $1, updated_at = $2
    WHERE user_id = $3 AND clerk_user_id IS NULL
  `, [identity.clerkUserId, new Date().toISOString(), byEmail.user_id]);

  // Re-read rather than trust the UPDATE locally: if a concurrent request
  // linked this same clerk_user_id to a *different* Pulse user first, our
  // WHERE clause above matched zero rows, and the correct outcome is to
  // resolve by clerk_user_id fresh (which will find that other user, or
  // nothing if this identity truly isn't linked anywhere).
  return pulseUserRowForClerkUserId(identity.clerkUserId);
}

// Builds the plain (non-impersonating) AuthenticatedSession for a Clerk
// identity, applying the tenant-enabled gate. Used by both the Express
// request path and the Socket.IO handshake path in serverAuth.ts.
export async function getIdentitySessionForClerkUser(input: {
  clerkUserId: string;
  email: string;
  expiresAt: string;
}): Promise<AuthenticatedSession | null> {
  const row = await resolveOrLinkPulseUserByClerkIdentity({
    clerkUserId: input.clerkUserId,
    email: input.email,
  });
  if (!row) {
    return null;
  }

  const isPlatformAdmin = isPlatformAdminEmail(row.email);
  const accessError = tenantAccessError({
    enabled: !!row.enabled,
    disabledReason: row.disabled_reason,
    isPlatformAdmin,
  });
  if (accessError) {
    return null;
  }

  return sessionFromRow(row, null, input.expiresAt);
}

// Used only by the PULSE_DISABLE_LOGIN bypass, which is orthogonal to the
// Clerk migration -- it resolves straight to a Pulse user id with no Clerk
// identity involved at all, same as it resolved straight to a session token
// before Clerk existed.
export async function resolveUserIdByEmail(emailInput: string): Promise<string | null> {
  const email = normalizeEmail(emailInput);
  const row = await queryOne<{ user_id: string }>(`
    SELECT user_id FROM users WHERE email = $1
  `, [email]);
  return row?.user_id ?? null;
}

export async function buildSessionForUserId(userId: string, expiresAt: string): Promise<AuthenticatedSession | null> {
  const row = await pulseUserRowForUserId(userId);
  if (!row) {
    return null;
  }

  const isPlatformAdmin = isPlatformAdminEmail(row.email);
  const accessError = tenantAccessError({
    enabled: !!row.enabled,
    disabledReason: row.disabled_reason,
    isPlatformAdmin,
  });
  if (accessError) {
    return null;
  }

  return sessionFromRow(row, null, expiresAt);
}

// New Pulse users are still admin-provisioned (tenant assignment is not
// self-service) -- the one exception is a brand-new company workspace: the
// first user of a tenant creates the tenant and themselves atomically, same
// as before Clerk. What changed is *how* that person proves who they are:
// the caller (routes/auth.ts) must already hold a verified Clerk identity
// before calling this, and clerkUserId/email come from that identity rather
// than from a submitted password.
export async function registerTenantOwner(input: {
  companyName: string;
  displayName: string;
  clerkUserId: string;
  email: string;
}): Promise<RegistrationResult> {
  const email = normalizeEmail(input.email);
  const companyName = normalizeTenantName(input.companyName, email);
  const displayName = normalizeDisplayName(input.displayName, companyName);

  if (!email || !email.includes('@')) {
    throw new Error('A verified email address is required.');
  }
  if (!companyName) {
    throw new Error('Company name is required.');
  }

  const tenantId = randomId('tenant');
  const userId = randomId('user');
  const timestamp = new Date().toISOString();
  const enrollmentKey = randomSecret(24);
  let tenantSlug = '';

  await withTransaction(async (client) => {
    await ensureUniqueUserEmail(email, client);
    await ensureUniqueClerkUserId(input.clerkUserId, client);
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
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, TRUE, NULL, $6, $6)
    `, [
      tenantId,
      companyName,
      tenantSlug,
      enrollmentKey,
      email,
      timestamp,
    ], client);

    // The person who self-registers a brand-new tenant is that tenant's
    // owner -- give them role='admin' (not the DB default 'user') so they
    // can invite teammates immediately after creating their workspace,
    // without needing a second platform-admin step to promote them.
    await exec(`
      INSERT INTO users (
        user_id,
        tenant_id,
        clerk_user_id,
        email,
        display_name,
        role,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'admin', $6, $6)
    `, [userId, tenantId, input.clerkUserId, email, displayName, timestamp], client);

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
  };
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

// --- Impersonation ("support mode") ----------------------------------------
// The `sessions` table is now used for impersonation only -- regular sign-in
// sessions live entirely in Clerk. A platform admin's own Clerk cookie never
// changes while they impersonate; this row + the clarix_pulse_impersonation
// cookie (serverAuth.ts) are a Pulse-owned overlay checked on top of their
// Clerk identity on every request.

export async function createImpersonationSessionForTenant(input: {
  tenantId: string;
  adminUserId: string;
  adminEmail: string;
}): Promise<{ sessionToken: string; session: AuthenticatedSession; target: TenantOwnerRow }> {
  const adminRow = await pulseUserRowForUserId(input.adminUserId);
  if (!adminRow || !isPlatformAdminEmail(adminRow.email)) {
    throw new Error('Platform admin access required.');
  }

  const target = await tenantOwnerRowForTenantId(input.tenantId);
  if (!target) {
    throw new Error('Unknown tenant owner.');
  }

  if (target.user_id === input.adminUserId) {
    throw new Error('You are already in this workspace.');
  }

  const sessionId = randomId('session');
  const sessionToken = randomSecret(32);
  const sessionTokenHash = hashSessionToken(sessionToken);
  const timestamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + IMPERSONATION_SESSION_TTL_MS).toISOString();
  const adminEmail = normalizeEmail(input.adminEmail);

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
    target.user_id,
    sessionTokenHash,
    input.adminUserId,
    adminEmail,
    timestamp,
    expiresAt,
    timestamp,
  ]);

  const targetRow = await pulseUserRowForUserId(target.user_id);
  if (!targetRow) {
    throw new Error('Unknown tenant owner.');
  }

  const session = sessionFromRow(
    targetRow,
    { userId: input.adminUserId, email: adminEmail, startedAt: timestamp },
    expiresAt,
  );

  await recordAdminAuditEvent({
    actorUserId: input.adminUserId,
    actorEmail: adminEmail,
    targetTenantId: target.tenant_id,
    targetUserId: target.user_id,
    targetEmail: target.email,
    action: 'impersonation_started',
    details: {
      tenantSlug: target.tenant_slug,
      tenantName: target.tenant_name,
    },
  });

  return { sessionToken, session, target };
}

export async function getImpersonationSessionFromToken(sessionToken: string): Promise<AuthenticatedSession | null> {
  const trimmed = sessionToken.trim();
  if (!trimmed) {
    return null;
  }

  const row = await queryOne<ImpersonationSessionRow>(`
    SELECT
      u.user_id,
      u.clerk_user_id,
      u.email,
      u.display_name,
      u.role,
      t.tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug,
      t.enrollment_key,
      t.default_alert_email,
      t.enabled,
      t.disabled_reason,
      s.impersonator_user_id,
      s.impersonator_email,
      s.impersonation_started_at,
      s.expires_at
    FROM sessions s
    JOIN users u ON u.user_id = s.user_id
    JOIN tenants t ON t.tenant_id = u.tenant_id
    WHERE s.session_token_hash = $1
      AND s.expires_at > NOW()
      AND s.impersonator_user_id IS NOT NULL
  `, [hashSessionToken(trimmed)]);

  if (!row) {
    return null;
  }

  // Impersonation always bypasses the target tenant's enabled/disabled gate
  // -- support needs to be able to open a disabled tenant to diagnose it,
  // same as before this migration.
  return sessionFromRow(row, {
    userId: row.impersonator_user_id,
    email: row.impersonator_email,
    startedAt: toIso(row.impersonation_started_at),
  }, toIso(row.expires_at));
}

export async function deleteImpersonationSession(sessionToken: string): Promise<void> {
  const trimmed = sessionToken.trim();
  if (!trimmed) {
    return;
  }

  await exec(`
    DELETE FROM sessions
    WHERE session_token_hash = $1
  `, [hashSessionToken(trimmed)]);
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

// --- Node/agent bootstrap (unrelated to user auth) --------------------------
// enrollment_key gates machine enrollment (routes/config.ts), not user
// login -- kept here only because it shares the tenants table and the
// enabled/disabled gate.
export async function findTenantByEnrollmentKey(enrollmentKey: string): Promise<{
  tenantId: string;
  tenantName: string;
} | null> {
  const row = await queryOne<{
    tenant_id: string;
    name: string;
    enabled: boolean;
    disabled_reason: string | null;
  }>(`
    SELECT tenant_id, name, enabled, disabled_reason
    FROM tenants
    WHERE enrollment_key = $1
  `, [enrollmentKey.trim()]);

  if (!row) {
    return null;
  }

  const accessError = tenantAccessError({
    enabled: !!row.enabled,
    disabledReason: row.disabled_reason,
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

export async function getTenantEnrollmentKey(tenantId: string): Promise<string | null> {
  const row = await queryOne<{ enrollment_key: string }>(`
    SELECT enrollment_key FROM tenants WHERE tenant_id = $1
  `, [tenantId]);

  return row ? row.enrollment_key : null;
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
      // Only impersonation sessions live in this table now, but a disabled
      // tenant should not be reachable through a stale support-mode window
      // either -- drop any for this tenant.
      await deleteSessionsForTenant(input.tenantId, client);
    }
  });

  const summary = await getTenantAccessSummary(input.tenantId);
  if (!summary) {
    throw new Error('Unknown tenant.');
  }

  return summary;
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

// --- Teammates / invites (tenant-scoped role management) -------------------
// A "teammate" is just a row in `users` for the caller's own tenant. An
// invited-but-not-yet-signed-in teammate is indistinguishable in shape from
// an active one -- the only difference is clerk_user_id IS NULL ("pending").
// When that person later signs in through Clerk with a matching verified
// email, resolveOrLinkPulseUserByClerkIdentity (above) links this exact row
// rather than creating anything new -- invites and self-registration share
// one linking path by construction, not by a special case here.

export type TeammateStatus = 'active' | 'pending';

export interface TeammateSummary {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: TeammateStatus;
  createdAt: string;
  updatedAt: string;
}

interface TeammateRow extends QueryResultRow {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  clerk_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

// Deliberately excludes 'super_admin' -- that role is only ever assigned via
// the platform-admin email allowlist (resolveRole), never stored/settable on
// a tenant-scoped user row. An admin can hand out admin/user/support only.
const INVITABLE_ROLES: ReadonlySet<string> = new Set(['admin', 'user', 'support']);

function assertInvitableRole(role: string): void {
  if (!INVITABLE_ROLES.has(role)) {
    throw new Error('Role must be one of: admin, user, support.');
  }
}

function rowToTeammateSummary(row: TeammateRow): TeammateSummary {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: VALID_ROLES.has(row.role) ? (row.role as UserRole) : 'user',
    status: row.clerk_user_id ? 'active' : 'pending',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const TEAMMATE_SELECT = `
  SELECT user_id, email, display_name, role, clerk_user_id, created_at, updated_at
  FROM users
`;

async function teammateRowForTenant(
  tenantId: string,
  userId: string,
  client?: Parameters<typeof exec>[2],
): Promise<TeammateRow | null> {
  return queryOne<TeammateRow>(`
    ${TEAMMATE_SELECT}
    WHERE tenant_id = $1 AND user_id = $2
  `, [tenantId, userId], client);
}

export async function listTeammatesForTenant(tenantId: string): Promise<TeammateSummary[]> {
  const rows = await query<TeammateRow>(`
    ${TEAMMATE_SELECT}
    WHERE tenant_id = $1
    ORDER BY created_at ASC
  `, [tenantId]);

  return rows.map(rowToTeammateSummary);
}

// Pre-creates the pending row an invited teammate will link to on their
// first Clerk sign-in. clerk_user_id stays NULL -- there is nothing else to
// set up front since Clerk owns credentials entirely; the invited person
// proves who they are by signing up with the same email this row was
// created with.
export async function createTeammateInvite(input: {
  tenantId: string;
  inviterUserId: string;
  inviterEmail: string;
  email: string;
  displayName: string;
  role: string;
}): Promise<TeammateSummary> {
  assertInvitableRole(input.role);

  const email = normalizeEmail(input.email);
  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required.');
  }
  const displayName = normalizeDisplayName(input.displayName, email);
  const userId = randomId('user');
  const timestamp = new Date().toISOString();

  await withTransaction(async (client) => {
    // Same uniqueness guard registerTenantOwner relies on -- reusing it here
    // is what stops one email from ever holding a pending invite in two
    // tenants at once, and (together with the linking logic) is what stops
    // an invited email from spinning up a second, unrelated workspace via
    // self-registration instead of accepting the invite.
    //
    // SECURITY: ensureUniqueUserEmail's error message ("That email is
    // already registered. Sign in with Clerk instead of registering
    // again.") is written for the self-registration flow, where the person
    // reading it IS the email owner. Here the reader is a different actor
    // (the inviting tenant admin), so forwarding that message verbatim
    // would let anyone with admin on any tenant probe arbitrary email
    // addresses and learn whether they already have a Pulse account in a
    // *different* tenant -- a cross-tenant account-existence oracle. Catch
    // it and surface a tenant-agnostic message instead.
    try {
      await ensureUniqueUserEmail(email, client);
    } catch {
      throw new Error('Could not create that invite.');
    }

    await exec(`
      INSERT INTO users (
        user_id, tenant_id, clerk_user_id, email, display_name, role, created_at, updated_at
      )
      VALUES ($1, $2, NULL, $3, $4, $5, $6, $6)
    `, [userId, input.tenantId, email, displayName, input.role, timestamp], client);

    await recordAdminAuditEvent({
      actorUserId: input.inviterUserId,
      actorEmail: input.inviterEmail,
      targetTenantId: input.tenantId,
      targetUserId: userId,
      targetEmail: email,
      action: 'teammate_invited',
      details: { role: input.role, displayName },
    }, client);
  });

  return {
    userId,
    email,
    displayName,
    role: input.role as UserRole,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function revokeTeammateInvite(input: {
  tenantId: string;
  actorUserId: string;
  actorEmail: string;
  targetUserId: string;
}): Promise<void> {
  const row = await teammateRowForTenant(input.tenantId, input.targetUserId);
  if (!row) {
    throw new Error('Unknown teammate.');
  }
  if (row.clerk_user_id) {
    throw new Error('This invite was already accepted. Remove the teammate instead of revoking their invite.');
  }

  await withTransaction(async (client) => {
    // WHERE clerk_user_id IS NULL guards against a race where the invite was
    // accepted (and linked) between the check above and this delete -- if
    // that happens this becomes a no-op rather than deleting a live account.
    await exec(`
      DELETE FROM users
      WHERE user_id = $1 AND tenant_id = $2 AND clerk_user_id IS NULL
    `, [input.targetUserId, input.tenantId], client);

    await recordAdminAuditEvent({
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      targetTenantId: input.tenantId,
      targetUserId: input.targetUserId,
      targetEmail: row.email,
      action: 'teammate_invite_revoked',
    }, client);
  });
}

export async function updateTeammateRole(input: {
  tenantId: string;
  actorUserId: string;
  actorEmail: string;
  targetUserId: string;
  role: string;
}): Promise<TeammateSummary> {
  // A user must never be able to change their own role -- checked here
  // rather than only in the route layer so every caller gets the guarantee.
  if (input.targetUserId === input.actorUserId) {
    throw new Error('You cannot change your own role.');
  }
  assertInvitableRole(input.role);

  const row = await teammateRowForTenant(input.tenantId, input.targetUserId);
  if (!row) {
    throw new Error('Unknown teammate.');
  }

  const timestamp = new Date().toISOString();
  await withTransaction(async (client) => {
    await exec(`
      UPDATE users SET role = $1, updated_at = $2 WHERE user_id = $3 AND tenant_id = $4
    `, [input.role, timestamp, input.targetUserId, input.tenantId], client);

    await recordAdminAuditEvent({
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      targetTenantId: input.tenantId,
      targetUserId: input.targetUserId,
      targetEmail: row.email,
      action: 'teammate_role_changed',
      details: { fromRole: row.role, toRole: input.role },
    }, client);
  });

  return rowToTeammateSummary({ ...row, role: input.role, updated_at: timestamp });
}

export async function removeTeammateFromTenant(input: {
  tenantId: string;
  actorUserId: string;
  actorEmail: string;
  targetUserId: string;
}): Promise<void> {
  if (input.targetUserId === input.actorUserId) {
    throw new Error('You cannot remove yourself from the tenant.');
  }

  const row = await teammateRowForTenant(input.tenantId, input.targetUserId);
  if (!row) {
    throw new Error('Unknown teammate.');
  }

  await withTransaction(async (client) => {
    // FOR UPDATE locks every row for this tenant so a concurrent
    // removeTeammateFromTenant call for the same tenant blocks here until
    // this transaction commits/rolls back, instead of both reading the
    // same pre-removal count and both passing the "more than one member
    // left" guard -- otherwise two admins removing each other at the same
    // moment could both succeed and strand the tenant with zero users.
    const remaining = await queryOne<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM users WHERE tenant_id = $1 FOR UPDATE
    `, [input.tenantId], client);
    if (remaining && Number(remaining.count) <= 1) {
      throw new Error('Cannot remove the last remaining member of a workspace.');
    }

    // sessions.user_id is ON DELETE CASCADE, so any impersonation session
    // pointed at this user is cleaned up automatically by this delete --
    // no separate cleanup query needed.
    await exec(`DELETE FROM users WHERE user_id = $1 AND tenant_id = $2`, [input.targetUserId, input.tenantId], client);

    await recordAdminAuditEvent({
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      targetTenantId: input.tenantId,
      targetUserId: input.targetUserId,
      targetEmail: row.email,
      action: 'teammate_removed',
    }, client);
  });
}
