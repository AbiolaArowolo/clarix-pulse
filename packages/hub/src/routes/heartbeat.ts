import { Router, Request, Response } from 'express';
import { Server as SocketServer } from 'socket.io';
import { computeHealth, Observations } from '../services/stateEngine';
import { evaluateAlert } from '../services/alerting';
import { getInstanceControls } from '../store/instanceControls';
import { updateMirroredNodeConfig, MirroredNodeConfig } from '../store/nodeConfigMirror';
import { getPlayer, markPlayerSeen, resolveNodeAuthForToken, syncRegistryFromNodeMirror } from '../store/registry';
import { getState, updateState } from '../store/state';

function bearerToken(req: Request): string | null {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

function getUdpMonitoringEnabled(observations: Observations): boolean {
  return observations.output_signal_present !== undefined
    || (observations.udp_enabled ?? 0) === 1
    || (observations.udp_input_count ?? 0) > 0;
}

function asMirroredNodeConfig(value: unknown): MirroredNodeConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as MirroredNodeConfig;
}

export function createHeartbeatRouter(io: SocketServer): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    try {
      const token = bearerToken(req);
      const nodeAuth = token ? await resolveNodeAuthForToken(token) : null;
      if (!nodeAuth) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { nodeId, tenantId } = nodeAuth;

      const { instanceId, playerId, agentId, nodeId: reportedNodeId, observations, nodeConfigMirror } = req.body as {
        instanceId?: string;
        playerId?: string;
        agentId?: string;
        nodeId?: string;
        observations?: Observations;
        nodeConfigMirror?: unknown;
      };

      const resolvedPlayerId = playerId ?? instanceId;
      const claimedNodeId = reportedNodeId ?? agentId ?? nodeId;
      if (!resolvedPlayerId || !observations) {
        return res.status(400).json({ error: 'Missing playerId/instanceId or observations' });
      }

      if (claimedNodeId !== nodeId) {
        return res.status(403).json({ error: 'Node ID does not match token' });
      }

      let mirroredConfig: MirroredNodeConfig | null = null;
      if (nodeConfigMirror !== undefined) {
        mirroredConfig = await updateMirroredNodeConfig(tenantId, nodeId, nodeConfigMirror);
      } else {
        mirroredConfig = asMirroredNodeConfig(nodeConfigMirror);
      }

      let playerRecord = await getPlayer(resolvedPlayerId, tenantId);
      if ((!playerRecord || playerRecord.nodeId !== nodeId) && mirroredConfig) {
        await syncRegistryFromNodeMirror({
          tenantId,
          nodeId,
          nodeName: mirroredConfig.nodeName,
          siteId: mirroredConfig.siteId,
          players: mirroredConfig.players.map((player) => ({
            playerId: player.playerId,
            playoutType: player.playoutType,
            label: `${mirroredConfig!.nodeName} - ${player.playerId}`,
          })),
        });
        playerRecord = await getPlayer(resolvedPlayerId, tenantId);
      }

      if (!playerRecord) {
        return res.status(404).json({ error: 'Unknown player' });
      }

      if (playerRecord.nodeId !== nodeId) {
        return res.status(403).json({ error: 'Player not allowed for this node' });
      }

      const controls = getInstanceControls(resolvedPlayerId);
      const previousState = getState(resolvedPlayerId);
      const udpMonitoringEnabled = getUdpMonitoringEnabled(observations);
      const { broadcastHealth, runtimeHealth, connectivityHealth } = computeHealth(
        observations,
        udpMonitoringEnabled,
        {
          currentTime: new Date(),
          previousBroadcastHealth: previousState?.broadcastHealth,
          previousBroadcastStartedAt: previousState?.broadcastStartedAt ?? null,
          previousRuntimeHealth: previousState?.runtimeHealth,
          previousRuntimeStartedAt: previousState?.runtimeStartedAt ?? null,
        },
      );

      const { previous, current } = await updateState(
        resolvedPlayerId,
        nodeId,
        broadcastHealth,
        runtimeHealth,
        connectivityHealth,
        observations,
      );

      await markPlayerSeen(resolvedPlayerId, current.lastHeartbeatAt ?? new Date().toISOString());

      io.to(`tenant:${tenantId}`).emit('state_update', {
        instanceId: resolvedPlayerId,
        playerId: resolvedPlayerId,
        nodeId,
        commissioned: playerRecord.commissioned,
        udpMonitoringCapable: playerRecord.udpMonitoringCapable,
        broadcastHealth,
        runtimeHealth,
        connectivityHealth,
        monitoringMode: !controls.monitoringEnabled
          ? 'disabled'
          : controls.maintenanceMode
            ? 'maintenance'
            : udpMonitoringEnabled
              ? 'hybrid'
              : 'local',
        monitoringEnabled: controls.monitoringEnabled,
        maintenanceMode: controls.maintenanceMode,
        udpMonitoringEnabled,
        udpInputCount: Number(observations.udp_input_count ?? 0),
        udpHealthyInputCount: Number(observations.udp_healthy_input_count ?? 0),
        udpSelectedInputId: (observations.udp_selected_input_id as string | null | undefined) ?? null,
        lastHeartbeatAt: current.lastHeartbeatAt,
        updatedAt: current.updatedAt,
        observations,
      });

      evaluateAlert({
        instanceId: resolvedPlayerId,
        instanceLabel: playerRecord.label,
        siteName: playerRecord.siteName,
        nodeId,
        broadcastHealth,
        runtimeHealth,
        previousBroadcast: previous?.broadcastHealth,
        observations: observations as Record<string, unknown>,
      }).catch(console.error);

      return res.json({
        ok: true,
        nodeId,
        playerId: resolvedPlayerId,
        broadcastHealth,
        runtimeHealth,
        connectivityHealth,
      });
    } catch (err) {
      console.error('[heartbeat] unhandled error:', err);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      return;
    }
  });

  return router;
}
