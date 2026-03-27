import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';

import { initState, getAllStates, setConnectivity, markInstanceOffline } from './store/state';
import { createHeartbeatRouter } from './routes/heartbeat';
import { createConfigRouter } from './routes/config';
import { createThumbnailRouter } from './routes/thumbnail';
import { createStatusRouter, buildStatusPayload } from './routes/status';
import { sendNetworkIssueAlert } from './services/alerting';
import { INSTANCE_MAP } from './config/instances';

const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

const PORT = Number(process.env.HUB_PORT ?? 3001);

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Routes
app.use('/api/heartbeat', createHeartbeatRouter(io));
app.use('/api/config', createConfigRouter());
app.use('/api/thumbnail', createThumbnailRouter(io));
app.use('/api/status', createStatusRouter());

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// WebSocket connection
io.on('connection', (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);
  // Send full current state on connect.
  socket.emit('full_state', buildStatusPayload());
  socket.on('disconnect', () => console.log(`[ws] client disconnected: ${socket.id}`));
});

// ─── Heartbeat timeout monitor ────────────────────────────────────────────────
// Runs every 5s, marks stale/offline instances and emits dashboard updates

const STALE_THRESHOLD_MS = 45_000;   // 45s → stale (orange)
const OFFLINE_THRESHOLD_MS = 90_000; // 90s → offline (gray)

const networkIssueSentAt = new Map<string, number>();

setInterval(async () => {
  const states = getAllStates();
  const now = Date.now();

  for (const state of states) {
    if (!state.lastHeartbeatAt) continue;

    const ageMs = now - new Date(state.lastHeartbeatAt).getTime();
    if (ageMs >= OFFLINE_THRESHOLD_MS && state.connectivityHealth !== 'offline') {
      const updated = await markInstanceOffline(state.instanceId).catch((err) => {
        console.error(err);
        return undefined;
      });
      io.emit('state_update', {
        instanceId: state.instanceId,
        broadcastHealth: 'unknown',
        runtimeHealth: updated?.runtimeHealth ?? 'unknown',
        connectivityHealth: 'offline',
        lastHeartbeatAt: state.lastHeartbeatAt,
        updatedAt: updated?.updatedAt ?? new Date().toISOString(),
      });

      // Send network issue alert (once per incident, debounced 5 min)
      const lastSent = networkIssueSentAt.get(state.instanceId) ?? 0;
      if (now - lastSent > 300_000) {
        networkIssueSentAt.set(state.instanceId, now);
        const inst = INSTANCE_MAP.get(state.instanceId);
        if (inst) sendNetworkIssueAlert(state.instanceId, inst.label).catch(console.error);
      }
    } else if (ageMs >= STALE_THRESHOLD_MS && state.connectivityHealth === 'online') {
      setConnectivity(state.instanceId, 'stale').catch(console.error);
      io.emit('state_update', {
        instanceId: state.instanceId,
        broadcastHealth: state.broadcastHealth,
        runtimeHealth: state.runtimeHealth,
        connectivityHealth: 'stale',
        lastHeartbeatAt: state.lastHeartbeatAt,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}, 5_000);

async function start() {
  await initState();

  httpServer.listen(PORT, () => {
    console.log(`[hub] Pulse hub running on port ${PORT}`);
    console.log(`[hub] SQLite state initialised for ${getAllStates().length} instances`);
  });
}

start().catch((err) => {
  console.error('[hub] startup failed', err);
  process.exitCode = 1;
});
