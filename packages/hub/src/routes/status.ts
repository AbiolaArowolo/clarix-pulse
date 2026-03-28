import { Router, Request, Response } from 'express';
import { getInstanceControls } from '../store/instanceControls';
import { listPlayers } from '../store/registry';
import { getAllStates } from '../store/state';

export async function buildStatusPayload() {
  const states = getAllStates();
  const stateMap = new Map(states.map((state) => [state.instanceId, state]));
  const players = await listPlayers();

  const siteMap = new Map<string, {
    id: string;
    name: string;
    instances: Array<Record<string, unknown>>;
  }>();

  for (const player of players) {
    const state = stateMap.get(player.playerId);
    const controls = getInstanceControls(player.playerId);
    const udpInputCount = Number(state?.lastObservations?.udp_input_count ?? 0);
    const udpHealthyInputCount = Number(state?.lastObservations?.udp_healthy_input_count ?? 0);
    const udpMonitoringEnabled = (state?.lastObservations?.udp_enabled ?? 0) === 1 || udpInputCount > 0;
    const site = siteMap.get(player.siteId) ?? {
      id: player.siteId,
      name: player.siteName,
      instances: [],
    };

    site.instances.push({
      id: player.playerId,
      nodeId: player.nodeId,
      playerId: player.playerId,
      label: player.label,
      siteId: player.siteId,
      playoutType: player.playoutType,
      commissioned: player.commissioned,
      monitoringMode: !controls.monitoringEnabled
        ? 'disabled'
        : controls.maintenanceMode
          ? 'maintenance'
          : udpMonitoringEnabled
            ? 'hybrid'
            : 'local',
      monitoringEnabled: controls.monitoringEnabled,
      maintenanceMode: controls.maintenanceMode,
      udpMonitoringCapable: player.udpMonitoringCapable,
      udpMonitoringEnabled,
      udpInputCount,
      udpHealthyInputCount,
      udpSelectedInputId: (state?.lastObservations?.udp_selected_input_id as string | null | undefined) ?? null,
      broadcastHealth: state?.broadcastHealth ?? 'unknown',
      runtimeHealth: state?.runtimeHealth ?? 'unknown',
      connectivityHealth: state?.connectivityHealth ?? 'offline',
      lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
      updatedAt: state?.updatedAt ?? null,
      hasThumbnail: !!state?.thumbnailAt,
      thumbnailAt: state?.thumbnailAt ?? null,
      udpProbeEnabled: udpMonitoringEnabled,
    });

    siteMap.set(player.siteId, site);
  }

  return {
    sites: Array.from(siteMap.values()),
    timestamp: new Date().toISOString(),
  };
}

export function createStatusRouter(): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    res.json(await buildStatusPayload());
  });

  return router;
}
