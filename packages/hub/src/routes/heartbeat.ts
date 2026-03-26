import { Router, Request, Response } from 'express';
import { Server as SocketServer } from 'socket.io';
import { AGENT_INSTANCE_MAP, INSTANCE_MAP } from '../config/instances';
import { computeHealth, Observations } from '../services/stateEngine';
import { evaluateAlert } from '../services/alerting';
import { getState, updateState } from '../store/state';

function parseAgentTokens(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.AGENT_TOKENS ?? '';
  for (const pair of raw.split(',')) {
    const [nodeId, token] = pair.trim().split(':');
    if (nodeId && token) map.set(token, nodeId);
  }
  return map;
}

function validateToken(req: Request, tokenToNode: Map<string, string>): string | null {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  return tokenToNode.get(token) ?? null;
}

function getUdpMonitoringEnabled(observations: Observations): boolean {
  return observations.output_signal_present !== undefined
    || (observations.udp_enabled ?? 0) === 1
    || (observations.udp_input_count ?? 0) > 0;
}

export function createHeartbeatRouter(io: SocketServer): Router {
  const router = Router();
  const tokenToNode = parseAgentTokens();

  router.post('/', async (req: Request, res: Response) => {
    const nodeId = validateToken(req, tokenToNode);
    if (!nodeId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { instanceId, playerId, agentId, nodeId: reportedNodeId, observations } = req.body as {
      instanceId?: string;
      playerId?: string;
      agentId?: string;
      nodeId?: string;
      observations: Observations;
    };

    const resolvedPlayerId = playerId ?? instanceId;
    const claimedNodeId = reportedNodeId ?? agentId ?? nodeId;

    if (!resolvedPlayerId || !observations) {
      return res.status(400).json({ error: 'Missing playerId/instanceId or observations' });
    }

    if (claimedNodeId !== nodeId) {
      return res.status(403).json({ error: 'Node ID does not match token' });
    }

    const allowedPlayers = AGENT_INSTANCE_MAP.get(nodeId) ?? [];
    if (!allowedPlayers.includes(resolvedPlayerId)) {
      return res.status(403).json({ error: 'Player not allowed for this node' });
    }

    const instanceConfig = INSTANCE_MAP.get(resolvedPlayerId);
    if (!instanceConfig) {
      return res.status(404).json({ error: 'Unknown player' });
    }

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
      }
    );

    const { previous, current } = await updateState(
      resolvedPlayerId,
      nodeId,
      broadcastHealth,
      runtimeHealth,
      connectivityHealth,
      observations
    );

    io.emit('state_update', {
      instanceId: resolvedPlayerId,
      playerId: resolvedPlayerId,
      nodeId,
      broadcastHealth,
      runtimeHealth,
      connectivityHealth,
      monitoringMode: udpMonitoringEnabled ? 'hybrid' : 'local',
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
      instanceLabel: instanceConfig.label,
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
  });

  return router;
}
