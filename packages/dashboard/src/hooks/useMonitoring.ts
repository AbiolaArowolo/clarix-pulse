import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import { SiteState, InstanceState, BroadcastHealth, RuntimeHealth, ConnectivityHealth } from '../lib/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function useMonitoring() {
  const [sites, setSites] = useState<SiteState[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const thumbnailsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    // Load initial state from REST API
    fetch('/api/status')
      .then((r) => r.json())
      .then((data: { sites: SiteState[] }) => {
        setSites(data.sites ?? []);
      })
      .catch(console.error);

    socket.on('connect', () => setConnectionStatus('connected'));
    socket.on('disconnect', () => setConnectionStatus('disconnected'));
    socket.on('connect_error', () => setConnectionStatus('disconnected'));

    // Full state broadcast on initial WebSocket connection
    socket.on('full_state', (states: any[]) => {
      setSites((prev) =>
        prev.map((site) => ({
          ...site,
          instances: site.instances.map((inst) => {
            const fresh = states.find((s: any) => s.instanceId === inst.id);
            if (!fresh) return inst;
            return mergeUpdate(inst, fresh);
          }),
        }))
      );
    });

    // Incremental state update (per heartbeat)
    socket.on('state_update', (update: any) => {
      setSites((prev) =>
        prev.map((site) => ({
          ...site,
          instances: site.instances.map((inst) =>
            inst.id === update.instanceId ? mergeUpdate(inst, update) : inst
          ),
        }))
      );
    });

    // Thumbnail update
    socket.on('thumbnail_update', ({ instanceId, dataUrl }: { instanceId: string; dataUrl: string }) => {
      thumbnailsRef.current.set(instanceId, dataUrl);
      setSites((prev) =>
        prev.map((site) => ({
          ...site,
          instances: site.instances.map((inst) =>
            inst.id === instanceId
              ? { ...inst, hasThumbnail: true, thumbnailDataUrl: dataUrl }
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
  return {
    ...inst,
    broadcastHealth: (update.broadcastHealth ?? inst.broadcastHealth) as BroadcastHealth,
    runtimeHealth: (update.runtimeHealth ?? inst.runtimeHealth) as RuntimeHealth,
    connectivityHealth: (update.connectivityHealth ?? inst.connectivityHealth) as ConnectivityHealth,
    lastHeartbeatAt: update.lastHeartbeatAt ?? inst.lastHeartbeatAt,
    updatedAt: update.updatedAt ?? inst.updatedAt,
  };
}
