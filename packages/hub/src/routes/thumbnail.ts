import { Router, Request, Response } from 'express';
import { Server as SocketServer } from 'socket.io';
import { AGENT_INSTANCE_MAP } from '../config/instances';
import { updateThumbnail } from '../store/state';

function parseAgentTokens(): Map<string, string> {
  const tokenToNode = new Map<string, string>();
  const raw = process.env.AGENT_TOKENS ?? '';
  for (const pair of raw.split(',')) {
    const [nodeId, token] = pair.trim().split(':');
    if (nodeId && token) tokenToNode.set(token, nodeId);
  }
  return tokenToNode;
}

function validateToken(req: Request, tokenToNode: Map<string, string>): string | null {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return tokenToNode.get(auth.slice(7).trim()) ?? null;
}

const lastThumbnailAt = new Map<string, number>();

export function createThumbnailRouter(io: SocketServer): Router {
  const router = Router();
  const tokenToNode = parseAgentTokens();

  router.post('/', async (req: Request, res: Response) => {
    const nodeId = validateToken(req, tokenToNode);
    if (!nodeId) return res.status(401).json({ error: 'Unauthorized' });

    const { instanceId, playerId, agentId, nodeId: reportedNodeId, dataUrl, capturedAt } = req.body as {
      instanceId?: string;
      playerId?: string;
      agentId?: string;
      nodeId?: string;
      dataUrl: string;
      capturedAt?: string;
    };

    const resolvedPlayerId = playerId ?? instanceId;
    const claimedNodeId = reportedNodeId ?? agentId ?? nodeId;

    if (!resolvedPlayerId || !dataUrl) return res.status(400).json({ error: 'Missing fields' });
    if (claimedNodeId !== nodeId) return res.status(403).json({ error: 'Node ID does not match token' });

    const allowedPlayers = AGENT_INSTANCE_MAP.get(nodeId) ?? [];
    if (!allowedPlayers.includes(resolvedPlayerId)) {
      return res.status(403).json({ error: 'Player not allowed' });
    }

    const lastAt = lastThumbnailAt.get(resolvedPlayerId) ?? 0;
    if (Date.now() - lastAt < 8000) {
      return res.json({ ok: true, skipped: true });
    }
    lastThumbnailAt.set(resolvedPlayerId, Date.now());

    if (dataUrl.length > 75000) {
      return res.status(413).json({ error: 'Thumbnail too large (max 50KB JPEG)' });
    }

    await updateThumbnail(resolvedPlayerId, dataUrl);

    io.emit('thumbnail_update', {
      instanceId: resolvedPlayerId,
      playerId: resolvedPlayerId,
      nodeId,
      dataUrl,
      capturedAt: capturedAt ?? new Date().toISOString(),
    });

    return res.json({ ok: true });
  });

  return router;
}
