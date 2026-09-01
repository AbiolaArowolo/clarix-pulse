import React, { useEffect, useState } from 'react';

interface TenantSummary {
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

interface AdminAuditEvent {
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

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

export function AdminPage({
  onNavigate,
  onRefreshSession,
}: {
  onNavigate: (pathname: string) => void;
  onRefreshSession: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [pendingTenantId, setPendingTenantId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantsResponse, auditResponse] = await Promise.all([
        fetch('/api/admin/tenants'),
        fetch('/api/admin/audit?limit=25'),
      ]);
      const tenantPayload = await readJsonResponse<{ tenants?: TenantSummary[]; error?: string }>(tenantsResponse);
      if (!tenantsResponse.ok) {
        throw new Error(tenantPayload.error ?? 'Failed to load tenants.');
      }
      const auditPayload = await readJsonResponse<{ events?: AdminAuditEvent[]; error?: string }>(auditResponse);
      if (!auditResponse.ok) {
        throw new Error(auditPayload.error ?? 'Failed to load admin activity.');
      }

      setTenants(tenantPayload.tenants ?? []);
      setEvents(auditPayload.events ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetFeedback = () => {
    setError(null);
    setNotice(null);
  };

  const updateAccess = async (tenantId: string, enabled: boolean) => {
    setPendingTenantId(tenantId);
    try {
      resetFeedback();
      const response = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          disabledReason: enabled ? '' : 'Disabled by Clarix administrator.',
        }),
      });
      const payload = await readJsonResponse<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to update tenant access.');
      }
      setNotice(enabled ? 'Tenant enabled.' : 'Tenant disabled.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tenant access.');
    } finally {
      setPendingTenantId(null);
    }
  };

  const openWorkspace = async (tenantId: string) => {
    setPendingTenantId(tenantId);
    try {
      resetFeedback();
      const response = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/impersonate`, {
        method: 'POST',
      });
      const payload = await readJsonResponse<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to open the tenant workspace.');
      }

      await onRefreshSession();
      onNavigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open the tenant workspace.');
    } finally {
      setPendingTenantId(null);
    }
  };

  const deleteTenant = async (tenantId: string, tenantName: string) => {
    const confirmed = window.confirm(
      `Delete "${tenantName}" permanently? This removes the account, its nodes, players, and local dashboard inventory. This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setPendingTenantId(tenantId);
    try {
      resetFeedback();
      const response = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'DELETE',
      });
      const payload = await readJsonResponse<{ ok?: boolean; error?: string; deleted?: { tenantName?: string } }>(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to delete the tenant account.');
      }

      setNotice(`Tenant deleted: ${payload.deleted?.tenantName ?? tenantName}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the tenant account.');
    } finally {
      setPendingTenantId(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Platform controls</h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Accounts register disabled by default. Enable them here when you are ready, open the customer workspace directly for support, or permanently delete unwanted customer accounts. Sign-in identity is managed in Clerk - tenant access and account deletion stay under platform control here.
        </p>
      </section>

      {notice && (
        <div className="rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
        {loading ? (
          <p className="text-sm text-slate-400">Loading tenant access state...</p>
        ) : tenants.length === 0 ? (
          <p className="text-sm text-slate-400">No tenants found yet.</p>
        ) : (
          <div className="space-y-4">
            {tenants.map((tenant) => {
              const pending = pendingTenantId === tenant.tenantId;
              return (
                <div
                  key={tenant.tenantId}
                  className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4"
                >
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(620px,0.95fr)] xl:items-start">
                    <div className="space-y-2">
                      <p className="text-lg font-semibold text-white">{tenant.tenantName}</p>
                      <p className="text-sm text-slate-400">{tenant.tenantSlug}</p>
                      <p className="text-sm text-slate-300">
                        Owner: <span className="font-semibold text-white">{tenant.ownerDisplayName ?? 'Unknown'}</span>
                        {' '}| {tenant.ownerEmail ?? 'No email'}
                      </p>
                      <p className="text-sm text-slate-300">
                        Access: <span className="font-semibold text-white">{tenant.enabled ? 'Enabled' : 'Disabled'}</span>
                      </p>
                      {tenant.disabledReason && (
                        <p className="text-sm text-slate-500">{tenant.disabledReason}</p>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => void openWorkspace(tenant.tenantId)}
                        disabled={pending}
                        className="inline-flex min-h-10 items-center justify-center rounded-full border border-amber-400/35 bg-amber-400/12 px-4 py-2 text-center text-sm font-semibold text-amber-50 transition-colors hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pending ? 'Working...' : 'Open workspace'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateAccess(tenant.tenantId, !tenant.enabled)}
                        disabled={pending}
                        className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-center text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {tenant.enabled ? 'Disable account' : 'Enable account'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteTenant(tenant.tenantId, tenant.tenantName)}
                        disabled={pending}
                        className="inline-flex min-h-10 items-center justify-center rounded-full border border-red-500/35 bg-red-500/12 px-4 py-2 text-center text-sm font-semibold text-red-50 transition-colors hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pending ? 'Working...' : 'Delete account'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Recent support activity</h3>
        {loading ? (
          <p className="mt-4 text-sm text-slate-400">Loading admin activity...</p>
        ) : events.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No admin activity recorded yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {events.map((event) => (
              <div
                key={event.eventId}
                className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4"
              >
                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px] lg:items-start">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{event.action.replace(/_/g, ' ')}</p>
                    <p className="mt-1 break-words text-sm text-slate-400">
                      Actor: <span className="text-slate-200">{event.actorEmail}</span>
                      {event.targetTenantName ? ` | Tenant: ${event.targetTenantName}` : ''}
                      {event.targetEmail ? ` | Target: ${event.targetEmail}` : ''}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 lg:text-right">{event.createdAt}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
