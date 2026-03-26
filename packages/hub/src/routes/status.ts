import { Router, Request, Response } from 'express';
import { getAllStates } from '../store/state';
import { SITES } from '../config/instances';

export function buildStatusPayload() {
  const states = getAllStates();
  const stateMap = new Map(states.map((state) => [state.instanceId, state]));

  const sites = SITES.map((site) => ({
    id: site.id,
    name: site.name,
    instances: site.instances.map((inst) => {
      const state = stateMap.get(inst.id);
      const udpInputCount = Number(state?.lastObservations?.udp_input_count ?? 0);
      const udpHealthyInputCount = Number(state?.lastObservations?.udp_healthy_input_count ?? 0);
      const udpMonitoringEnabled = (state?.lastObservations?.udp_enabled ?? 0) === 1 || udpInputCount > 0;

      return {
        id: inst.id,
        nodeId: inst.nodeId,
        playerId: inst.playerId,
        label: inst.label,
        siteId: inst.siteId,
        playoutType: inst.playoutType,
        monitoringMode: udpMonitoringEnabled ? 'hybrid' : 'local',
        udpMonitoringCapable: inst.udpMonitoringCapable,
        udpMonitoringEnabled,
        udpInputCount,
        udpHealthyInputCount,
        udpSelectedInputId: (state?.lastObservations?.udp_selected_input_id as string | null | undefined) ?? null,
        broadcastHealth: state?.broadcastHealth ?? 'unknown',
        runtimeHealth: state?.runtimeHealth ?? 'unknown',
        connectivityHealth: state?.connectivityHealth ?? 'offline',
        lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
        updatedAt: state?.updatedAt ?? null,
        hasThumbnail: !!state?.thumbnailData,
        thumbnailAt: state?.thumbnailAt ?? null,
        thumbnailDataUrl: state?.thumbnailData ?? undefined,
        udpProbeEnabled: udpMonitoringEnabled,
      };
    }),
  }));

  return { sites, timestamp: new Date().toISOString() };
}

export function createStatusRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json(buildStatusPayload());
  });

  return router;
}
