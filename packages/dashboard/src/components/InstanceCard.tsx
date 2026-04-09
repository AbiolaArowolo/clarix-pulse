import React, { useEffect, useState } from 'react';
import {
  InstanceState,
  StatusColor,
  getConnectivityBadgeColor,
  getHeadlineStatus,
  getRuntimeBadgeColor,
  getStatusColor,
  isConnectivityWarning,
  isInactiveInstance,
  isMonitoringSuppressed,
} from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { StreamThumbnail } from './StreamThumbnail';
import { UdpConfigEditor } from './UdpConfigEditor';

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

function MonitoringControls({ instance }: Props) {
  const [monitoringEnabled, setMonitoringEnabled] = useState(instance.monitoringEnabled);
  const [maintenanceMode, setMaintenanceMode] = useState(instance.maintenanceMode);
  const [saving, setSaving] = useState<'monitoring' | 'maintenance' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMonitoringEnabled(instance.monitoringEnabled);
  }, [instance.monitoringEnabled]);

  useEffect(() => {
    setMaintenanceMode(instance.maintenanceMode);
  }, [instance.maintenanceMode]);

  const updateControls = async (patch: { monitoringEnabled?: boolean; maintenanceMode?: boolean }, kind: 'monitoring' | 'maintenance') => {
    const previous = {
      monitoringEnabled,
      maintenanceMode,
    };

    if (patch.monitoringEnabled !== undefined) {
      setMonitoringEnabled(patch.monitoringEnabled);
    }
    if (patch.maintenanceMode !== undefined) {
      setMaintenanceMode(patch.maintenanceMode);
    }

    setSaving(kind);
    setError(null);

    try {
      const response = await fetch(`/api/config/instance/${instance.playerId}/controls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Failed to update controls.'));
      }

      setMonitoringEnabled(Boolean(payload?.controls?.monitoringEnabled ?? patch.monitoringEnabled ?? previous.monitoringEnabled));
      setMaintenanceMode(Boolean(payload?.controls?.maintenanceMode ?? patch.maintenanceMode ?? previous.maintenanceMode));
    } catch (err) {
      setMonitoringEnabled(previous.monitoringEnabled);
      setMaintenanceMode(previous.maintenanceMode);
      setError(err instanceof Error ? err.message : 'Failed to update controls.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/35 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Monitoring Controls</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void updateControls({ maintenanceMode: !maintenanceMode }, 'maintenance')}
            disabled={saving !== null}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              maintenanceMode
                ? 'border-orange-500/60 bg-orange-500/15 text-orange-200'
                : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
            }`}
          >
            {saving === 'maintenance' ? 'Saving...' : maintenanceMode ? 'Maintenance on' : 'Maintenance off'}
          </button>
          <button
            type="button"
            onClick={() => void updateControls({ monitoringEnabled: !monitoringEnabled }, 'monitoring')}
            disabled={saving !== null}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              monitoringEnabled
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-red-500/60 bg-red-500/15 text-red-200'
            }`}
          >
            {saving === 'monitoring' ? 'Saving...' : monitoringEnabled ? 'Monitoring on' : 'Monitoring off'}
          </button>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Use maintenance to pause alarms and alerts during work. Turn monitoring off to remove this player from live alarming entirely.
      </p>

      {error && (
        <div className="mt-2 rounded-xl border border-red-700/40 bg-red-900/20 px-3 py-2 text-[11px] text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

export function InstanceCard({ instance }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const color = getStatusColor(instance);
  const headline = getHeadlineStatus(instance);
  const inactive = isInactiveInstance(instance);
  const connectivityWarning = isConnectivityWarning(instance);
  const monitoringSuppressed = isMonitoringSuppressed(instance);
  const showUdpMonitoring = instance.udpMonitoringEnabled && instance.udpInputCount > 0;
  const udpAllHealthy = showUdpMonitoring && instance.udpHealthyInputCount >= instance.udpInputCount;
  const udpBadgeColor = showUdpMonitoring
    ? (udpAllHealthy ? 'green' : instance.udpHealthyInputCount > 0 ? 'yellow' : 'red')
    : 'gray';

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

  const udpLabel = `UDP matrix: ${instance.udpHealthyInputCount}/${Math.max(instance.udpInputCount, 1)} healthy`;
  const modeLabel = !instance.monitoringEnabled
    ? 'Mode: monitoring off'
    : instance.maintenanceMode
      ? 'Mode: maintenance'
      : showUdpMonitoring ? 'Mode: local + stream' : 'Mode: local only';
  const runtimeLabel = inactive
    ? 'Runtime: inactive'
    : !instance.monitoringEnabled
      ? 'Runtime: monitoring off'
      : instance.maintenanceMode
        ? 'Runtime: maintenance'
        : `Runtime: ${RUNTIME_LABELS[instance.runtimeHealth] ?? instance.runtimeHealth}`;
  const connectivityLabel = inactive
    ? 'Net: inactive'
    : !instance.monitoringEnabled
      ? 'Net: monitoring off'
      : instance.maintenanceMode
        ? 'Net: maintenance'
        : `Net: ${instance.connectivityHealth}`;
  const heartbeatLabel = inactive ? 'inactive' : formatAge(instance.lastHeartbeatAt, nowMs);
  const statusBadges: Array<{ key: string; color: StatusColor; label: string }> = [
    { key: 'runtime', color: getRuntimeBadgeColor(instance), label: runtimeLabel },
    { key: 'connectivity', color: getConnectivityBadgeColor(instance), label: connectivityLabel },
    {
      key: 'mode',
      color: monitoringSuppressed ? 'gray' : showUdpMonitoring ? udpBadgeColor : 'gray',
      label: modeLabel,
    },
  ];

  if (!monitoringSuppressed && showUdpMonitoring) {
    statusBadges.push({ key: 'udp-health', color: udpBadgeColor, label: udpLabel });
  }

  if (!monitoringSuppressed && showUdpMonitoring && instance.udpSelectedInputId) {
    statusBadges.push({
      key: 'udp-selected',
      color: udpBadgeColor,
      label: `Selected on node: ${instance.udpSelectedInputId}`,
    });
  }

  return (
    <div
      className={`theme-dark-gradient-card rounded-2xl border bg-[linear-gradient(180deg,rgba(30,41,59,0.78),rgba(15,23,42,0.95))] p-4 transition-all duration-300 ${borderColorMap[color]} ${glowMap[color]}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold leading-tight text-slate-100">{instance.label}</h3>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">{instance.playoutType}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <span className="min-w-0 rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
              <span className="block truncate">Instance {instance.playerId}</span>
            </span>
            <span className="min-w-0 rounded-full border border-slate-800 bg-slate-950/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              <span className="block truncate">Node {instance.nodeId}</span>
            </span>
          </div>
        </div>
        <StatusBadge
          color={headline.color}
          label={headline.label}
          size="md"
        />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {statusBadges.map((badge) => (
          <div key={badge.key} className="min-w-0">
            <StatusBadge color={badge.color} label={badge.label} />
          </div>
        ))}
      </div>

      {inactive && (
        <div className="mt-3 text-[11px] text-slate-500">
          This node is not commissioned yet, so it stays out of alarms until install and first heartbeat.
        </div>
      )}

      {connectivityWarning && (
        <div className="mt-3 rounded-xl border border-yellow-700/40 bg-yellow-900/15 px-3 py-2 text-[11px] text-yellow-200">
          ! {instance.connectivityIssue ?? 'Heartbeats are delayed or offline. Local monitoring may still be active on the node.'}
        </div>
      )}

      {!instance.monitoringEnabled && (
        <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-300">
          Monitoring is turned off for this player. Alarm banner, email, and Telegram alerts stay suppressed until you turn monitoring back on.
        </div>
      )}

      {instance.maintenanceMode && instance.monitoringEnabled && (
        <div className="mt-3 rounded-xl border border-orange-700/40 bg-orange-900/15 px-3 py-2 text-[11px] text-orange-200">
          Maintenance mode is on. Alarm banner, email, and Telegram alerts are paused for this player until maintenance is turned off.
        </div>
      )}

      <div className="mt-3 text-xs text-slate-500">
        Last heartbeat: <span className="text-slate-300">{heartbeatLabel}</span>
      </div>

      <MonitoringControls instance={instance} />

      {instance.udpMonitoringCapable && (
        <UdpConfigEditor playerId={instance.playerId} />
      )}

      {!monitoringSuppressed && showUdpMonitoring && instance.hasThumbnail && (
        <StreamThumbnail
          playerId={instance.playerId}
          available={instance.hasThumbnail}
          dataUrl={instance.thumbnailDataUrl}
          capturedAt={instance.thumbnailAt}
          instanceLabel={instance.label}
        />
      )}
    </div>
  );
}
