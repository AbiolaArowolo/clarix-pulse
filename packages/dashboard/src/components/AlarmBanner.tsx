import React from 'react';
import { SiteState, isAlarmState } from '../lib/types';

interface Props {
  sites: SiteState[];
  muted: boolean;
  audioBlocked: boolean;
  onToggleMute: () => void;
  onEnableSound: () => void;
}

export function AlarmBanner({ sites, muted, audioBlocked, onToggleMute, onEnableSound }: Props) {
  const alarmInstances = sites.flatMap((site) => site.instances.filter(isAlarmState));
  if (alarmInstances.length === 0) return null;
  const alarmSummary = alarmInstances
    .map((instance) => `${instance.label} [${instance.playerId}]`)
    .join(' | ');

  return (
    <div className="fixed left-0 right-0 top-0 z-50 border-b-2 border-red-500 bg-red-700 shadow-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-full border border-red-300/40 bg-red-950/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-red-100">
            Alarm
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">
              OFF AIR | {alarmInstances.length} instance{alarmInstances.length > 1 ? 's' : ''}
            </p>
            <p className="truncate text-xs text-red-100">
              {alarmSummary}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {audioBlocked && !muted && (
            <button
              type="button"
              onClick={onEnableSound}
              className="rounded-lg border border-amber-300/70 bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-200"
            >
              Enable sound
            </button>
          )}
          <button
            type="button"
            aria-pressed={muted}
            onClick={onToggleMute}
            className="rounded-lg border border-red-400/70 bg-red-900/60 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-800"
          >
            {muted ? 'Alarm sound off' : 'Turn off alarm sound'}
          </button>
        </div>
      </div>
    </div>
  );
}
