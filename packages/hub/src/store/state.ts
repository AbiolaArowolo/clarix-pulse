// State store — SQLite via @libsql/client (async, WASM-based, no native deps)
// In-memory cache sits on top for fast Socket.io broadcasts.
// SQLite is the source of truth.

import { db, initDb, BroadcastHealth, RuntimeHealth, ConnectivityHealth, InstanceState } from './db';
import { INSTANCES } from '../config/instances';

// In-memory cache
const cache = new Map<string, InstanceState>();

const now = () => new Date().toISOString();

function rowToState(row: Record<string, unknown>): InstanceState {
  const updatedAt = row.updated_at as string;
  return {
    instanceId: row.instance_id as string,
    agentId: row.agent_id as string,
    broadcastHealth: row.broadcast_health as BroadcastHealth,
    runtimeHealth: row.runtime_health as RuntimeHealth,
    connectivityHealth: row.connectivity_health as ConnectivityHealth,
    lastHeartbeatAt: (row.last_heartbeat_at as string) ?? null,
    lastObservations: row.last_observations ? JSON.parse(row.last_observations as string) : null,
    thumbnailData: (row.thumbnail_data as string) ?? null,
    thumbnailAt: (row.thumbnail_at as string) ?? null,
    runtimeStartedAt: (row.runtime_started_at as string) ?? updatedAt,
    updatedAt,
  };
}

export async function initState(): Promise<void> {
  await initDb();

  // Seed rows for all known instances (if not already present)
  const result = await db.execute('SELECT instance_id FROM instance_state');
  const existingIds = new Set(result.rows.map((r) => r.instance_id as string));

  for (const inst of INSTANCES) {
    if (!existingIds.has(inst.id)) {
      const timestamp = now();
      await db.execute({
        sql: `INSERT OR IGNORE INTO instance_state
              (instance_id, agent_id, broadcast_health, runtime_health, connectivity_health,
               last_heartbeat_at, last_observations, runtime_started_at, updated_at)
              VALUES (?, '', 'unknown', 'unknown', 'offline', NULL, NULL, ?, ?)`,
        args: [inst.id, timestamp, timestamp],
      });
    }
  }

  // Load all into cache
  const rows = await db.execute('SELECT * FROM instance_state');
  for (const row of rows.rows) {
    const state = rowToState(row as Record<string, unknown>);
    cache.set(state.instanceId, state);
  }
}

export function getState(instanceId: string): InstanceState | undefined {
  return cache.get(instanceId);
}

export function getAllStates(): InstanceState[] {
  return Array.from(cache.values());
}

export async function updateState(
  instanceId: string,
  agentId: string,
  broadcastHealth: BroadcastHealth,
  runtimeHealth: RuntimeHealth,
  connectivityHealth: ConnectivityHealth,
  observations: Record<string, unknown>
): Promise<{ previous: InstanceState | undefined; current: InstanceState }> {
  const previous = cache.get(instanceId);
  const timestamp = now();
  const runtimeStartedAt = previous?.runtimeHealth === runtimeHealth
    ? previous.runtimeStartedAt
    : timestamp;

  await db.execute({
    sql: `INSERT INTO instance_state
            (instance_id, agent_id, broadcast_health, runtime_health, connectivity_health,
             last_heartbeat_at, last_observations, runtime_started_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(instance_id) DO UPDATE SET
            agent_id = excluded.agent_id,
            broadcast_health = excluded.broadcast_health,
            runtime_health = excluded.runtime_health,
            connectivity_health = excluded.connectivity_health,
            last_heartbeat_at = excluded.last_heartbeat_at,
            last_observations = excluded.last_observations,
            runtime_started_at = excluded.runtime_started_at,
            updated_at = excluded.updated_at`,
    args: [
      instanceId, agentId, broadcastHealth, runtimeHealth, connectivityHealth,
      timestamp, JSON.stringify(observations), runtimeStartedAt, timestamp,
    ],
  });

  const current: InstanceState = {
    instanceId, agentId, broadcastHealth, runtimeHealth, connectivityHealth,
    lastHeartbeatAt: timestamp, lastObservations: observations,
    thumbnailData: previous?.thumbnailData ?? null,
    thumbnailAt: previous?.thumbnailAt ?? null,
    runtimeStartedAt,
    updatedAt: timestamp,
  };

  cache.set(instanceId, current);
  return { previous, current };
}

export async function updateThumbnail(instanceId: string, dataUrl: string): Promise<void> {
  const timestamp = now();
  await db.execute({
    sql: `UPDATE instance_state SET thumbnail_data = ?, thumbnail_at = ?, updated_at = ? WHERE instance_id = ?`,
    args: [dataUrl, timestamp, timestamp, instanceId],
  });
  const existing = cache.get(instanceId);
  if (existing) {
    existing.thumbnailData = dataUrl;
    existing.thumbnailAt = timestamp;
    existing.updatedAt = timestamp;
  }
}

export async function setConnectivity(instanceId: string, connectivity: ConnectivityHealth): Promise<void> {
  const timestamp = now();
  await db.execute({
    sql: `UPDATE instance_state SET connectivity_health = ?, updated_at = ? WHERE instance_id = ?`,
    args: [connectivity, timestamp, instanceId],
  });
  const existing = cache.get(instanceId);
  if (existing) {
    existing.connectivityHealth = connectivity;
    existing.updatedAt = timestamp;
  }
}

export async function markInstanceOffline(instanceId: string): Promise<InstanceState | undefined> {
  const timestamp = now();
  await db.execute({
    sql: `UPDATE instance_state
          SET broadcast_health = 'unknown', connectivity_health = 'offline', updated_at = ?
          WHERE instance_id = ?`,
    args: [timestamp, instanceId],
  });

  const existing = cache.get(instanceId);
  if (existing) {
    existing.broadcastHealth = 'unknown';
    existing.connectivityHealth = 'offline';
    existing.updatedAt = timestamp;
  }

  return existing;
}

export async function logEvent(
  instanceId: string,
  eventType: string,
  fromState: object | null,
  toState: object | null,
  observations: object | null,
  alertSent: boolean
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO events (instance_id, event_type, from_state, to_state, observations, alert_sent, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      instanceId, eventType,
      fromState ? JSON.stringify(fromState) : null,
      toState ? JSON.stringify(toState) : null,
      observations ? JSON.stringify(observations) : null,
      alertSent ? 1 : 0,
      now(),
    ],
  });
}

export async function wasAlertSentForCurrentIncident(instanceId: string, broadcastHealth: string): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT alert_sent, to_state FROM events
          WHERE instance_id = ? AND event_type = 'state_change'
          ORDER BY created_at DESC LIMIT 1`,
    args: [instanceId],
  });
  if (result.rows.length === 0) return false;
  const row = result.rows[0];
  try {
    const toState = JSON.parse(row.to_state as string);
    return toState.broadcastHealth === broadcastHealth && row.alert_sent === 1;
  } catch {
    return false;
  }
}
