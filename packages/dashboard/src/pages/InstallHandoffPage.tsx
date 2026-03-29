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
    <div className="relative min-h-dvh overflow-hidden bg-[#03111f] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_26%),radial-gradient(circle_at_80%_10%,rgba(14,165,233,0.14),transparent_18%),linear-gradient(180deg,#03111f_0%,#071b2b_58%,#0b1322_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-[32px] border border-cyan-400/15 bg-slate-950/48 p-8 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Node install handoff</p>
            <h1 className="mt-4 text-3xl font-semibold text-white">
              {payload?.node ? `Finish setup for ${payload.node.nodeName}` : 'Open the node install handoff'}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              This page bundles the two things an installer on the Windows node needs most: the Clarix Pulse installer and the secure config for this node.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">1. Download installer</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Use the signed installer bundle if Pulse is not already unpacked on the Windows node.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">2. Pull config</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Download the ready <code>config.yaml</code> or paste the secure config link into the local UI.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">3. Save and install</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Save the local settings on the node and run <code>install.bat</code> to bring it online.
                </p>
              </div>
            </div>

            {loading && (
              <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
                Loading secure install handoff...
              </div>
            )}

            {error && (
              <div className="mt-6 rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}

            {copyNotice && (
              <div className="mt-6 rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                {copyNotice}
              </div>
            )}

            {payload?.handoff && payload?.node && (
              <div className="mt-6 space-y-4">
                <div className="rounded-3xl border border-slate-800 bg-slate-950/62 p-5">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Node</p>
                  <p className="mt-2 text-lg font-semibold text-white">{payload.node.nodeName}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Node ID: {payload.node.nodeId} | Site: {payload.node.siteId}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Workspace: {payload.tenant?.name}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">Link expires: {payload.handoff.expiresAt}</p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <a
                    href={payload.handoff.installerUrl}
                    className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
                  >
                    Download installer
                  </a>
                  <a
                    href={payload.handoff.configUrl}
                    className="rounded-full border border-emerald-400/35 bg-emerald-400/12 px-4 py-2 text-sm font-semibold text-emerald-50 transition-colors hover:border-emerald-300"
                  >
                    Download node config
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyConfigLink()}
                    className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white"
                  >
                    Copy config link
                  </button>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/62 p-5">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Config pull link</p>
                  <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-cyan-100">
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
            <div className="rounded-[32px] border border-slate-800 bg-slate-950/72 p-6 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Fast install checklist</h2>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                <p>1. Download the installer bundle if the node does not already have Pulse unpacked.</p>
                <p>2. Open the local setup UI on the Windows node.</p>
                <p>3. Download the node config or paste the secure config link into the local UI.</p>
                <p>4. Save local settings on the node.</p>
                <p>5. Run <code>install.bat</code> to install the service.</p>
              </div>
            </div>

            <div className="rounded-[32px] border border-slate-800 bg-slate-950/72 p-6 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Share status</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                This page is meant to be forwarded to the person finishing setup on the node.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void copyPageLink()}
                  className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white"
                >
                  Copy this handoff page
                </button>
                {payload?.metrics?.openedEvent && (
                  <span className="self-center text-xs text-slate-500">Metric: {payload.metrics.openedEvent}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/login')}
                className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
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
