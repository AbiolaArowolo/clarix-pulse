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
  const lastApiSuccessRef = useRef(0);

  useEffect(() => {
    const markConnected = () => setConnectionStatus('connected');
    const markDisconnectedIfHubUnreachable = () => {
      if (Date.now() - lastApiSuccessRef.current > 15_000) {
        setConnectionStatus('disconnected');
      }
    };

    const fetchStatus = () =>
      fetch('/api/status')
      .then((response) => response.json())
      .then((data: { sites: SiteState[] }) => {
        lastApiSuccessRef.current = Date.now();
        setSites(data.sites ?? []);
        markConnected();
      })
      .catch((error) => {
        console.error(error);
        if (!socket.connected) {
          setConnectionStatus('disconnected');
        }
      });

    fetchStatus();
    const fallbackRefresh = window.setInterval(fetchStatus, 5000);

    if (socket.connected) {
      markConnected();
    } else {
      socket.connect();
    }

    socket.on('connect', markConnected);
    socket.on('disconnect', markDisconnectedIfHubUnreachable);
    socket.on('connect_error', markDisconnectedIfHubUnreachable);

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
      window.clearInterval(fallbackRefresh);
      socket.off('connect', markConnected);
      socket.off('disconnect', markDisconnectedIfHubUnreachable);
      socket.off('connect_error', markDisconnectedIfHubUnreachable);
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
