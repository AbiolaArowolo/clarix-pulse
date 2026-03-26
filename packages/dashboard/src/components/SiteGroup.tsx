import React from 'react';
import { SiteState, getStatusColor, isAlarmState } from '../lib/types';
import { InstanceCard } from './InstanceCard';

interface Props {
  site: SiteState;
}

export function SiteGroup({ site }: Props) {
  const hasAlarm = site.instances.some(isAlarmState);
  const worstColor = site.instances.reduce<string>((worst, inst) => {
    const c = getStatusColor(inst);
    if (c === 'red') return 'red';
    if (c === 'yellow' && worst !== 'red') return 'yellow';
    if (c === 'orange' && worst !== 'red' && worst !== 'yellow') return 'orange';
    return worst;
  }, 'green');

  const headerBorderMap: Record<string, string> = {
    red:    'border-red-700/60',
    yellow: 'border-yellow-700/40',
    orange: 'border-orange-700/40',
    green:  'border-emerald-700/30',
    gray:   'border-slate-700',
  };

  return (
    <section className={`rounded-2xl bg-slate-900/60 border p-5 ${headerBorderMap[worstColor] ?? 'border-slate-700'}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-slate-200 tracking-wide uppercase">{site.name}</h2>
        {hasAlarm && (
          <span className="text-xs font-bold text-red-400 bg-red-900/40 border border-red-700/60 rounded-full px-3 py-1 animate-pulse">
            OFF AIR
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {site.instances.map((inst) => (
          <InstanceCard key={inst.id} instance={inst} />
        ))}
      </div>
    </section>
  );
}
