import React from 'react';
import { useMonitoring } from './hooks/useMonitoring';
import { useAlarm } from './hooks/useAlarm';
import { SiteGroup } from './components/SiteGroup';
import { AlarmBanner } from './components/AlarmBanner';

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
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
  };

  const hasAlarm = alarmActive && !muted;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900">
      {/* Off-air banner */}
      <AlarmBanner sites={sites} muted={muted} onToggleMute={toggleMute} />

      {/* Sticky header */}
      <header className={`sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-slate-800 ${alarmActive ? 'mt-[60px]' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">CP</div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide">CLARIX PULSE</h1>
              <p className="text-xs text-slate-500">Broadcast Monitor — NOIRE TV</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connDot[connectionStatus]}`} />
            <span className="text-xs text-slate-400">{connLabel[connectionStatus]}</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {sites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500">
            <div className="text-4xl mb-4">📡</div>
            <p className="text-lg font-medium">Waiting for hub connection…</p>
            <p className="text-sm mt-1">Check that the hub is running on port 3001</p>
          </div>
        ) : (
          sites.map((site) => <SiteGroup key={site.id} site={site} />)
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-4 border-t border-slate-800 flex items-center justify-between mt-8">
        <span className="text-xs text-slate-600">Clarix Pulse v1.0.0 · pulse.clarixtech.com</span>
        <span className="text-xs text-slate-600">{new Date().getFullYear()} NOIRE TV / Caspan Media</span>
      </footer>
    </div>
  );
}
