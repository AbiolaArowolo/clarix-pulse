import { useEffect, useRef, useState } from 'react';
import { getHubSocket } from '../lib/socket';
import {
  SiteState,
  InstanceState,
  BroadcastHealth,
  RuntimeHealth,
  ConnectivityHealth,
  MonitoringMode,
} from '../lib/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const FALLBACK_REFRESH_MS = 15_000;
const DISCONNECT_THRESHOLD_MS = 8000;

export function useMonitoring() {
  const [sites, setSites] = useState<SiteState[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const thumbnailsRef = useRef<Map<string, string>>(new Map());
  const lastApiSuccessRef = useRef(0);

  useEffect(() => {
    const socket = getHubSocket();
    const markConnected = () => setConnectionStatus('connected');
    const markDisconnectedIfHubUnreachable = () => {
      if (Date.now() - lastApiSuccessRef.current > DISCONNECT_THRESHOLD_MS && !socket.connected) {
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
    const fallbackRefresh = window.setInterval(fetchStatus, FALLBACK_REFRESH_MS);

    if (socket.connected) {
      markConnected();
    } else {
      socket.connect();
    }

    socket.on('connect', markConnected);
    socket.on('disconnect', markDisconnectedIfHubUnreachable);
    socket.on('connect_error', markDisconnectedIfHubUnreachable);

    socket.on('full_state', (data: { sites?: SiteState[] } | any[]) => {
      markConnected();

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
      markConnected();
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
      markConnected();
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

    // Player lifecycle is controlled by the agent's local config.
    // When a player is removed from local config the hub emits player_removed
    // and the UI removes it from the live view immediately.
    socket.on('player_removed', (event: { playerId: string; nodeId: string }) => {
      markConnected();
      if (!event.playerId) return;
      thumbnailsRef.current.delete(event.playerId);
      setSites((prev) =>
        prev
          .map((site) => ({
            ...site,
            instances: site.instances.filter((inst) => inst.id !== event.playerId),
          }))
          .filter((site) => site.instances.length > 0),
      );
    });

    socket.on('node_removed', (event: { nodeId: string }) => {
      markConnected();
      if (!event?.nodeId) return;
      setSites((prev) =>
        prev
          .map((site) => ({
            ...site,
            instances: site.instances.filter((inst) => inst.nodeId !== event.nodeId),
          }))
          .filter((site) => site.instances.length > 0),
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
      socket.off('player_removed');
      socket.off('node_removed');
    };
  }, []);

  return { sites, connectionStatus };
}

function hasOwn(update: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(update, key);
}

function mergeUpdate(inst: InstanceState, update: any): InstanceState {
  const updateRecord = update && typeof update === 'object' ? update as Record<string, unknown> : {};
  const thumbnailDataUrl = update.thumbnailDataUrl ?? update.thumbnailData ?? inst.thumbnailDataUrl;

  return {
    ...inst,
    nodeId: update.nodeId ?? inst.nodeId,
    playerId: update.playerId ?? inst.playerId,
    commissioned: update.commissioned ?? inst.commissioned,
    monitoringMode: (update.monitoringMode ?? inst.monitoringMode) as MonitoringMode,
    monitoringEnabled: update.monitoringEnabled ?? inst.monitoringEnabled,
    maintenanceMode: update.maintenanceMode ?? inst.maintenanceMode,
    udpMonitoringCapable: update.udpMonitoringCapable ?? inst.udpMonitoringCapable,
    udpMonitoringEnabled: update.udpMonitoringEnabled ?? inst.udpMonitoringEnabled,
    udpInputCount: update.udpInputCount ?? inst.udpInputCount,
    udpHealthyInputCount: update.udpHealthyInputCount ?? inst.udpHealthyInputCount,
    udpSelectedInputId: hasOwn(updateRecord, 'udpSelectedInputId')
      ? (update.udpSelectedInputId as string | null)
      : inst.udpSelectedInputId,
    udpProbeEnabled: update.udpProbeEnabled ?? update.udpMonitoringEnabled ?? inst.udpProbeEnabled,
    broadcastHealth: (update.broadcastHealth ?? inst.broadcastHealth) as BroadcastHealth,
    runtimeHealth: (update.runtimeHealth ?? inst.runtimeHealth) as RuntimeHealth,
    connectivityHealth: (update.connectivityHealth ?? inst.connectivityHealth) as ConnectivityHealth,
    connectivityIssue: hasOwn(updateRecord, 'connectivityIssue')
      ? (update.connectivityIssue as string | null)
      : inst.connectivityIssue,
    lastHeartbeatAt: update.lastHeartbeatAt ?? inst.lastHeartbeatAt,
    updatedAt: update.updatedAt ?? inst.updatedAt,
    hasThumbnail: update.hasThumbnail ?? (thumbnailDataUrl ? true : inst.hasThumbnail),
    thumbnailAt: update.thumbnailAt ?? inst.thumbnailAt,
    thumbnailDataUrl,
  };
}
