import React from 'react';
import { SiteState, isAlarmState } from '../lib/types';

interface Props {
  sites: SiteState[];
  muted: boolean;
  onToggleMute: () => void;
}

export function AlarmBanner({ sites, muted, onToggleMute }: Props) {
  const alarmInstances = sites.flatMap((s) => s.instances.filter(isAlarmState));
  if (alarmInstances.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-700 border-b-2 border-red-500 shadow-lg animate-pulse">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl shrink-0">🔴</span>
          <div className="min-w-0">
            <p className="font-bold text-white text-sm">
              OFF AIR — {alarmInstances.length} instance{alarmInstances.length > 1 ? 's' : ''}
            </p>
            <p className="text-red-200 text-xs truncate">
              {alarmInstances.map((i) => i.label).join(' · ')}
            </p>
          </div>
        </div>
        <button
          onClick={onToggleMute}
          className="shrink-0 rounded-lg bg-red-900/60 border border-red-500 text-white text-sm font-semibold px-4 py-1.5 hover:bg-red-800 transition-colors"
        >
          {muted ? '🔔 Unmute' : '🔕 Mute'}
        </button>
      </div>
    </div>
  );
}
