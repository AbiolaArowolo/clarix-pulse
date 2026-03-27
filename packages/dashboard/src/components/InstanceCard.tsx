import React, { useEffect, useState } from 'react';
import {
  InstanceState,
  getConnectivityBadgeColor,
  getHeadlineStatus,
  getRuntimeBadgeColor,
  getStatusColor,
  isConnectivityWarning,
  isInactiveInstance,
} from '../lib/types';
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

const RUNTIME_LABELS: Record<string, string> = {
  healthy: 'Playing',
  paused: 'Paused',
  restarting: 'Restarting',
  stalled: 'Stalled',
  stopped: 'Stopped',
  content_error: 'Content Error',
  unknown: 'Inactive',
};

export function InstanceCard({ instance }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const color = getStatusColor(instance);
  const headline = getHeadlineStatus(instance);
  const inactive = isInactiveInstance(instance);
  const connectivityWarning = isConnectivityWarning(instance);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const borderColorMap: Record<typeof color, string> = {
    green: 'border-emerald-600/45',
    yellow: 'border-yellow-500/45',
    red: 'border-red-600/60',
    orange: 'border-orange-500/45',
    gray: 'border-slate-700',
  };

  const glowMap: Record<typeof color, string> = {
    green: 'shadow-[0_18px_34px_rgba(5,150,105,0.12)]',
    yellow: 'shadow-[0_18px_34px_rgba(161,98,7,0.12)]',
    red: 'shadow-[0_18px_34px_rgba(153,27,27,0.2)]',
    orange: 'shadow-[0_18px_34px_rgba(194,65,12,0.12)]',
    gray: 'shadow-[0_16px_30px_rgba(15,23,42,0.16)]',
  };

  const udpLabel = instance.udpMonitoringEnabled
    ? `UDP matrix: ${instance.udpHealthyInputCount}/${Math.max(instance.udpInputCount, 1)} healthy`
    : instance.udpMonitoringCapable
      ? 'UDP matrix: configurable'
      : 'UDP matrix: off';
  const modeLabel = instance.udpMonitoringEnabled ? 'Mode: local + UDP' : 'Mode: local only';
  const runtimeLabel = inactive
    ? 'Runtime: inactive'
    : `Runtime: ${RUNTIME_LABELS[instance.runtimeHealth] ?? instance.runtimeHealth}`;
  const connectivityLabel = inactive
    ? 'Net: inactive'
    : `Net: ${instance.connectivityHealth}`;
  const heartbeatLabel = inactive ? 'inactive' : formatAge(instance.lastHeartbeatAt, nowMs);

  return (
    <div
      className={`rounded-2xl border bg-[linear-gradient(180deg,rgba(30,41,59,0.78),rgba(15,23,42,0.95))] p-4 transition-all duration-300 ${borderColorMap[color]} ${glowMap[color]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight text-slate-100">{instance.label}</h3>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">{instance.playoutType}</p>
          <p className="mt-2 text-[11px] text-slate-500">
            Node: {instance.nodeId} | Player: {instance.playerId}
          </p>
        </div>
        <StatusBadge
          color={headline.color}
          label={headline.label}
          size="md"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StatusBadge color={getRuntimeBadgeColor(instance)} label={runtimeLabel} />
        <StatusBadge
          color={getConnectivityBadgeColor(instance)}
          label={connectivityLabel}
        />
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
          {modeLabel}
        </span>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
          {udpLabel}
        </span>
        {instance.udpSelectedInputId && (
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
            Selected on node: {instance.udpSelectedInputId}
          </span>
        )}
      </div>

      {inactive && (
        <div className="mt-3 text-[11px] text-slate-500">
          This node is not commissioned yet, so it stays out of alarms until install and first heartbeat.
        </div>
      )}

      {connectivityWarning && (
        <div className="mt-3 rounded-xl border border-yellow-700/40 bg-yellow-900/15 px-3 py-2 text-[11px] text-yellow-200">
          ! Heartbeats are delayed or offline. Local monitoring may still be active on the node.
        </div>
      )}

      <div className="mt-3 text-xs text-slate-500">
        Last heartbeat: <span className="text-slate-300">{heartbeatLabel}</span>
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
