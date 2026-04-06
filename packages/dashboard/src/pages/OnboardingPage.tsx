import React, { useEffect, useState } from 'react';
import { copyTextToClipboard } from '../lib/clipboard';
import { downloadAuthenticatedFile, requestAuthenticatedDownloadLink } from '../lib/downloads';

interface SessionShape {
  user: {
    email: string;
  };
  tenant: {
    enrollmentKey: string;
    defaultAlertEmail: string | null;
  };
}

export function OnboardingPage({
  session,
  onNavigate,
}: {
  session: SessionShape;
  onNavigate: (pathname: string) => void;
}) {
  const alertEmail = session.tenant.defaultAlertEmail ?? session.user.email;

  // Auto-redirect to Remote Setup panel when setup.bat opens the onboarding URL
  // with a #discovery=<base64> hash. React Router strips the hash on navigate,
  // so we bridge it via sessionStorage before calling onNavigate.
  useEffect(() => {
    const match = /[#&]discovery=([A-Za-z0-9+/=]+)/.exec(window.location.hash);
    if (!match) return;
    sessionStorage.setItem('_pulse_discovery_b64', match[1]);
    onNavigate('/app');
  // onNavigate is stable — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);
  const [installerLink, setInstallerLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const downloadInstaller = async () => {
    setDownloadError(null);
    setDownloading(true);
    try {
      await downloadAuthenticatedFile('/api/downloads/bundle/windows/latest', 'clarix-pulse-latest.zip');
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
      setInstallerLink({
        url: payload.url,
        expiresAt: payload.expiresAt,
      });
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Failed to create a secure installer link.');
    } finally {
      setCreatingLink(false);
    }
  };

  const copyInstallerLink = async () => {
    if (!installerLink) return;
    try {
      await copyTextToClipboard(installerLink.url);
      setCopyNotice('Secure link copied.');
    } catch {
      setCopyNotice('Copy failed. Select the link and copy it manually.');
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Recommended onboarding flow</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <p className="text-sm font-semibold text-white">1. Get the installer</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Download the latest Clarix Pulse bundle from this signed-in account, move it to the Windows node, and start the player if possible before discovery.
            </p>
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
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void downloadInstaller()}
                disabled={downloading}
                className="inline-flex rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {downloading ? 'Preparing download...' : 'Download installer'}
              </button>
              <button
                type="button"
                onClick={() => void generateInstallerLink()}
                disabled={creatingLink}
                className="inline-flex rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingLink ? 'Creating secure link...' : 'Create secure link'}
              </button>
            </div>
            {installerLink && (
              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Direct pull link</p>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-cyan-100">
                  {installerLink.url}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void copyInstallerLink()}
                    className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
                  >
                    Copy secure link
                  </button>
                  <span className="text-xs text-slate-500">Expires: {installerLink.expiresAt}</span>
                </div>
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <p className="text-sm font-semibold text-white">2. Import the discovery report</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Open the dashboard, upload the report, review the auto-filled paths and log matches, then provision the node to mint its final config.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <p className="text-sm font-semibold text-white">3. Finish local install</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Import the provisioned <code>config.yaml</code> into the local UI, save settings, and install the agent service so the node starts mirroring into this hub.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="theme-dark-gradient-card rounded-3xl border border-cyan-500/20 bg-[linear-gradient(135deg,rgba(3,15,29,0.96),rgba(8,24,44,0.94)_45%,rgba(21,39,63,0.92))] p-5 shadow-[0_28px_90px_rgba(2,12,27,0.42)]">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-100">Install checklist</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            <p>1. Download the signed-in installer bundle for the Windows node.</p>
            <p>2. Keep the monitored application or process running if possible.</p>
            <p>3. Run <code>discover-node.ps1</code> so Clarix Pulse can infer paths, logs, and player hints.</p>
            <p>4. Upload the discovery report in the dashboard&apos;s remote setup panel.</p>
            <p>5. Provision the node to generate a tenant-scoped <code>config.yaml</code>.</p>
            <p>6. Import that config into the local UI and save local settings.</p>
            <p>7. Install the service and confirm the node appears on the dashboard.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/app')}
            className="mt-5 rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
          >
            Open remote provisioning
          </button>
        </div>

        <aside className="space-y-5">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Default alert recipient</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Alert emails start with <span className="font-semibold text-white">{alertEmail}</span>. You can change that later from Alert Contacts.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Enrollment key fallback</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Use the provisioned config flow first. If you still need enrollment-key setup from the local UI, this account&apos;s current key is:
            </p>
            <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 font-mono text-sm text-cyan-100">
              {session.tenant.enrollmentKey}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
