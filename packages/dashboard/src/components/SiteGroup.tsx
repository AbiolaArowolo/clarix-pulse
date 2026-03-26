import React from 'react';
import { SiteState, StatusColor, getStatusColor, isAlarmState, isConnectivityWarning, isInactiveInstance } from '../lib/types';
import { InstanceCard } from './InstanceCard';

interface Props {
  site: SiteState;
}

export function SiteGroup({ site }: Props) {
  const hasAlarm = site.instances.some(isAlarmState);
  const allInactive = site.instances.every(isInactiveInstance);
  const hasConnectivityIssue = site.instances.some(isConnectivityWarning);
  const hasOfflineInstance = site.instances.some((inst) => isConnectivityWarning(inst) && inst.connectivityHealth === 'offline');
  const severity: Record<StatusColor, number> = {
    gray: 0,
    green: 1,
    yellow: 2,
    orange: 3,
    red: 4,
  };
  const worstColor = site.instances.reduce<StatusColor>((worst, inst) => {
    const color = getStatusColor(inst);
    return severity[color] > severity[worst] ? color : worst;
  }, 'gray');

  const headerBorderMap: Record<StatusColor, string> = {
    red: 'border-red-700/60 shadow-[0_22px_50px_rgba(127,29,29,0.22)]',
    yellow: 'border-yellow-700/40 shadow-[0_22px_50px_rgba(113,63,18,0.18)]',
    orange: 'border-orange-700/40 shadow-[0_22px_50px_rgba(124,45,18,0.18)]',
    green: 'border-emerald-700/30 shadow-[0_22px_50px_rgba(6,95,70,0.16)]',
    gray: 'border-slate-700 shadow-[0_22px_50px_rgba(15,23,42,0.16)]',
  };

  return (
    <section className={`rounded-3xl border bg-slate-900/62 p-5 backdrop-blur ${headerBorderMap[worstColor]}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[0.18em] text-slate-100 uppercase">{site.name}</h2>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">Pulse node cluster</p>
        </div>

        <div className="flex items-center gap-2">
          {allInactive && (
            <span className="rounded-full border border-slate-700 bg-slate-800/90 px-3 py-1 text-xs font-semibold text-slate-300">
              INACTIVE
            </span>
          )}
          {!allInactive && hasConnectivityIssue && !hasAlarm && (
            <span className="rounded-full border border-yellow-700/60 bg-yellow-900/30 px-3 py-1 text-xs font-semibold text-yellow-300">
              ! {hasOfflineInstance ? 'OFFLINE' : 'NETWORK'}
            </span>
          )}
          {hasAlarm && (
            <span className="rounded-full border border-red-700/60 bg-red-900/40 px-3 py-1 text-xs font-semibold text-red-300 animate-pulse">
              OFF AIR
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {site.instances.map((inst) => (
          <InstanceCard key={inst.id} instance={inst} />
        ))}
      </div>
    </section>
  );
}
