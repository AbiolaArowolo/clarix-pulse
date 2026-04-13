import React, { useEffect, useState } from 'react';
import { InstallWorkspacePanel } from '../components/InstallWorkspacePanel';
import { copyTextToClipboard } from '../lib/clipboard';
import { downloadAuthenticatedFile, requestAuthenticatedDownloadLink } from '../lib/downloads';

const INSTALLER_DOWNLOAD_NAME = 'clarix-pulse-latest.zip';

interface SessionShape {
  user: {
    displayName: string;
    email: string;
    isPlatformAdmin?: boolean;
  };
  tenant: {
    name: string;
    slug: string;
    defaultAlertEmail: string | null;
    enrollmentKey: string;
    enabled?: boolean;
    disabledReason?: string | null;
    accessKeyHint?: string | null;
    accessKeyExpiresAt?: string | null;
  };
}

interface TenantNodeRecord {
  nodeId: string;
  siteId: string;
  instanceCount: number;
  labels: string[];
}

function formatDateLabel(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function AccountPage({
  session,
}: {
  session: SessionShape;
}) {
  const accessLabel = session.tenant.enabled ? 'Access active' : 'Pending activation';
  const defaultAlertTarget = session.tenant.defaultAlertEmail ?? session.user.email;
  const accessWindowLabel = formatDateLabel(session.tenant.accessKeyExpiresAt) ?? 'Not set';
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [secureLink, setSecureLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [keyRequestBusy, setKeyRequestBusy] = useState(false);
  const [keyRequestNotice, setKeyRequestNotice] = useState<string | null>(null);
  const [keyRequestError, setKeyRequestError] = useState<string | null>(null);
  const [nodeRecords, setNodeRecords] = useState<TenantNodeRecord[]>([]);
  const [nodeCleanupLoading, setNodeCleanupLoading] = useState(false);
  const [nodeCleanupBusyId, setNodeCleanupBusyId] = useState<string | null>(null);
  const [nodeCleanupNotice, setNodeCleanupNotice] = useState<string | null>(null);
  const [nodeCleanupError, setNodeCleanupError] = useState<string | null>(null);

  const refreshNodeRecords = async () => {
    setNodeCleanupLoading(true);
    setNodeCleanupError(null);
    try {
      const response = await fetch('/api/status');
      const payload = await response.json() as {
        sites?: Array<{
          id?: string;
          instances?: Array<{ nodeId?: string; label?: string }>;
        }>;
      };
      if (!response.ok) {
        throw new Error('Failed to load node records from hub status.');
      }

      const map = new Map<string, TenantNodeRecord>();
      for (const site of payload.sites ?? []) {
        const siteId = site.id ?? '';
        for (const instance of site.instances ?? []) {
          const nodeId = (instance.nodeId ?? '').trim();
          if (!nodeId) continue;
          const current = map.get(nodeId) ?? {
            nodeId,
            siteId,
            instanceCount: 0,
            labels: [],
          };
          current.instanceCount += 1;
          const label = (instance.label ?? '').trim();
          if (label && !current.labels.includes(label)) {
            current.labels.push(label);
          }
          map.set(nodeId, current);
        }
      }

      setNodeRecords(
        Array.from(map.values())
          .sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
      );
    } catch (error) {
      setNodeCleanupError(error instanceof Error ? error.message : 'Failed to load node records.');
    } finally {
      setNodeCleanupLoading(false);
    }
  };

  const removeNodeRecord = async (nodeId: string) => {
    const normalizedNodeId = nodeId.trim();
    if (!normalizedNodeId) return;

    const confirmed = window.confirm(
      `Remove node "${normalizedNodeId}" from this workspace hub inventory? This deletes mirrored player records for that node.`,
    );
    if (!confirmed) return;

    setNodeCleanupBusyId(normalizedNodeId);
    setNodeCleanupError(null);
    setNodeCleanupNotice(null);
    try {
      const response = await fetch(`/api/config/remote/node/${encodeURIComponent(normalizedNodeId)}`, {
        method: 'DELETE',
      });
      const payload = await response.json() as { ok?: boolean; removedPlayerIds?: string[]; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Failed to remove node.');
      }

      const removedPlayerCount = Array.isArray(payload.removedPlayerIds) ? payload.removedPlayerIds.length : 0;
      setNodeCleanupNotice(
        `Removed ${normalizedNodeId} from hub records and cleared ${removedPlayerCount} mirrored player record${removedPlayerCount === 1 ? '' : 's'}.`,
      );
      await refreshNodeRecords();
    } catch (error) {
      setNodeCleanupError(error instanceof Error ? error.message : 'Failed to remove node.');
    } finally {
      setNodeCleanupBusyId(null);
    }
  };

  useEffect(() => {
    void refreshNodeRecords();
  }, []);

  const requestAccessKey = async () => {
    setKeyRequestBusy(true);
    setKeyRequestNotice(null);
    setKeyRequestError(null);
    try {
      const res = await fetch('/api/auth/resend-access-key', { method: 'POST' });
      const data = await res.json() as { ok?: boolean; notice?: string; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? 'Request failed.');
      }
      setKeyRequestNotice(data.notice ?? 'A new access key was sent to your email.');
    } catch (err) {
      setKeyRequestError(err instanceof Error ? err.message : 'Failed to request access key.');
    } finally {
      setKeyRequestBusy(false);
    }
  };

  const downloadInstaller = async () => {
    setDownloadError(null);
    setDownloading(true);
    try {
      await downloadAuthenticatedFile('/api/downloads/bundle/windows/latest', INSTALLER_DOWNLOAD_NAME);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Failed to download the installer.');
    } finally {
      setDownloading(false);
    }
  };

  const generateInstallerLink = async () => {
    setLinkError(null);
    setCopyNotice(null);
    setCreatingLink(true);
    try {
      const payload = await requestAuthenticatedDownloadLink('/api/downloads/bundle/windows/link');
      setSecureLink({
        url: payload.url,
        expiresAt: payload.expiresAt,
      });
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Failed to create a secure installer link.');
    } finally {
      setCreatingLink(false);
    }
  };

  const copyLink = async () => {
    if (!secureLink) return;
    try {
      await copyTextToClipboard(secureLink.url);
      setCopyNotice('Secure link copied.');
    } catch {
      setCopyNotice('Copy failed. Select the link and copy it manually.');
    }
  };

  const identityCards = [
    {
      label: 'Company',
      value: session.tenant.name,
      detail: session.tenant.slug,
    },
    {
      label: 'Signed-in user',
      value: session.user.displayName,
      detail: session.user.email,
    },
  ] as const;

  return (
    <div className="space-y-5">
      <section className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <div className="ui-hero-panel min-w-0 overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="ui-kicker-muted">Downloads and access</p>
              <h3 className="mt-3 text-3xl font-semibold leading-tight text-slate-50 sm:text-4xl">
                Keep installer access, recovery, and device handoff in one calmer workspace.
              </h3>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
                Pull the current Windows installer, create short-lived handoff links for remote operators, and keep recovery details nearby without turning this page into another wall of equal-weight cards.
              </p>
            </div>

            <div className="rounded-[var(--radius-panel)] border border-white/[0.08] bg-white/[0.04] px-4 py-4 text-sm text-slate-300 xl:max-w-xs">
              <span className={`ui-status-pill ${session.tenant.enabled ? 'status-green' : 'status-orange'}`}>
                {accessLabel}
              </span>
              <p className="mt-4 text-sm text-slate-300">Default alerts route to</p>
              <p className="mt-1 text-lg font-semibold text-slate-50">{defaultAlertTarget}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Access key window: <span className="font-semibold text-slate-200">{accessWindowLabel}</span>
              </p>
            </div>
          </div>

          {(downloadError || linkError || copyNotice) && (
            <div className="mt-6 space-y-3">
              {downloadError && (
                <div className="rounded-[var(--radius-control)] border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                  {downloadError}
                </div>
              )}
              {linkError && (
                <div className="rounded-[var(--radius-control)] border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                  {linkError}
                </div>
              )}
              {copyNotice && (
                <div className="rounded-[var(--radius-control)] border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                  {copyNotice}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() => void downloadInstaller()}
              disabled={downloading}
              className="w-full rounded-[var(--radius-control)] border border-indigo-400/35 bg-indigo-400/14 px-4 py-2.5 text-sm font-semibold text-indigo-50 transition-colors hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {downloading ? 'Preparing download...' : 'Download Clarix Pulse for Windows'}
            </button>
            <button
              type="button"
              onClick={() => void generateInstallerLink()}
              disabled={creatingLink}
              className="w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {creatingLink ? 'Creating secure link...' : 'Create secure install link'}
            </button>
          </div>

          {secureLink && (
            <div className="mt-6 rounded-[var(--radius-panel)] border border-slate-800/80 bg-slate-950/55 p-4">
              <p className="ui-kicker-muted">Secure installer handoff</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Use this expiring installer URL with <code>install-from-url.ps1</code> or send it directly to a remote technician finishing setup on the node.
              </p>
              <div className="mt-4 rounded-[var(--radius-control)] border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-indigo-100 break-all whitespace-normal">
                {secureLink.url}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="rounded-[var(--radius-control)] border border-indigo-400/35 bg-indigo-400/14 px-4 py-2.5 text-sm font-semibold text-indigo-50 transition-colors hover:border-indigo-300"
                >
                  Copy secure link
                </button>
                <span className="text-xs text-slate-500">Expires: {secureLink.expiresAt}</span>
              </div>
            </div>
          )}

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {identityCards.map((card) => (
              <div
                key={card.label}
                className="rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-900/50 px-5 py-5 shadow-[0_18px_45px_rgba(2,6,23,0.22)]"
              >
                <p className="ui-kicker-muted">{card.label}</p>
                <p className="mt-3 text-lg font-semibold text-slate-50">{card.value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">{card.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="min-w-0 space-y-5">
          <div className="ui-accent-card rounded-[var(--radius-panel)] px-5 py-5">
            <p className="ui-kicker-muted text-indigo-100">Access status</p>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm text-slate-300">Current state</p>
                <p className="mt-2 text-lg font-semibold text-slate-50">{accessLabel}</p>
                {session.tenant.disabledReason && (
                  <p className="mt-2 text-sm leading-6 text-slate-300">{session.tenant.disabledReason}</p>
                )}
              </div>

              <div className="ui-quiet-rule h-px" />

              <div>
                <p className="text-sm text-slate-300">Access key hint</p>
                <p className="mt-2 text-base font-semibold text-slate-100">{session.tenant.accessKeyHint ?? 'Not available'}</p>
              </div>

              <div className="ui-quiet-rule h-px" />

              <div>
                <p className="text-sm text-slate-300">Access key window</p>
                <p className="mt-2 text-base font-semibold text-slate-100">{accessWindowLabel}</p>
              </div>
            </div>
          </div>

          <div className="ui-shell-panel rounded-[var(--radius-panel)] px-5 py-5">
            <p className="ui-kicker-muted">Access key recovery</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Lost or forgotten your access key? Request a new one and Clarix Pulse will email it to <span className="font-semibold text-slate-100">{session.user.email}</span>. This replaces any existing key.
            </p>
            {keyRequestNotice && (
              <div className="mt-4 rounded-[var(--radius-control)] border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                {keyRequestNotice}
              </div>
            )}
            {keyRequestError && (
              <div className="mt-4 rounded-[var(--radius-control)] border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                {keyRequestError}
              </div>
            )}
            <button
              type="button"
              onClick={() => void requestAccessKey()}
              disabled={keyRequestBusy}
              className="mt-4 rounded-[var(--radius-control)] border border-indigo-400/35 bg-indigo-400/14 px-4 py-2.5 text-sm font-semibold text-indigo-50 transition-colors hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {keyRequestBusy ? 'Sending...' : 'Email me a new access key'}
            </button>
          </div>

          <div className="ui-shell-panel rounded-[var(--radius-panel)] px-5 py-5">
            <p className="ui-kicker-muted">Fallback details</p>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm text-slate-300">Alert default</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Registration seeded <span className="font-semibold text-slate-100">{defaultAlertTarget}</span> as the default incident alert recipient.
                </p>
              </div>

              <div className="ui-quiet-rule h-px" />

              <div>
                <p className="text-sm text-slate-300">Enrollment key fallback</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Keep this as the contingency path for local self-enrollment when a provisioned config is not available yet.
                </p>
                <div className="mt-3 rounded-[var(--radius-control)] border border-slate-700 bg-slate-950/70 px-4 py-3 font-mono text-sm text-indigo-100 break-all whitespace-normal">
                  {session.tenant.enrollmentKey}
                </div>
              </div>
            </div>
          </div>

          <div className="ui-shell-panel rounded-[var(--radius-panel)] px-5 py-5">
            <p className="ui-kicker-muted">Retired node cleanup</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              If a node was uninstalled on a PC but still appears in this workspace, remove the stale hub record here.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refreshNodeRecords()}
                disabled={nodeCleanupLoading || nodeCleanupBusyId !== null}
                className="rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {nodeCleanupLoading ? 'Refreshing...' : 'Refresh node list'}
              </button>
            </div>

            {nodeCleanupNotice && (
              <div className="mt-4 rounded-[var(--radius-control)] border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                {nodeCleanupNotice}
              </div>
            )}
            {nodeCleanupError && (
              <div className="mt-4 rounded-[var(--radius-control)] border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                {nodeCleanupError}
              </div>
            )}

            <div className="mt-4 space-y-3">
              {!nodeCleanupLoading && nodeRecords.length === 0 && (
                <div className="rounded-[var(--radius-control)] border border-slate-800/70 bg-slate-950/45 px-4 py-3 text-sm text-slate-400">
                  No mirrored nodes are currently visible for this workspace.
                </div>
              )}
              {nodeRecords.map((record) => (
                <div
                  key={record.nodeId}
                  className="rounded-[var(--radius-control)] border border-slate-800/70 bg-slate-950/45 px-4 py-3"
                >
                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="break-all text-sm font-semibold text-slate-100">{record.nodeId}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Site: <span className="font-medium text-slate-400">{record.siteId || 'unknown'}</span> | Instances: {record.instanceCount}
                      </p>
                      {record.labels.length > 0 && (
                        <p className="mt-1 text-xs text-slate-500">
                          Sample labels: {record.labels.slice(0, 2).join(' | ')}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeNodeRecord(record.nodeId)}
                      disabled={nodeCleanupBusyId !== null}
                      className="w-full rounded-[var(--radius-control)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-100 transition-colors hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {nodeCleanupBusyId === record.nodeId ? 'Removing node...' : 'Remove node from hub'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <InstallWorkspacePanel />
    </div>
  );
}
