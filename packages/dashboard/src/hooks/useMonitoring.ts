import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import {
  SiteState,
  InstanceState,
  BroadcastHealth,
  RuntimeHealth,
  ConnectivityHealth,
  MonitoringMode,
} from '../lib/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function useMonitoring() {
  const [sites, setSites] = useState<SiteState[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const thumbnailsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    fetch('/api/status')
      .then((response) => response.json())
      .then((data: { sites: SiteState[] }) => {
        setSites(data.sites ?? []);
      })
      .catch(console.error);

    socket.on('connect', () => setConnectionStatus('connected'));
    socket.on('disconnect', () => setConnectionStatus('disconnected'));
    socket.on('connect_error', () => setConnectionStatus('disconnected'));

    socket.on('full_state', (data: { sites?: SiteState[] } | any[]) => {
      if (!Array.isArray(data) && data?.sites) {
        setSites(data.sites);
        return;
      }

      const states = Array.isArray(data) ? data : [];
      setSites((prev) =>
        prev.map((site) => ({
          ...site,
          instances: site.instances.map((inst) => {
            const fresh = states.find((state: any) => state.instanceId === inst.id || state.playerId === inst.playerId);
            return fresh ? mergeUpdate(inst, fresh) : inst;
          }),
        }))
      );
    });

    socket.on('state_update', (update: any) => {
      setSites((prev) =>
        prev.map((site) => ({
          ...site,
          instances: site.instances.map((inst) =>
            inst.id === (update.playerId ?? update.instanceId) ? mergeUpdate(inst, update) : inst
          ),
        }))
      );
    });

    socket.on('thumbnail_update', (update: { instanceId?: string; playerId?: string; dataUrl: string; capturedAt?: string }) => {
      const targetId = update.playerId ?? update.instanceId;
      if (!targetId) return;

      thumbnailsRef.current.set(targetId, update.dataUrl);
      setSites((prev) =>
        prev.map((site) => ({
          ...site,
          instances: site.instances.map((inst) =>
            inst.id === targetId
              ? {
                  ...inst,
                  hasThumbnail: true,
                  thumbnailAt: update.capturedAt ?? inst.thumbnailAt,
                  thumbnailDataUrl: update.dataUrl,
                }
              : inst
          ),
        }))
      );
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('full_state');
      socket.off('state_update');
      socket.off('thumbnail_update');
    };
  }, []);

  return { sites, connectionStatus };
}

function mergeUpdate(inst: InstanceState, update: any): InstanceState {
  const thumbnailDataUrl = update.thumbnailDataUrl ?? update.thumbnailData ?? inst.thumbnailDataUrl;

  return {
    ...inst,
    nodeId: update.nodeId ?? inst.nodeId,
    playerId: update.playerId ?? inst.playerId,
    monitoringMode: (update.monitoringMode ?? inst.monitoringMode) as MonitoringMode,
    udpMonitoringCapable: update.udpMonitoringCapable ?? inst.udpMonitoringCapable,
    udpMonitoringEnabled: update.udpMonitoringEnabled ?? inst.udpMonitoringEnabled,
    udpInputCount: update.udpInputCount ?? inst.udpInputCount,
    udpHealthyInputCount: update.udpHealthyInputCount ?? inst.udpHealthyInputCount,
    udpSelectedInputId: update.udpSelectedInputId ?? inst.udpSelectedInputId,
    udpProbeEnabled: update.udpProbeEnabled ?? update.udpMonitoringEnabled ?? inst.udpProbeEnabled,
    broadcastHealth: (update.broadcastHealth ?? inst.broadcastHealth) as BroadcastHealth,
    runtimeHealth: (update.runtimeHealth ?? inst.runtimeHealth) as RuntimeHealth,
    connectivityHealth: (update.connectivityHealth ?? inst.connectivityHealth) as ConnectivityHealth,
    lastHeartbeatAt: update.lastHeartbeatAt ?? inst.lastHeartbeatAt,
    updatedAt: update.updatedAt ?? inst.updatedAt,
    hasThumbnail: update.hasThumbnail ?? (thumbnailDataUrl ? true : inst.hasThumbnail),
    thumbnailAt: update.thumbnailAt ?? inst.thumbnailAt,
    thumbnailDataUrl,
  };
}
