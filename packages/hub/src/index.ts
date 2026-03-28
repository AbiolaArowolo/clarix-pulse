import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { Server as SocketServer } from 'socket.io';
import { createConfigRouter } from './routes/config';
import { createHeartbeatRouter } from './routes/heartbeat';
import { buildStatusPayload, createStatusRouter } from './routes/status';
import { createThumbnailRouter } from './routes/thumbnail';
import { sendNetworkIssueAlert } from './services/alerting';
import { DATABASE_URL_DISPLAY, initDb } from './store/db';
import { getInstanceControls, initInstanceControls, isAlertingSuppressed } from './store/instanceControls';
import { getPlayer, initRegistry } from './store/registry';
import { getAllStates, initState, markInstanceOffline, setConnectivity } from './store/state';
import { getThumbnailStorePath } from './store/thumbnails';

const repoRoot = path.resolve(__dirname, '../../../..');
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

app.use('/api/heartbeat', createHeartbeatRouter(io));
app.use('/api/config', createConfigRouter());
app.use('/api/thumbnail', createThumbnailRouter(io));
app.use('/api/status', createStatusRouter());

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

io.on('connection', async (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);
  socket.emit('full_state', await buildStatusPayload());
  socket.on('disconnect', () => console.log(`[ws] client disconnected: ${socket.id}`));
});

const STALE_THRESHOLD_MS = 45_000;
const OFFLINE_THRESHOLD_MS = 90_000;

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
      const controls = getInstanceControls(state.instanceId);
      io.emit('state_update', {
        instanceId: state.instanceId,
        broadcastHealth: 'unknown',
        runtimeHealth: updated?.runtimeHealth ?? 'unknown',
        connectivityHealth: 'offline',
        monitoringEnabled: controls.monitoringEnabled,
        maintenanceMode: controls.maintenanceMode,
        lastHeartbeatAt: state.lastHeartbeatAt,
        updatedAt: updated?.updatedAt ?? new Date().toISOString(),
      });

      const lastSent = networkIssueSentAt.get(state.instanceId) ?? 0;
      if (now - lastSent > 300_000 && !isAlertingSuppressed(state.instanceId)) {
        networkIssueSentAt.set(state.instanceId, now);
        const player = await getPlayer(state.instanceId);
        if (player) {
          sendNetworkIssueAlert(state.instanceId, player.label).catch(console.error);
        }
      }
    } else if (ageMs >= STALE_THRESHOLD_MS && state.connectivityHealth === 'online') {
      setConnectivity(state.instanceId, 'stale').catch(console.error);
      const controls = getInstanceControls(state.instanceId);
      io.emit('state_update', {
        instanceId: state.instanceId,
        broadcastHealth: state.broadcastHealth,
        runtimeHealth: state.runtimeHealth,
        connectivityHealth: 'stale',
        monitoringEnabled: controls.monitoringEnabled,
        maintenanceMode: controls.maintenanceMode,
        lastHeartbeatAt: state.lastHeartbeatAt,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}, 5_000);

async function start() {
  await initDb();
  await initRegistry();
  await initState();
  await initInstanceControls();

  httpServer.listen(PORT, () => {
    console.log(`[hub] Pulse hub running on port ${PORT}`);
    console.log(`[hub] PostgreSQL state initialised for ${getAllStates().length} tracked instances`);
    console.log(`[hub] Database: ${DATABASE_URL_DISPLAY}`);
    console.log(`[hub] Thumbnail cache: ${getThumbnailStorePath()}`);
  });
}

start().catch((err) => {
  console.error('[hub] startup failed', err);
  process.exitCode = 1;
});
