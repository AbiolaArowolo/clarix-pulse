// In-memory cache layer on top of SQLite — fast reads for Socket.io broadcasts
// SQLite is the source of truth. Cache is rebuilt from DB on hub start.

import { db, BroadcastHealth, RuntimeHealth, ConnectivityHealth, InstanceState } from './db';
import { INSTANCES } from '../config/instances';

// In-memory cache
const cache = new Map<string, InstanceState>();

const now = () => new Date().toISOString();

// Seed initial state for all known instances on startup
export function initState(): void {
  const existingIds = new Set(
    (db.prepare('SELECT instance_id FROM instance_state').all() as { instance_id: string }[]).map(
      (r) => r.instance_id
    )
  );

  const insert = db.prepare(`
    INSERT OR IGNORE INTO instance_state
      (instance_id, agent_id, broadcast_health, runtime_health, connectivity_health,
       last_heartbeat_at, last_observations, updated_at)
    VALUES (?, ?, 'unknown', 'unknown', 'offline', NULL, NULL, ?)
  `);

  for (const inst of INSTANCES) {
    if (!existingIds.has(inst.id)) {
      insert.run(inst.id, '', now());
    }
  }

  // Load all into cache
  const rows = db.prepare('SELECT * FROM instance_state').all() as any[];
  for (const row of rows) {
    cache.set(row.instance_id, rowToState(row));
  }
}

function rowToState(row: any): InstanceState {
  return {
    instanceId: row.instance_id,
    agentId: row.agent_id,
    broadcastHealth: row.broadcast_health as BroadcastHealth,
    runtimeHealth: row.runtime_health as RuntimeHealth,
    connectivityHealth: row.connectivity_health as ConnectivityHealth,
    lastHeartbeatAt: row.last_heartbeat_at,
    lastObservations: row.last_observations ? JSON.parse(row.last_observations) : null,
    thumbnailData: row.thumbnail_data,
    thumbnailAt: row.thumbnail_at,
    updatedAt: row.updated_at,
  };
}

export function getState(instanceId: string): InstanceState | undefined {
  return cache.get(instanceId);
}

export function getAllStates(): InstanceState[] {
  return Array.from(cache.values());
}

export function updateState(
  instanceId: string,
  agentId: string,
  broadcastHealth: BroadcastHealth,
  runtimeHealth: RuntimeHealth,
  connectivityHealth: ConnectivityHealth,
  observations: Record<string, unknown>
): { previous: InstanceState | undefined; current: InstanceState } {
  const previous = cache.get(instanceId);
  const timestamp = now();

  db.prepare(`
    INSERT INTO instance_state
      (instance_id, agent_id, broadcast_health, runtime_health, connectivity_health,
       last_heartbeat_at, last_observations, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET
      agent_id = excluded.agent_id,
      broadcast_health = excluded.broadcast_health,
      runtime_health = excluded.runtime_health,
      connectivity_health = excluded.connectivity_health,
      last_heartbeat_at = excluded.last_heartbeat_at,
      last_observations = excluded.last_observations,
      updated_at = excluded.updated_at
  `).run(
    instanceId, agentId, broadcastHealth, runtimeHealth, connectivityHealth,
    timestamp, JSON.stringify(observations), timestamp
  );

  const current: InstanceState = {
    instanceId, agentId, broadcastHealth, runtimeHealth, connectivityHealth,
    lastHeartbeatAt: timestamp, lastObservations: observations,
    thumbnailData: previous?.thumbnailData ?? null,
    thumbnailAt: previous?.thumbnailAt ?? null,
    updatedAt: timestamp,
  };

  cache.set(instanceId, current);
  return { previous, current };
}

export function updateThumbnail(instanceId: string, data: Buffer): void {
  const timestamp = now();
  db.prepare(`
    UPDATE instance_state SET thumbnail_data = ?, thumbnail_at = ?, updated_at = ?
    WHERE instance_id = ?
  `).run(data, timestamp, timestamp, instanceId);

  const existing = cache.get(instanceId);
  if (existing) {
    existing.thumbnailData = data;
    existing.thumbnailAt = timestamp;
    existing.updatedAt = timestamp;
  }
}

export function setConnectivity(instanceId: string, connectivity: ConnectivityHealth): void {
  const timestamp = now();
  db.prepare(`
    UPDATE instance_state SET connectivity_health = ?, updated_at = ? WHERE instance_id = ?
  `).run(connectivity, timestamp, instanceId);

  const existing = cache.get(instanceId);
  if (existing) {
    existing.connectivityHealth = connectivity;
    existing.updatedAt = timestamp;
  }
}

export function logEvent(
  instanceId: string,
  eventType: string,
  fromState: object | null,
  toState: object | null,
  observations: object | null,
  alertSent: boolean
): void {
  db.prepare(`
    INSERT INTO events (instance_id, event_type, from_state, to_state, observations, alert_sent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    instanceId, eventType,
    fromState ? JSON.stringify(fromState) : null,
    toState ? JSON.stringify(toState) : null,
    observations ? JSON.stringify(observations) : null,
    alertSent ? 1 : 0,
    now()
  );
}

// Check if an alert has already been sent for the current incident
// (incident = continuous run of the same critical state without recovery)
export function wasAlertSentForCurrentIncident(instanceId: string, state: string): boolean {
  const row = db.prepare(`
    SELECT alert_sent, to_state FROM events
    WHERE instance_id = ? AND event_type = 'state_change'
    ORDER BY created_at DESC LIMIT 1
  `).get(instanceId) as { alert_sent: number; to_state: string } | undefined;

  if (!row) return false;
  try {
    const toState = JSON.parse(row.to_state);
    const isSameState =
      toState.broadcastHealth === JSON.parse(state).broadcastHealth;
    return isSameState && row.alert_sent === 1;
  } catch {
    return false;
  }
}
