import { Router, Request, Response } from 'express';
import { Server as SocketServer } from 'socket.io';
import { AGENT_INSTANCE_MAP } from '../config/instances';
import { updateThumbnail } from '../store/state';

const TOKEN_TO_AGENT = new Map<string, string>();

function parseAgentTokens(): void {
  const raw = process.env.AGENT_TOKENS ?? '';
  for (const pair of raw.split(',')) {
    const [agentId, token] = pair.trim().split(':');
    if (agentId && token) TOKEN_TO_AGENT.set(token, agentId);
  }
}
parseAgentTokens();

function validateToken(req: Request): string | null {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return TOKEN_TO_AGENT.get(auth.slice(7).trim()) ?? null;
}

// Rate limiter: max 1 thumbnail per instance per 8 seconds
const lastThumbnailAt = new Map<string, number>();

export function createThumbnailRouter(io: SocketServer): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const agentId = validateToken(req);
    if (!agentId) return res.status(401).json({ error: 'Unauthorized' });

    const { instanceId, dataUrl, capturedAt } = req.body as {
      instanceId: string;
      dataUrl: string;   // base64 data URL: "data:image/jpeg;base64,..."
      capturedAt: string;
    };

    if (!instanceId || !dataUrl) return res.status(400).json({ error: 'Missing fields' });

    const allowedInstances = AGENT_INSTANCE_MAP.get(agentId) ?? [];
    if (!allowedInstances.includes(instanceId)) {
      return res.status(403).json({ error: 'Instance not allowed' });
    }

    // Rate limit: skip if last thumbnail was less than 8s ago
    const lastAt = lastThumbnailAt.get(instanceId) ?? 0;
    if (Date.now() - lastAt < 8000) {
      return res.json({ ok: true, skipped: true });
    }
    lastThumbnailAt.set(instanceId, Date.now());

    // Validate size (~50KB max base64 = ~68KB string)
    if (dataUrl.length > 75000) {
      return res.status(413).json({ error: 'Thumbnail too large (max 50KB JPEG)' });
    }

    await updateThumbnail(instanceId, dataUrl);

    // Push to dashboard
    io.emit('thumbnail_update', { instanceId, dataUrl, capturedAt: capturedAt ?? new Date().toISOString() });

    return res.json({ ok: true });
  });

  return router;
}
