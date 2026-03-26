import { Router, Request, Response } from 'express';
import { Server as SocketServer } from 'socket.io';
import { AGENT_INSTANCE_MAP, INSTANCE_MAP } from '../config/instances';
import { computeHealth, Observations } from '../services/stateEngine';
import { evaluateAlert } from '../services/alerting';
import { updateState, logEvent } from '../store/state';

// Parse AGENT_TOKENS env: "ny-main-pc:token1,ny-backup-pc:token2,..."
function parseAgentTokens(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.AGENT_TOKENS ?? '';
  for (const pair of raw.split(',')) {
    const [agentId, token] = pair.trim().split(':');
    if (agentId && token) map.set(token, agentId);
  }
  return map;
}

const TOKEN_TO_AGENT = parseAgentTokens();

function validateToken(req: Request): string | null {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  return TOKEN_TO_AGENT.get(token) ?? null;
}

export function createHeartbeatRouter(io: SocketServer): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const agentId = validateToken(req);
    if (!agentId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { instanceId, timestamp, observations } = req.body as {
      instanceId: string;
      timestamp: string;
      observations: Observations;
    };

    if (!instanceId || !observations) {
      return res.status(400).json({ error: 'Missing instanceId or observations' });
    }

    // Validate agent is allowed to report this instance
    const allowedInstances = AGENT_INSTANCE_MAP.get(agentId) ?? [];
    if (!allowedInstances.includes(instanceId)) {
      return res.status(403).json({ error: 'Instance not allowed for this agent' });
    }

    const instanceConfig = INSTANCE_MAP.get(instanceId);
    if (!instanceConfig) {
      return res.status(404).json({ error: 'Unknown instance' });
    }

    // Compute health state from raw observations
    const { broadcastHealth, runtimeHealth, connectivityHealth } = computeHealth(
      observations,
      instanceConfig.udpProbeEnabled
    );

    // Persist and get previous state
    const { previous, current } = updateState(
      instanceId, agentId, broadcastHealth, runtimeHealth, connectivityHealth, observations
    );

    // Broadcast to dashboard via Socket.io
    const payload = {
      instanceId,
      broadcastHealth,
      runtimeHealth,
      connectivityHealth,
      lastHeartbeatAt: current.lastHeartbeatAt,
      updatedAt: current.updatedAt,
      observations,
    };
    io.emit('state_update', payload);

    // Evaluate alerting (async — don't block response)
    evaluateAlert({
      instanceId,
      instanceLabel: instanceConfig.label,
      broadcastHealth,
      runtimeHealth,
      previousBroadcast: previous?.broadcastHealth,
      observations: observations as Record<string, unknown>,
    }).catch(console.error);

    return res.json({ ok: true, broadcastHealth, runtimeHealth, connectivityHealth });
  });

  return router;
}
