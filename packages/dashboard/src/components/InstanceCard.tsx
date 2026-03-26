import React, { useEffect, useState } from 'react';
import { InstanceState, getStatusColor } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { StreamThumbnail } from './StreamThumbnail';

interface Props {
  instance: InstanceState;
}

function formatAge(isoString: string | null, nowMs: number): string {
  if (!isoString) return 'never';
  const secs = Math.max(0, Math.round((nowMs - new Date(isoString).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

const BROADCAST_LABELS: Record<string, string> = {
  healthy: 'On Air',
  degraded: 'Degraded',
  off_air_likely: 'Off Air (likely)',
  off_air_confirmed: 'OFF AIR',
  unknown: 'Unknown',
};

const RUNTIME_LABELS: Record<string, string> = {
  healthy: 'Playing',
  paused: 'Paused',
  restarting: 'Restarting',
  stalled: 'Stalled',
  stopped: 'Stopped',
  content_error: 'Content Error',
  unknown: 'Unknown',
};

export function InstanceCard({ instance }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const color = getStatusColor(instance);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 5000);
    return () => window.clearInterval(interval);
  }, []);

  const borderColorMap: Record<typeof color, string> = {
    green: 'border-emerald-600/40',
    yellow: 'border-yellow-500/40',
    red: 'border-red-600/60',
    orange: 'border-orange-500/40',
    gray: 'border-slate-700',
  };

  const glowMap: Record<typeof color, string> = {
    green: '',
    yellow: '',
    red: 'shadow-red-900/40 shadow-lg',
    orange: '',
    gray: '',
  };

  const udpLabel = instance.udpMonitoringEnabled
    ? `UDP ${instance.udpHealthyInputCount}/${Math.max(instance.udpInputCount, 1)}`
    : 'UDP off';

  return (
    <div
      className={`rounded-xl bg-slate-800/60 border p-4 flex flex-col gap-3 transition-all duration-300 ${borderColorMap[color]} ${glowMap[color]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-100 text-sm leading-tight">{instance.label}</h3>
          <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide">{instance.playoutType}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Node: {instance.nodeId} · Player: {instance.playerId}
          </p>
        </div>
        <StatusBadge
          color={color}
          label={BROADCAST_LABELS[instance.broadcastHealth] ?? instance.broadcastHealth}
          size="md"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <StatusBadge color={color} label={`Runtime: ${RUNTIME_LABELS[instance.runtimeHealth] ?? instance.runtimeHealth}`} />
        <StatusBadge
          color={instance.connectivityHealth === 'online' ? 'green' : 'yellow'}
          label={`Net: ${instance.connectivityHealth}`}
        />
        <span className="text-xs text-slate-500 border border-slate-700 rounded-full px-2 py-0.5">
          Mode: {instance.monitoringMode}
        </span>
        <span className="text-xs text-slate-500 border border-slate-700 rounded-full px-2 py-0.5">
          {udpLabel}
        </span>
        {instance.udpSelectedInputId && (
          <span className="text-xs text-slate-500 border border-slate-700 rounded-full px-2 py-0.5">
            Source: {instance.udpSelectedInputId}
          </span>
        )}
      </div>

      <div className="text-xs text-slate-500">
        Last heartbeat: <span className="text-slate-400">{formatAge(instance.lastHeartbeatAt, nowMs)}</span>
      </div>

      {(instance.udpMonitoringEnabled || instance.hasThumbnail) && (
        <StreamThumbnail
          dataUrl={instance.thumbnailDataUrl}
          capturedAt={instance.thumbnailAt}
          instanceLabel={instance.label}
        />
      )}
    </div>
  );
}
