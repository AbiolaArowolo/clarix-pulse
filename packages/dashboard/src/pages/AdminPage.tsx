import React, { useEffect, useState } from 'react';
import { copyTextToClipboard } from '../lib/clipboard';

interface TenantSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  defaultAlertEmail: string | null;
  enabled: boolean;
  disabledReason: string | null;
  accessKeyHint: string | null;
  accessKeyExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [pendingTenantId, setPendingTenantId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/tenants');
      const payload = await response.json() as { tenants?: TenantSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to load tenants.');
      }
      setTenants(payload.tenants ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateAccess = async (tenantId: string, enabled: boolean) => {
      setPendingTenantId(tenantId);
    try {
      setError(null);
      setNotice(null);
      setRevealedKey(null);
      const response = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          disabledReason: enabled ? '' : 'Disabled by Clarix administrator.',
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
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

  const renewKey = async (tenantId: string) => {
    setPendingTenantId(tenantId);
    try {
      setError(null);
      setNotice(null);
      setRevealedKey(null);
      const response = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/renew-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendEmail: true, revealKey: false }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; accessKey?: string; emailed?: boolean };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to renew access key.');
      }
      setNotice(payload.emailed
        ? 'Access key renewed and emailed to the tenant owner.'
        : 'Access key renewed. Email delivery is unavailable, so the key is shown once below.');
      setRevealedKey(payload.accessKey ?? null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to renew access key.');
    } finally {
      setPendingTenantId(null);
    }
  };

  const copyRevealedKey = async () => {
    if (!revealedKey) return;
    try {
      await copyTextToClipboard(revealedKey);
      setNotice('Access key copied.');
    } catch {
      setError('Copy failed. Select the key and copy it manually.');
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Platform controls</h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Accounts register disabled by default. Enable them here when you are ready, and renew the 365-day access key whenever a customer needs a new one.
        </p>
      </section>

      {notice && (
        <div className="rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      )}

      {revealedKey && (
        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
          <p className="font-semibold">Access key fallback</p>
          <div className="mt-3 rounded-2xl border border-amber-300/15 bg-slate-950/70 px-4 py-3 font-mono text-sm text-cyan-100">
            {revealedKey}
          </div>
          <button
            type="button"
            onClick={() => void copyRevealedKey()}
            className="mt-3 rounded-full border border-amber-400/35 bg-amber-400/12 px-4 py-2 text-sm font-semibold text-amber-50 transition-colors hover:border-amber-300"
          >
            Copy fallback key
          </button>
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
            {tenants.map((tenant) => (
              <div
                key={tenant.tenantId}
                className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <p className="text-lg font-semibold text-white">{tenant.tenantName}</p>
                    <p className="text-sm text-slate-400">{tenant.tenantSlug}</p>
                    <p className="text-sm text-slate-300">
                      Owner: <span className="font-semibold text-white">{tenant.ownerDisplayName ?? 'Unknown'}</span>
                      {' '}| {tenant.ownerEmail ?? 'No email'}
                    </p>
                    <p className="text-sm text-slate-300">
                      Access: <span className="font-semibold text-white">{tenant.enabled ? 'Enabled' : 'Disabled'}</span>
                      {' '}| Key hint: <span className="font-semibold text-white">{tenant.accessKeyHint ?? 'Not issued'}</span>
                    </p>
                    <p className="text-sm text-slate-400">
                      Key expires: {tenant.accessKeyExpiresAt ?? 'Not set'}
                    </p>
                    {tenant.disabledReason && (
                      <p className="text-sm text-slate-500">{tenant.disabledReason}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void updateAccess(tenant.tenantId, !tenant.enabled)}
                      disabled={pendingTenantId === tenant.tenantId}
                      className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tenant.enabled ? 'Disable account' : 'Enable account'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void renewKey(tenant.tenantId)}
                      disabled={pendingTenantId === tenant.tenantId}
                      className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pendingTenantId === tenant.tenantId ? 'Working...' : 'Renew 365-day key'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
