import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';

import { initState, getAllStates, setConnectivity } from './store/state';
import { createHeartbeatRouter } from './routes/heartbeat';
import { createThumbnailRouter } from './routes/thumbnail';
import { createStatusRouter } from './routes/status';
import { sendNetworkIssueAlert } from './services/alerting';
import { INSTANCE_MAP } from './config/instances';

const PORT = Number(process.env.HUB_PORT ?? 3001);

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Initialise SQLite state on startup
initState();

// Routes
app.use('/api/heartbeat', createHeartbeatRouter(io));
app.use('/api/thumbnail', createThumbnailRouter(io));
app.use('/api/status', createStatusRouter());

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// WebSocket connection
io.on('connection', (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);
  // Send full current state on connect
  socket.emit('full_state', getAllStates());
  socket.on('disconnect', () => console.log(`[ws] client disconnected: ${socket.id}`));
});

// ─── Heartbeat timeout monitor ────────────────────────────────────────────────
// Runs every 5s, marks stale/offline instances and emits dashboard updates

const STALE_THRESHOLD_MS = 45_000;   // 45s → stale (orange)
const OFFLINE_THRESHOLD_MS = 90_000; // 90s → offline (gray)

const networkIssueSentAt = new Map<string, number>();

setInterval(() => {
  const states = getAllStates();
  const now = Date.now();

  for (const state of states) {
    if (!state.lastHeartbeatAt) continue;

    const ageMs = now - new Date(state.lastHeartbeatAt).getTime();
    let newConnectivity = state.connectivityHealth;

    if (ageMs >= OFFLINE_THRESHOLD_MS && state.connectivityHealth !== 'offline') {
      newConnectivity = 'offline';
      setConnectivity(state.instanceId, 'offline');
      io.emit('state_update', {
        instanceId: state.instanceId,
        broadcastHealth: 'unknown',
        runtimeHealth: state.runtimeHealth,
        connectivityHealth: 'offline',
        lastHeartbeatAt: state.lastHeartbeatAt,
        updatedAt: new Date().toISOString(),
      });

      // Send network issue alert (once per incident, debounced 5 min)
      const lastSent = networkIssueSentAt.get(state.instanceId) ?? 0;
      if (now - lastSent > 300_000) {
        networkIssueSentAt.set(state.instanceId, now);
        const inst = INSTANCE_MAP.get(state.instanceId);
        if (inst) sendNetworkIssueAlert(state.instanceId, inst.label).catch(console.error);
      }
    } else if (ageMs >= STALE_THRESHOLD_MS && state.connectivityHealth === 'online') {
      newConnectivity = 'stale';
      setConnectivity(state.instanceId, 'stale');
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

httpServer.listen(PORT, () => {
  console.log(`[hub] Clarix Pulse hub running on port ${PORT}`);
  console.log(`[hub] SQLite state initialised for ${getAllStates().length} instances`);
});
