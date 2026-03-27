import React, { useEffect, useMemo, useState } from 'react';
import { useMonitoring } from './hooks/useMonitoring';
import { useAlarm } from './hooks/useAlarm';
import { SiteGroup } from './components/SiteGroup';
import { AlarmBanner } from './components/AlarmBanner';
import { InstallBar, InstallBarMode } from './components/InstallBar';
import { SiteState, isInactiveInstance } from './lib/types';

const SHOW_INACTIVE_KEY = 'pulse.show_inactive';

function readStoredBoolean(key: string, fallback = false): boolean {
  if (typeof window === 'undefined') return fallback;

  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return value === '1';
  } catch {
    return fallback;
  }
}

export default function App() {
  const { sites, connectionStatus } = useMonitoring();
  const { alarmActive, muted, toggleMute } = useAlarm(sites);
  const [showInactive, setShowInactive] = useState(() => readStoredBoolean(SHOW_INACTIVE_KEY));
  const [installBarMode, setInstallBarMode] = useState<InstallBarMode>('expanded');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SHOW_INACTIVE_KEY, showInactive ? '1' : '0');
  }, [showInactive]);

  const inactiveInstanceCount = useMemo(
    () => sites.reduce((count, site) => count + site.instances.filter(isInactiveInstance).length, 0),
    [sites]
  );
  const visibleSites = useMemo<SiteState[]>(
    () => sites
      .map((site) => ({
        ...site,
        instances: site.instances.filter((instance) => showInactive || !isInactiveInstance(instance)),
      }))
      .filter((site) => site.instances.length > 0),
    [showInactive, sites]
  );
  const installPadding = installBarMode === 'expanded'
    ? 'pb-80 sm:pb-44'
    : installBarMode === 'collapsed'
      ? 'pb-24 sm:pb-16'
      : 'pb-8 sm:pb-6';
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
    <div className={`relative min-h-dvh overflow-hidden bg-slate-950 ${installPadding}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.15),transparent_32%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.1),transparent_24%),linear-gradient(180deg,#020617_0%,#0f172a_55%,#111827_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,rgba(15,118,110,0.14),transparent)]" />

      <AlarmBanner sites={sites} muted={muted} onToggleMute={toggleMute} />

      <header className={`sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/82 backdrop-blur-xl ${alarmActive ? 'mt-[60px]' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-blue-400/20 bg-[#071538] shadow-[0_16px_34px_rgba(7,21,56,0.52)]">
                <img src="/pulse.svg" alt="Pulse logo" className="h-full w-full object-cover" />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-wide text-white">Pulse</h1>
                <p className="text-sm text-slate-400">Broadcast Monitor</p>
              </div>
            </div>

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
          </div>
        </div>
      </header>

      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {visibleSites.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/55 px-8 py-16 text-center shadow-[0_24px_80px_rgba(2,6,23,0.35)] backdrop-blur">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/80 text-xl text-slate-500">
              Signal
            </div>
            <p className="text-lg font-medium text-slate-200">
              {sites.length === 0 ? 'Waiting for monitoring data...' : 'Inactive sites are hidden right now.'}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {sites.length === 0
                ? 'Check the hub API, live socket path, and the first node heartbeat.'
                : 'Use the header switch if you want to review nodes that are not commissioned yet.'}
            </p>
          </div>
        ) : (
          visibleSites.map((site) => <SiteGroup key={site.id} site={site} />)
        )}
      </main>

      <footer className="relative max-w-7xl mx-auto mt-8 flex flex-col items-start gap-2 border-t border-slate-800/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span className="text-xs text-slate-500">Pulse | Broadcast Monitoring Platform</span>
        <span className="text-xs text-slate-500">{new Date().getFullYear()} Multi-site monitoring</span>
      </footer>

      <InstallBar onModeChange={setInstallBarMode} />
    </div>
  );
}
