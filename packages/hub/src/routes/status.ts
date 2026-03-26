import { Router, Request, Response } from 'express';
import { getAllStates } from '../store/state';
import { INSTANCES, SITES } from '../config/instances';

export function createStatusRouter(): Router {
  const router = Router();

  // Full status — used by dashboard on initial load
  router.get('/', (_req: Request, res: Response) => {
    const states = getAllStates();
    const stateMap = new Map(states.map((s) => [s.instanceId, s]));

    const sites = SITES.map((site) => ({
      id: site.id,
      name: site.name,
      instances: site.instances.map((inst) => {
        const state = stateMap.get(inst.id);
        return {
          id: inst.id,
          label: inst.label,
          siteId: inst.siteId,
          playoutType: inst.playoutType,
          udpProbeEnabled: inst.udpProbeEnabled,
          broadcastHealth: state?.broadcastHealth ?? 'unknown',
          runtimeHealth: state?.runtimeHealth ?? 'unknown',
          connectivityHealth: state?.connectivityHealth ?? 'offline',
          lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
          updatedAt: state?.updatedAt ?? null,
          hasThumbnail: !!state?.thumbnailData,
          thumbnailAt: state?.thumbnailAt ?? null,
        };
      }),
    }));

    res.json({ sites, timestamp: new Date().toISOString() });
  });

  return router;
}
