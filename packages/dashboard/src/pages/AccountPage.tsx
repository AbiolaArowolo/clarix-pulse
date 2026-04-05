import React, { useState } from 'react';
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

export function AccountPage({
  session,
}: {
  session: SessionShape;
}) {
  const accessLabel = session.tenant.enabled ? 'Enabled' : 'Pending activation';
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [secureLink, setSecureLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [keyRequestBusy, setKeyRequestBusy] = useState(false);
  const [keyRequestNotice, setKeyRequestNotice] = useState<string | null>(null);
  const [keyRequestError, setKeyRequestError] = useState<string | null>(null);

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

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
      <section className="space-y-5">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Account details</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Company</p>
              <p className="mt-2 text-lg font-semibold text-white">{session.tenant.name}</p>
              <p className="mt-1 text-sm text-slate-400">{session.tenant.slug}</p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Signed-in user</p>
              <p className="mt-2 text-lg font-semibold text-white">{session.user.displayName}</p>
              <p className="mt-1 text-sm text-slate-400">{session.user.email}</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Installer access</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            The Windows installer bundle is available only after sign-in.
          </p>
          {(downloadError || linkError || copyNotice) && (
            <>
              {downloadError && (
                <div className="mt-4 rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                  {downloadError}
                </div>
              )}
              {linkError && (
                <div className="mt-4 rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                  {linkError}
                </div>
              )}
              {copyNotice && (
                <div className="mt-4 rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                  {copyNotice}
                </div>
              )}
            </>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void downloadInstaller()}
              disabled={downloading}
              className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {downloading ? 'Preparing download...' : 'Download Clarix Pulse for Windows'}
            </button>
            <button
              type="button"
              onClick={() => void generateInstallerLink()}
              disabled={creatingLink}
              className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingLink ? 'Creating secure link...' : 'Create secure install link'}
            </button>
          </div>
          {secureLink && (
            <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Direct pull link</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Use this expiring link with <code>install-from-url.ps1</code> or any HTTPS download tool.
              </p>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-cyan-100">
                {secureLink.url}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
                >
                  Copy secure link
                </button>
                <span className="text-xs text-slate-500">Expires: {secureLink.expiresAt}</span>
              </div>
            </div>
          )}
        </div>

        <InstallWorkspacePanel />
      </section>

      <aside className="space-y-5">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Access status</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Status: <span className="font-semibold text-white">{accessLabel}</span>
          </p>
          {session.tenant.disabledReason && (
            <p className="mt-2 text-sm leading-6 text-slate-400">{session.tenant.disabledReason}</p>
          )}
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Access key hint: <span className="font-semibold text-white">{session.tenant.accessKeyHint ?? 'Not available'}</span>
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Access key expires: <span className="font-semibold text-white">{session.tenant.accessKeyExpiresAt ?? 'Not set'}</span>
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Access key recovery</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Lost or forgotten your access key? Request a new one - it will be emailed to <span className="font-semibold text-white">{session.user.email}</span>. This replaces any existing key.
          </p>
          {keyRequestNotice && (
            <div className="mt-3 rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
              {keyRequestNotice}
            </div>
          )}
          {keyRequestError && (
            <div className="mt-3 rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
              {keyRequestError}
            </div>
          )}
          <button
            type="button"
            onClick={() => void requestAccessKey()}
            disabled={keyRequestBusy}
            className="mt-4 rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {keyRequestBusy ? 'Sending...' : 'Email me a new access key'}
          </button>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Alert default</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Registration seeded <span className="font-semibold text-white">{session.tenant.defaultAlertEmail ?? session.user.email}</span> as the default incident alert recipient.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            You can change recipients at any time from Alert Contacts on the dashboard.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Enrollment key fallback</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Keep this as a fallback for local self-enrollment when you cannot use a provisioned config.
          </p>
          <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 font-mono text-sm text-cyan-100">
            {session.tenant.enrollmentKey}
          </div>
        </div>
      </aside>
    </div>
  );
}
