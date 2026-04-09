import React, { useEffect, useMemo, useState } from 'react';
import { AlarmBanner } from '../components/AlarmBanner';
import { AlertContactsEditor } from '../components/AlertContactsEditor';
import { InstallWorkspacePanel } from '../components/InstallWorkspacePanel';
import { RemoteSetupPanel } from '../components/RemoteSetupPanel';
import { SiteGroup } from '../components/SiteGroup';
import { useAlarm } from '../hooks/useAlarm';
import { useMonitoring } from '../hooks/useMonitoring';
import { SiteState, getHeadlineStatus, isInactiveInstance } from '../lib/types';

const SHOW_INACTIVE_KEY = 'pulse.show_inactive';

function readStoredBoolean(key: string, fallback = false): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return value === '1';
  } catch {
    return fallback;
  }
}

export function MonitoringDashboardPage({ onNavigate }: { onNavigate: (pathname: string) => void }) {
  const { sites, connectionStatus } = useMonitoring();
  const { alarmActive, muted, audioBlocked, toggleMute, enableSound } = useAlarm(sites);
  const [showInactive, setShowInactive] = useState(() => readStoredBoolean(SHOW_INACTIVE_KEY));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SHOW_INACTIVE_KEY, showInactive ? '1' : '0');
  }, [showInactive]);

  const inactiveInstanceCount = useMemo(
    () => sites.reduce((count, site) => count + site.instances.filter(isInactiveInstance).length, 0),
    [sites],
  );

  const totalInstances = useMemo(
    () => sites.reduce((count, site) => count + site.instances.length, 0),
    [sites],
  );

  const visibleSites = useMemo<SiteState[]>(
    () => sites
      .map((site) => ({
        ...site,
        instances: site.instances.filter((instance) => showInactive || !isInactiveInstance(instance)),
      }))
      .filter((site) => site.instances.length > 0),
    [showInactive, sites],
  );

  const visibleInstanceCount = useMemo(
    () => visibleSites.reduce((count, site) => count + site.instances.length, 0),
    [visibleSites],
  );

  const attentionCount = useMemo(
    () => visibleSites.reduce(
      (count, site) => count + site.instances.filter((instance) => {
        const headline = getHeadlineStatus(instance);
        return headline.color === 'red' || headline.color === 'yellow' || headline.color === 'orange';
      }).length,
      0,
    ),
    [visibleSites],
  );

  const stableCount = useMemo(
    () => visibleSites.reduce(
      (count, site) => count + site.instances.filter((instance) => getHeadlineStatus(instance).color === 'green').length,
      0,
    ),
    [visibleSites],
  );

  const connDot: Record<typeof connectionStatus, string> = {
    connected: 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.8)]',
    connecting: 'bg-yellow-400 animate-pulse shadow-[0_0_18px_rgba(250,204,21,0.55)]',
    disconnected: 'bg-red-500 animate-pulse shadow-[0_0_18px_rgba(239,68,68,0.65)]',
  };

  const connLabel: Record<typeof connectionStatus, string> = {
    connected: 'Connected',
    connecting: 'Syncing',
    disconnected: 'Disconnected',
  };

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(now);

  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);

  const focusRemoteSetup = () => {
    const toggle = document.querySelector<HTMLButtonElement>('[aria-controls="collapsible-body-remote-setup"]');
    if (!toggle) return;

    if (toggle.getAttribute('aria-expanded') === 'false') {
      toggle.click();
    }

    window.setTimeout(() => {
      document.getElementById('collapsible-body-remote-setup')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 120);
  };

  return (
    <div className="relative min-w-0 pb-8 sm:pb-6">
      <AlarmBanner
        sites={sites}
        muted={muted}
        audioBlocked={audioBlocked}
        onToggleMute={toggleMute}
        onEnableSound={enableSound}
      />

      <div className={`space-y-5 ${alarmActive ? 'pt-16' : ''}`}>
        <section className="ui-hero-panel overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="ui-kicker-muted">Live operations</p>
              <h3 className="mt-3 text-3xl font-semibold leading-tight text-slate-50 sm:text-4xl">
                {sites.length === 0
                  ? 'Stand up the first monitored source with one clear control surface.'
                  : 'Keep the live picture calm, current, and ahead of drift.'}
              </h3>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
                {sites.length === 0
                  ? 'Start with onboarding, then pull discovery into remote setup so the first node lands in the dashboard with less friction.'
                  : 'The hero summarizes what needs attention now while setup, alerts, and install handoff stay close by instead of competing with live source state.'}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => onNavigate('/app/onboarding')}
                className="w-full rounded-2xl border border-cyan-400/35 bg-cyan-400/12 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 sm:w-auto"
              >
                Open onboarding
              </button>
              <button
                type="button"
                onClick={focusRemoteSetup}
                className="w-full rounded-2xl border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white sm:w-auto"
              >
                Jump to remote setup
              </button>
              {inactiveInstanceCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowInactive((value) => !value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white sm:w-auto"
                >
                  {showInactive ? 'Hide inactive' : `Show inactive (${inactiveInstanceCount})`}
                </button>
              )}
            </div>
          </div>

          <div className="mt-8 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            <div className="ui-accent-card rounded-3xl px-5 py-5 [grid-column:1/-1]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="ui-kicker-muted text-indigo-100">Signal health</p>
                  <div className="mt-3 flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full ${connDot[connectionStatus]}`} />
                    <p className="text-2xl font-semibold text-slate-50 sm:text-[2rem]">
                      {sites.length === 0
                        ? connLabel[connectionStatus]
                        : attentionCount > 0
                          ? `${attentionCount} source${attentionCount === 1 ? '' : 's'} need attention`
                          : `${stableCount} source${stableCount === 1 ? '' : 's'} look stable`}
                    </p>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                    {dateLabel} at {timeLabel}. Connection state is <span className="font-semibold text-slate-100">{connLabel[connectionStatus].toLowerCase()}</span>.
                    {sites.length === 0
                      ? ' No active sources are visible yet.'
                      : attentionCount > 0
                        ? ` Review the live site stack and the tool rail before issues stack up.`
                        : ' No immediate off-air or degraded signals are currently visible.'}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Sources in view</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-50">{visibleInstanceCount}</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800/70 bg-slate-900/55 px-4 py-4 shadow-[0_18px_45px_rgba(2,6,23,0.22)]">
              <p className="ui-kicker-muted">Visible sites</p>
              <p className="mt-3 text-3xl font-semibold text-slate-50">{visibleSites.length}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {sites.length === 0 ? 'Ready for the first site.' : 'Filtered to the sites currently in view.'}
              </p>
            </div>

            <div className="rounded-3xl border border-slate-800/70 bg-slate-900/55 px-4 py-4 shadow-[0_18px_45px_rgba(2,6,23,0.22)]">
              <p className="ui-kicker-muted">Attention now</p>
              <p className="mt-3 text-3xl font-semibold text-slate-50">{attentionCount}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Sources showing warning, maintenance, or off-air style states.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-800/70 bg-slate-900/55 px-4 py-4 shadow-[0_18px_45px_rgba(2,6,23,0.22)]">
              <p className="ui-kicker-muted">Total sources</p>
              <p className="mt-3 text-3xl font-semibold text-slate-50">{totalInstances}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Includes inactive or hidden sources that still belong to this workspace.
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <section className="min-w-0 space-y-5">
            <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="ui-kicker-muted">Live estate</p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-50">Sites and monitored sources</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Live source state stays primary here, with setup tools pushed into a quieter companion rail.
                </p>
              </div>
            </div>

            {visibleSites.length === 0 ? (
              <div className="rounded-3xl border border-slate-800 bg-slate-900/55 px-8 py-10 text-center shadow-[0_24px_80px_rgba(2,6,23,0.35)] backdrop-blur">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/80">
                  <img src="/pulse.svg" alt="Clarix Pulse logo" className="pulse-logo h-9 w-9 object-contain" />
                </div>
                <p className="text-lg font-medium text-slate-200">
                  {sites.length === 0 ? 'No nodes yet for this account.' : 'Inactive sites are hidden right now.'}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {sites.length === 0
                    ? 'Provision the first node from the dashboard or finish the local node setup so it can mirror into this hub.'
                    : 'Use the hero toggle if you want to review nodes that are not commissioned yet.'}
                </p>
                {sites.length === 0 && (
                  <button
                    type="button"
                    onClick={() => onNavigate('/app/onboarding')}
                    className="mt-5 rounded-2xl border border-cyan-400/35 bg-cyan-400/12 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
                  >
                    Start onboarding
                  </button>
                )}
              </div>
            ) : (
              visibleSites.map((site) => <SiteGroup key={site.id} site={site} />)
            )}
          </section>

          <aside className="min-w-0 space-y-4">
            <div className="px-1">
              <p className="ui-kicker-muted">Operator tools</p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-50">Setup, alerts, and install handoff</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Keep follow-up actions close, but visually secondary to the live estate and current signal picture.
              </p>
            </div>

            <InstallWorkspacePanel layout="rail" />
            <AlertContactsEditor />
            <RemoteSetupPanel />
          </aside>
        </div>

        <footer className="mt-8 flex flex-col items-start gap-2 border-t border-slate-800/80 py-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-slate-500">Clarix Pulse | Operational Monitoring Platform</span>
          <span className="text-xs text-slate-500">{new Date().getFullYear()} Live workflow visibility</span>
        </footer>
      </div>
    </div>
  );
}
