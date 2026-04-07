import React, { useEffect, useMemo, useState } from 'react';
import { copyTextToClipboard } from '../lib/clipboard';

interface InstallHandoffPayload {
  ok?: boolean;
  tenant?: {
    tenantId: string;
    name: string;
    slug: string;
  };
  node?: {
    nodeId: string;
    nodeName: string;
    siteId: string;
  };
  handoff?: {
    expiresAt: string;
    installerUrl: string;
    configUrl: string;
  };
  metrics?: {
    openedEvent?: string;
  };
  error?: string;
}

const handoffSteps = [
  {
    title: 'Download installer',
    detail: 'Use the signed bundle if Pulse is not already unpacked on the Windows node.',
  },
  {
    title: 'Pull node config',
    detail: 'Download the ready config.yaml or paste the secure config link into the local UI.',
  },
  {
    title: 'Save and install',
    detail: 'Save the local settings and run install.bat so the node comes online cleanly.',
  },
] as const;

const fastChecklist = [
  'Download the installer bundle if the node does not already have Pulse unpacked.',
  'Open the local setup UI on the Windows node.',
  'Download the node config or paste the secure config link into the local UI.',
  'Save local settings on the node.',
  'Run install.bat to install the service.',
] as const;

function currentToken(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('token')?.trim() ?? '';
}

export function InstallHandoffPage({
  onNavigate,
}: {
  onNavigate: (pathname: string) => void;
}) {
  const token = useMemo(() => currentToken(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<InstallHandoffPayload | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!token) {
        setError('This install handoff link is missing its token.');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/config/remote/install-handoff?token=${encodeURIComponent(token)}`);
        const data = await response.json() as InstallHandoffPayload;
        if (!response.ok || !data.ok || !data.handoff || !data.node || !data.tenant) {
          throw new Error(String(data?.error ?? 'Failed to load the install handoff page.'));
        }

        if (!cancelled) {
          setPayload(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load the install handoff page.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const copyConfigLink = async () => {
    if (!payload?.handoff?.configUrl) return;
    try {
      await copyTextToClipboard(payload.handoff.configUrl);
      setCopyNotice('Secure config link copied.');
    } catch {
      setCopyNotice('Copy failed. Select the config link and copy it manually.');
    }
  };

  const copyPageLink = async () => {
    if (typeof window === 'undefined') return;
    try {
      await copyTextToClipboard(window.location.href);
      setCopyNotice('Install handoff page copied.');
    } catch {
      setCopyNotice('Copy failed. Select the page link and copy it manually.');
    }
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-slate-950 text-white">
      <div className="ui-shell-backdrop pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[linear-gradient(180deg,rgba(99,102,241,0.18),transparent)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-6xl gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section className="ui-hero-panel overflow-hidden px-6 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <p className="ui-kicker-muted">Node install handoff</p>
                <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-50 sm:text-4xl">
                  {payload?.node ? `Finish setup for ${payload.node.nodeName}` : 'Open the node install handoff'}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
                  This page keeps the two things the installer on the Windows node needs most in one place: the Clarix Pulse installer and the secure config for this exact node.
                </p>
              </div>

              <div className="rounded-[var(--radius-panel)] border border-white/[0.08] bg-white/[0.04] px-4 py-4 text-sm text-slate-300 xl:max-w-xs">
                <p className="ui-kicker-muted">Handoff window</p>
                <p className="mt-2 text-lg font-semibold text-slate-50">{payload?.tenant?.name ?? 'Secure install bundle'}</p>
                <p className="mt-2 leading-6 text-slate-400">
                  {payload?.handoff?.expiresAt ? `Expires ${payload.handoff.expiresAt}` : 'Share this page with the operator finishing setup on the node.'}
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {handoffSteps.map((step) => (
                <div
                  key={step.title}
                  className="rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-900/50 px-4 py-4 shadow-[0_18px_45px_rgba(2,6,23,0.22)]"
                >
                  <p className="text-base font-semibold text-slate-50">{step.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{step.detail}</p>
                </div>
              ))}
            </div>

            {loading && (
              <div className="mt-6 rounded-[var(--radius-control)] border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
                Loading secure install handoff...
              </div>
            )}

            {error && (
              <div className="mt-6 rounded-[var(--radius-control)] border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}

            {copyNotice && (
              <div className="mt-6 rounded-[var(--radius-control)] border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                {copyNotice}
              </div>
            )}

            {payload?.handoff && payload?.node && (
              <div className="mt-6 space-y-4">
                <div className="rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-950/55 p-5">
                  <p className="ui-kicker-muted">Node summary</p>
                  <p className="mt-3 text-lg font-semibold text-slate-50">{payload.node.nodeName}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Node ID: {payload.node.nodeId} | Site: {payload.node.siteId}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Workspace: {payload.tenant?.name}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <a
                    href={payload.handoff.installerUrl}
                    className="rounded-[var(--radius-control)] border border-indigo-400/35 bg-indigo-400/14 px-4 py-2.5 text-sm font-semibold text-indigo-50 transition-colors hover:border-indigo-300"
                  >
                    Download installer
                  </a>
                  <a
                    href={payload.handoff.configUrl}
                    className="rounded-[var(--radius-control)] border border-emerald-400/35 bg-emerald-400/12 px-4 py-2.5 text-sm font-semibold text-emerald-50 transition-colors hover:border-emerald-300"
                  >
                    Download node config
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyConfigLink()}
                    className="rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white"
                  >
                    Copy config link
                  </button>
                </div>

                <div className="rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-950/55 p-5">
                  <p className="ui-kicker-muted">Config pull link</p>
                  <div className="mt-4 overflow-x-auto rounded-[var(--radius-control)] border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-indigo-100">
                    {payload.handoff.configUrl}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    In the node&apos;s local Pulse UI, use <span className="font-semibold text-slate-200">Pull from link</span> and paste the config URL above.
                  </p>
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-5">
            <div className="ui-shell-panel rounded-[var(--radius-panel)] px-5 py-5">
              <p className="ui-kicker-muted">Fast install checklist</p>
              <div className="mt-4 space-y-3">
                {fastChecklist.map((item, index) => (
                  <div
                    key={item}
                    className="flex gap-4 rounded-[var(--radius-control)] border border-slate-800/70 bg-slate-950/42 px-4 py-4"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/80 text-sm font-semibold text-slate-200">
                      {index + 1}
                    </div>
                    <p className="text-sm leading-6 text-slate-300">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="ui-accent-card rounded-[var(--radius-panel)] px-5 py-5">
              <p className="ui-kicker-muted text-indigo-100">Share status</p>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                This page is meant to be forwarded to the person finishing setup on the node, so keep the secure window short and the next step obvious.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void copyPageLink()}
                  className="rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white"
                >
                  Copy this handoff page
                </button>
                {payload?.metrics?.openedEvent && (
                  <span className="self-center text-xs text-slate-400">Metric: {payload.metrics.openedEvent}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/login')}
                className="mt-4 w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
              >
                Back to Clarix Pulse
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
