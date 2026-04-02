import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { Server as SocketServer } from 'socket.io';
import { readBuildInfo } from './buildInfo';
import { createAdminRouter } from './routes/admin';
import { createAuthRouter } from './routes/auth';
import { createConfigRouter } from './routes/config';
import { createDownloadsRouter } from './routes/downloads';
import { createHeartbeatRouter } from './routes/heartbeat';
import { createPushRouter } from './routes/push';
import { buildStatusPayload, createStatusRouter } from './routes/status';
import { createThumbnailRouter } from './routes/thumbnail';
import { SESSION_COOKIE_NAME, readCookie, requirePlatformAdmin, requireSession } from './serverAuth';
import { getAlertDeliveryHealth, sendNetworkIssueAlert } from './services/alerting';
import { getSessionFromToken } from './store/auth';
import { checkDbHealth, DATABASE_URL_DISPLAY, initDb } from './store/db';
import { getInstanceControls, initInstanceControls, isAlertingSuppressed } from './store/instanceControls';
import { getPlayer, initRegistry } from './store/registry';
import { getAllStates, initState, markInstanceOffline, setConnectivity } from './store/state';
import { checkThumbnailStoreHealth, getThumbnailStorePath } from './store/thumbnails';

const repoRoot = path.resolve(__dirname, '../../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

const PORT = Number(process.env.HUB_PORT ?? 3001);

const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '256kb' }));

const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

app.use('/api/auth', createAuthRouter());
app.use('/api/heartbeat', createHeartbeatRouter(io));
app.use('/api/agent/heartbeat', createHeartbeatRouter(io));
app.use('/api/config', createConfigRouter());
app.use('/api/downloads', createDownloadsRouter());
app.use('/api/thumbnail', createThumbnailRouter(io));
app.use('/api/status', requireSession, createStatusRouter());
app.use('/api/admin', requirePlatformAdmin, createAdminRouter());
app.use('/api/push', createPushRouter());

const processStartedAt = Date.now();

app.get('/api/health', async (_req, res) => {
  const [db, thumbnailStore] = await Promise.all([
    checkDbHealth(),
    checkThumbnailStoreHealth(),
  ]);
  const ok = db.ok && thumbnailStore.ok;

  return res.status(ok ? 200 : 503).json({
    ok,
    ts: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
    trackedInstances: getAllStates().length,
    memory: {
      rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
    },
    components: {
      database: db,
      thumbnailStore,
      alerting: getAlertDeliveryHealth(),
    },
    build: readBuildInfo(),
  });
});
app.get('/api/version', (_req, res) => res.json(readBuildInfo()));

io.use(async (socket, next) => {
  const sessionToken = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME);
  if (!sessionToken) {
    next(new Error('Unauthorized'));
    return;
  }

  const session = await getSessionFromToken(sessionToken);
  if (!session) {
    next(new Error('Unauthorized'));
    return;
  }

  socket.data.session = session;
  next();
});

io.on('connection', async (socket) => {
  const session = socket.data.session as Awaited<ReturnType<typeof getSessionFromToken>>;
  if (!session) {
    socket.disconnect(true);
    return;
  }

  const room = `tenant:${session.tenantId}`;
  socket.join(room);
  console.log(`[ws] client connected: ${socket.id} tenant=${session.tenantSlug}`);
  socket.emit('full_state', await buildStatusPayload(session.tenantId));
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
      const player = await getPlayer(state.instanceId);
      if (player) {
        io.to(`tenant:${player.tenantId}`).emit('state_update', {
          instanceId: state.instanceId,
          broadcastHealth: 'unknown',
          runtimeHealth: updated?.runtimeHealth ?? 'unknown',
          connectivityHealth: 'offline',
          monitoringEnabled: controls.monitoringEnabled,
          maintenanceMode: controls.maintenanceMode,
          lastHeartbeatAt: state.lastHeartbeatAt,
          updatedAt: updated?.updatedAt ?? new Date().toISOString(),
        });
      }

      const lastSent = networkIssueSentAt.get(state.instanceId) ?? 0;
      if (now - lastSent > 300_000 && !isAlertingSuppressed(state.instanceId)) {
        networkIssueSentAt.set(state.instanceId, now);
        if (player) {
          sendNetworkIssueAlert(state.instanceId, player.label).catch(console.error);
        }
      }
    } else if (ageMs >= STALE_THRESHOLD_MS && state.connectivityHealth === 'online') {
      setConnectivity(state.instanceId, 'stale').catch(console.error);
      const controls = getInstanceControls(state.instanceId);
      const player = await getPlayer(state.instanceId);
      if (player) {
        io.to(`tenant:${player.tenantId}`).emit('state_update', {
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
