import React from 'react';
import { useMonitoring } from './hooks/useMonitoring';
import { useAlarm } from './hooks/useAlarm';
import { SiteGroup } from './components/SiteGroup';
import { AlarmBanner } from './components/AlarmBanner';
import { InstallBar } from './components/InstallBar';

export default function App() {
  const { sites, connectionStatus } = useMonitoring();
  const { alarmActive, muted, toggleMute } = useAlarm(sites);

  const connDot: Record<typeof connectionStatus, string> = {
    connected: 'bg-emerald-400',
    connecting: 'bg-yellow-400 animate-pulse',
    disconnected: 'bg-red-500 animate-pulse',
  };

  const connLabel: Record<typeof connectionStatus, string> = {
    connected: 'Live',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
  };

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-950 to-slate-900 pb-80 sm:pb-44">
      <AlarmBanner sites={sites} muted={muted} onToggleMute={toggleMute} />

      <header className={`sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-slate-800 ${alarmActive ? 'mt-[60px]' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold text-sm">
              P
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide">Pulse</h1>
              <p className="text-xs text-slate-500">Broadcast Monitor - NOIRE TV</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connDot[connectionStatus]}`} />
            <span className="text-xs text-slate-400">{connLabel[connectionStatus]}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {sites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500">
            <div className="text-4xl mb-4">Signal</div>
            <p className="text-lg font-medium">Waiting for monitoring data...</p>
            <p className="text-sm mt-1">Check the hub API, WebSocket connection, and initial status bootstrap.</p>
          </div>
        ) : (
          sites.map((site) => <SiteGroup key={site.id} site={site} />)
        )}
      </main>

      <footer className="max-w-7xl mx-auto mt-8 flex flex-col items-start gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span className="text-xs text-slate-600">Pulse v1.0.0 - pulse.clarixtech.com</span>
        <span className="text-xs text-slate-600">{new Date().getFullYear()} NOIRE TV / clarixtech</span>
      </footer>

      <InstallBar />
    </div>
  );
}
