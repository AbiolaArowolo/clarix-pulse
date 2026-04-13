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

const onboardingSteps = [
  {
    id: '01',
    title: 'Stage the signed installer',
    detail: 'Pull the latest Windows installer from this workspace so the target node starts with the current Pulse build.',
  },
  {
    id: '02',
    title: 'Import discovery into remote setup',
    detail: 'Upload the discovery report, confirm the inferred paths and player hints, and provision the node-scoped config.',
  },
  {
    id: '03',
    title: 'Finish the node locally',
    detail: 'Use the provisioned config in the local UI, save the node settings, and install the service so it appears in the dashboard.',
  },
] as const;

const localInstallChecklist = [
  'Download the signed installer for the Windows node.',
  'Keep the monitored application or process running if possible before discovery.',
  'Run discover-node.ps1 so Pulse can infer paths, logs, and player hints.',
  'Upload the discovery report in the dashboard remote setup panel.',
  'Provision the node to generate the tenant-scoped config.yaml.',
  'Pull that config into the local Pulse UI and save the local settings.',
  'Run ClarixPulseSetup.exe (or setup.bat in C:\\ClarixPulse) to install the service and confirm the node appears on the dashboard.',
] as const;

const preparationNotes = [
  'Use the signed-in download when you are the operator finishing setup yourself.',
  'Create a secure installer link when a remote technician needs a short-lived handoff.',
  'Open the dashboard as soon as discovery is ready so provisioning and import stay in the same session.',
] as const;

export function OnboardingPage({
  session,
  onNavigate,
}: {
  session: SessionShape;
  onNavigate: (pathname: string) => void;
}) {
  const alertEmail = session.tenant.defaultAlertEmail ?? session.user.email;

  // Auto-redirect to Remote Setup when setup.bat opens the onboarding URL
  // with a #discovery=<base64> hash. React Router strips the hash on navigate,
  // so we bridge it via sessionStorage before calling onNavigate.
  useEffect(() => {
    const match = /[#&]discovery=([A-Za-z0-9+/=]+)/.exec(window.location.hash);
    if (!match) return;
    sessionStorage.setItem('_pulse_discovery_b64', match[1]);
    onNavigate('/app');
    // onNavigate is stable, so omitting it from deps keeps this bridge one-shot.
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
      await downloadAuthenticatedFile('/api/downloads/bundle/windows/ClarixPulseSetup.exe', 'ClarixPulseSetup.exe');
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
      <section className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <div className="ui-hero-panel min-w-0 overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
          <div className="max-w-3xl">
            <p className="ui-kicker-muted">Recommended first pass</p>
            <h3 className="mt-3 text-3xl font-semibold leading-tight text-slate-50 sm:text-4xl">
              Bring a Windows node online with one clean sequence instead of three competing panels.
            </h3>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
              Start with the signed installer, move discovery straight into remote setup, and finish the node locally with the provisioned config so the first run lands cleanly in the dashboard.
            </p>
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
              {downloading ? 'Preparing download...' : 'Download installer'}
            </button>
            <button
              type="button"
              onClick={() => void generateInstallerLink()}
              disabled={creatingLink}
              className="w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {creatingLink ? 'Creating secure link...' : 'Create secure link'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/app')}
              className="w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white sm:w-auto"
            >
              Open dashboard and import discovery
            </button>
          </div>

          {installerLink && (
            <div className="mt-6 rounded-[var(--radius-panel)] border border-slate-800/80 bg-slate-950/55 p-4">
              <p className="ui-kicker-muted">Secure installer handoff</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Share this short-lived installer URL with a remote operator when they need to pull the installer without signing into the dashboard.
              </p>
              <div className="mt-4 rounded-[var(--radius-control)] border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-indigo-100 break-all whitespace-normal">
                {installerLink.url}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void copyInstallerLink()}
                  className="rounded-[var(--radius-control)] border border-indigo-400/35 bg-indigo-400/14 px-4 py-2.5 text-sm font-semibold text-indigo-50 transition-colors hover:border-indigo-300"
                >
                  Copy secure link
                </button>
                <span className="text-xs text-slate-500">Expires: {installerLink.expiresAt}</span>
              </div>
            </div>
          )}

          <div className="mt-6 rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-950/42 px-4 py-4 shadow-[0_18px_40px_rgba(2,6,23,0.18)]">
            <p className="ui-kicker-muted">Initial alert route</p>
            <div className="mt-3 flex flex-col gap-3">
              <div>
                <p className="text-lg font-semibold text-slate-50">{alertEmail}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  New incident alerts start here until you change the contact list from the dashboard.
                </p>
              </div>
              <div className="rounded-[var(--radius-control)] border border-slate-800/70 bg-slate-900/70 px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                Dashboard controls become the source of truth after first setup.
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            <div className="rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-900/50 px-5 py-5 shadow-[0_18px_45px_rgba(2,6,23,0.22)]">
              <p className="ui-kicker-muted">Operator flow</p>
              <div className="mt-4 space-y-3">
                {onboardingSteps.map((step) => (
                  <div
                    key={step.id}
                    className="flex gap-4 rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-950/50 px-4 py-4"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-indigo-400/30 bg-indigo-400/12 text-sm font-semibold text-indigo-100">
                      {step.id}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-slate-50">{step.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-400">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ui-accent-card rounded-[var(--radius-panel)] px-5 py-5">
              <p className="ui-kicker-muted text-indigo-100">Fallback access</p>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-sm text-slate-300">Enrollment key</p>
                  <div className="mt-3 rounded-[var(--radius-control)] border border-indigo-300/18 bg-slate-950/55 px-4 py-3 font-mono text-sm text-indigo-100 break-all whitespace-normal">
                    {session.tenant.enrollmentKey}
                  </div>
                </div>

                <div className="ui-quiet-rule h-px" />

                <div>
                  <p className="text-sm text-slate-300">When to use it</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Keep enrollment-key setup as the contingency path when the node cannot pull a provisioned config yet.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="min-w-0 space-y-5">
          <div className="ui-shell-panel rounded-[var(--radius-panel)] px-5 py-5">
            <p className="ui-kicker-muted">Before you start</p>
            <div className="mt-4 space-y-3">
              {preparationNotes.map((note) => (
                <div
                  key={note}
                  className="rounded-[var(--radius-control)] border border-slate-800/70 bg-slate-950/45 px-4 py-3 text-sm leading-6 text-slate-300"
                >
                  {note}
                </div>
              ))}
            </div>
          </div>

          <div className="ui-shell-panel rounded-[var(--radius-panel)] px-5 py-5">
            <p className="ui-kicker-muted">Discovery handoff</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              If <code>setup.bat</code> opens this page with a discovery hash, Clarix Pulse forwards you into the dashboard and stages the payload for remote import automatically.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('/app')}
              className="mt-4 w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white"
            >
              Open remote setup workspace
            </button>
          </div>
        </aside>
      </section>

      <section className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <div className="ui-shell-panel min-w-0 rounded-[var(--radius-panel)] px-5 py-5">
          <p className="ui-kicker-muted">Local install checklist</p>
          <div className="mt-4 space-y-3">
            {localInstallChecklist.map((item, index) => (
              <div
                key={item}
                className="flex gap-4 rounded-[var(--radius-control)] border border-slate-800/70 bg-slate-950/42 px-4 py-4"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/80 text-sm font-semibold text-slate-200">
                  {index + 1}
                </div>
                <p className="min-w-0 break-words text-sm leading-6 text-slate-300">{item}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="ui-shell-panel min-w-0 rounded-[var(--radius-panel)] px-5 py-5">
          <p className="ui-kicker-muted">What success looks like</p>
          <div className="mt-4 space-y-4 text-sm leading-6 text-slate-300">
            <div className="rounded-[var(--radius-control)] border border-slate-800/70 bg-slate-950/42 px-4 py-4">
              The discovery report imports without manual path hunting, and the remote setup draft is mostly filled in before you touch the form.
            </div>
            <div className="rounded-[var(--radius-control)] border border-slate-800/70 bg-slate-950/42 px-4 py-4">
              The provisioned <code>config.yaml</code> becomes the source of truth for the node instead of a fallback enrollment-key-only setup.
            </div>
            <div className="rounded-[var(--radius-control)] border border-slate-800/70 bg-slate-950/42 px-4 py-4">
              After the local install completes, the new node appears in the dashboard and starts following the same alerting rules as the rest of the workspace.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
