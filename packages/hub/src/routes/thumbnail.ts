import { Router, Request, Response } from 'express';
import { Server as SocketServer } from 'socket.io';
import { getSessionFromRequest } from '../serverAuth';
import { getPlayer, resolveNodeAuthForToken } from '../store/registry';
import { updateThumbnailMeta } from '../store/state';
import { readThumbnailDataUrl, saveThumbnail } from '../store/thumbnails';

function bearerToken(req: Request): string | null {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

const lastThumbnailAt = new Map<string, number>();

export function createThumbnailRouter(io: SocketServer): Router {
  const router = Router();

  router.get('/:playerId', async (req: Request, res: Response) => {
    const playerId = req.params.playerId;
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ error: 'Sign in required.' });
    }

    const player = await getPlayer(playerId, session.tenantId);
    if (!player) {
      return res.status(404).json({ error: 'Thumbnail not found.' });
    }

    const dataUrl = await readThumbnailDataUrl(playerId);
    if (!dataUrl) {
      return res.status(404).json({ error: 'Thumbnail not found.' });
    }

    return res.json({
      playerId,
      dataUrl,
    });
  });

  router.post('/', async (req: Request, res: Response) => {
    const token = bearerToken(req);
    const nodeAuth = token ? await resolveNodeAuthForToken(token) : null;
    if (!nodeAuth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { nodeId, tenantId } = nodeAuth;

    const { instanceId, playerId, agentId, nodeId: reportedNodeId, dataUrl, capturedAt } = req.body as {
      instanceId?: string;
      playerId?: string;
      agentId?: string;
      nodeId?: string;
      dataUrl?: string;
      capturedAt?: string;
    };

    const resolvedPlayerId = playerId ?? instanceId;
    const claimedNodeId = reportedNodeId ?? agentId ?? nodeId;
    if (!resolvedPlayerId || !dataUrl) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    if (claimedNodeId !== nodeId) {
      return res.status(403).json({ error: 'Node ID does not match token' });
    }

    const player = await getPlayer(resolvedPlayerId, tenantId);
    if (!player || player.nodeId !== nodeId) {
      return res.status(403).json({ error: 'Player not allowed' });
    }

    const lastAt = lastThumbnailAt.get(resolvedPlayerId) ?? 0;
    if (Date.now() - lastAt < 8000) {
      return res.json({ ok: true, skipped: true });
    }
    lastThumbnailAt.set(resolvedPlayerId, Date.now());

    if (dataUrl.length > 75_000) {
      return res.status(413).json({ error: 'Thumbnail too large (max 50KB JPEG)' });
    }

    await saveThumbnail(resolvedPlayerId, dataUrl);
    await updateThumbnailMeta(resolvedPlayerId, capturedAt ?? new Date().toISOString());

    io.to(`tenant:${tenantId}`).emit('thumbnail_update', {
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
