import { LEGACY_BOOTSTRAP_ENABLED, isLegacyBootstrapPlayerId } from '../config/instances';
import { Router, Request, Response } from 'express';
import { describeConnectivityIssue } from '../services/connectivityIssues';
import { getInstanceControls } from '../store/instanceControls';
import { listPlayers } from '../store/registry';
import { getAllStates } from '../store/state';

export async function buildStatusPayload(tenantId: string) {
  const states = getAllStates();
  const stateMap = new Map(states.map((state) => [state.instanceId, state]));
  const allPlayers = await listPlayers(tenantId);
  const players = allPlayers.filter((player) => {
    if (LEGACY_BOOTSTRAP_ENABLED) {
      return true;
    }

    if (!isLegacyBootstrapPlayerId(player.playerId)) {
      return true;
    }

    return Boolean(player.lastSeenAt || player.lastEnrolledAt);
  });

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
      connectivityIssue: describeConnectivityIssue({
        connectivityHealth: state?.connectivityHealth ?? 'offline',
        lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
        observations: state?.lastObservations ?? null,
      }),
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

  router.get('/', async (req: Request, res: Response) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Sign in required.' });
    }

    res.json(await buildStatusPayload(req.auth.tenantId));
  });

  return router;
}
