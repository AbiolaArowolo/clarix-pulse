import React, { useEffect, useMemo, useState } from 'react';
import { AlarmBanner } from '../components/AlarmBanner';
import { AlertContactsEditor } from '../components/AlertContactsEditor';
import { RemoteSetupPanel } from '../components/RemoteSetupPanel';
import { SiteGroup } from '../components/SiteGroup';
import { useAlarm } from '../hooks/useAlarm';
import { useMonitoring } from '../hooks/useMonitoring';
import { SiteState, isInactiveInstance } from '../lib/types';

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

  const visibleSites = useMemo<SiteState[]>(
    () => sites
      .map((site) => ({
        ...site,
        instances: site.instances.filter((instance) => showInactive || !isInactiveInstance(instance)),
      }))
      .filter((site) => site.instances.length > 0),
    [showInactive, sites],
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

  return (
    <div className="relative pb-8 sm:pb-6">
      <AlarmBanner
        sites={sites}
        muted={muted}
        audioBlocked={audioBlocked}
        onToggleMute={toggleMute}
        onEnableSound={enableSound}
      />

      <div className={`space-y-5 ${alarmActive ? 'pt-16' : ''}`}>
        <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-4 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
              {inactiveInstanceCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowInactive((value) => !value)}
                  className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                >
                  {showInactive ? 'Hide inactive sites' : `Show inactive (${inactiveInstanceCount})`}
                </button>
              )}

              <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 shadow-[0_10px_35px_rgba(2,6,23,0.35)]">
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{dateLabel}</p>
                  <p className="text-sm font-semibold text-slate-100">{timeLabel}</p>
                </div>
                <div className="h-10 w-px bg-slate-800" />
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${connDot[connectionStatus]}`} />
                  <span className="text-sm font-medium text-slate-200">{connLabel[connectionStatus]}</span>
                </div>
              </div>
            </div>

            {sites.length === 0 && (
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/8 px-4 py-3 text-sm text-slate-300">
                New account? Start with the onboarding flow, then upload a discovery report to provision the first node.
                <button
                  type="button"
                  onClick={() => onNavigate('/app/onboarding')}
                  className="ml-3 rounded-full border border-cyan-400/35 bg-cyan-400/12 px-3 py-1 text-xs font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
                >
                  Open onboarding
                </button>
              </div>
            )}
          </div>
        </section>

        <AlertContactsEditor />

        <RemoteSetupPanel />

        {visibleSites.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/55 px-8 py-16 text-center shadow-[0_24px_80px_rgba(2,6,23,0.35)] backdrop-blur">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/80">
              <img src="/pulse.svg" alt="Clarix Pulse logo" className="pulse-logo h-9 w-9 object-contain" />
            </div>
            <p className="text-lg font-medium text-slate-200">
              {sites.length === 0 ? 'No nodes yet for this account.' : 'Inactive sites are hidden right now.'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {sites.length === 0
                ? 'Provision the first node from the dashboard or finish the local node setup so it can mirror into this hub.'
                : 'Use the toggle above if you want to review nodes that are not commissioned yet.'}
            </p>
            {sites.length === 0 && (
              <button
                type="button"
                onClick={() => onNavigate('/app/onboarding')}
                className="mt-5 rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
              >
                Start onboarding
              </button>
            )}
          </div>
        ) : (
          visibleSites.map((site) => <SiteGroup key={site.id} site={site} />)
        )}

        <footer className="mt-8 flex flex-col items-start gap-2 border-t border-slate-800/80 py-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-slate-500">Clarix Pulse | Operational Monitoring Platform</span>
          <span className="text-xs text-slate-500">{new Date().getFullYear()} Live workflow visibility</span>
        </footer>
      </div>
    </div>
  );
}
