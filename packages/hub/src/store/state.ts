import {
  BroadcastHealth,
  ConnectivityHealth,
  InstanceState,
  RuntimeHealth,
  exec,
  query,
  queryOne,
} from './db';

const cache = new Map<string, InstanceState>();

function nowIso(): string {
  return new Date().toISOString();
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function asObservationMap(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rowToState(row: Record<string, unknown>): InstanceState {
  return {
    instanceId: String(row.instance_id),
    agentId: String(row.agent_id ?? ''),
    broadcastHealth: row.broadcast_health as BroadcastHealth,
    runtimeHealth: row.runtime_health as RuntimeHealth,
    connectivityHealth: row.connectivity_health as ConnectivityHealth,
    lastHeartbeatAt: toIso(row.last_heartbeat_at as Date | string | null | undefined),
    lastObservations: asObservationMap(row.last_observations),
    thumbnailAt: toIso(row.thumbnail_at as Date | string | null | undefined),
    broadcastStartedAt: toIso(row.broadcast_started_at as Date | string | null | undefined) ?? nowIso(),
    runtimeStartedAt: toIso(row.runtime_started_at as Date | string | null | undefined) ?? nowIso(),
    updatedAt: toIso(row.updated_at as Date | string | null | undefined) ?? nowIso(),
  };
}

export async function initState(): Promise<void> {
  const rows = await query<Record<string, unknown>>(`
    SELECT
      instance_id,
      agent_id,
      broadcast_health,
      runtime_health,
      connectivity_health,
      last_heartbeat_at,
      last_observations,
      thumbnail_at,
      broadcast_started_at,
      runtime_started_at,
      updated_at
    FROM instance_state
  `);

  cache.clear();
  for (const row of rows) {
    const state = rowToState(row);
    cache.set(state.instanceId, state);
  }
}

export function getState(instanceId: string): InstanceState | undefined {
  return cache.get(instanceId);
}

export function getAllStates(): InstanceState[] {
  return Array.from(cache.values());
}

export function clearStateCacheForInstances(instanceIds: readonly string[]): void {
  for (const instanceId of instanceIds) {
    cache.delete(instanceId);
  }
}

export async function updateState(
  instanceId: string,
  agentId: string,
  broadcastHealth: BroadcastHealth,
  runtimeHealth: RuntimeHealth,
  connectivityHealth: ConnectivityHealth,
  observations: Record<string, unknown>,
): Promise<{ previous: InstanceState | undefined; current: InstanceState }> {
  const previous = cache.get(instanceId);
  const timestamp = nowIso();
  const broadcastStartedAt = previous?.broadcastHealth === broadcastHealth
    ? previous.broadcastStartedAt
    : timestamp;
  const runtimeStartedAt = previous?.runtimeHealth === runtimeHealth
    ? previous.runtimeStartedAt
    : timestamp;

  await exec(`
    INSERT INTO instance_state (
      instance_id,
      agent_id,
      broadcast_health,
      runtime_health,
      connectivity_health,
      last_heartbeat_at,
      last_observations,
      broadcast_started_at,
      runtime_started_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
    ON CONFLICT (instance_id) DO UPDATE SET
      agent_id = EXCLUDED.agent_id,
      broadcast_health = EXCLUDED.broadcast_health,
      runtime_health = EXCLUDED.runtime_health,
      connectivity_health = EXCLUDED.connectivity_health,
      last_heartbeat_at = EXCLUDED.last_heartbeat_at,
      last_observations = EXCLUDED.last_observations,
      broadcast_started_at = EXCLUDED.broadcast_started_at,
      runtime_started_at = EXCLUDED.runtime_started_at,
      updated_at = EXCLUDED.updated_at
  `, [
    instanceId,
    agentId,
    broadcastHealth,
    runtimeHealth,
    connectivityHealth,
    timestamp,
    JSON.stringify(observations),
    broadcastStartedAt,
    runtimeStartedAt,
    timestamp,
  ]);

  const current: InstanceState = {
    instanceId,
    agentId,
    broadcastHealth,
    runtimeHealth,
    connectivityHealth,
    lastHeartbeatAt: timestamp,
    lastObservations: observations,
    thumbnailAt: previous?.thumbnailAt ?? null,
    broadcastStartedAt,
    runtimeStartedAt,
    updatedAt: timestamp,
  };

  cache.set(instanceId, current);
  return { previous, current };
}

export async function updateThumbnailMeta(instanceId: string, capturedAt = nowIso()): Promise<void> {
  await exec(`
    INSERT INTO instance_state (
      instance_id,
      agent_id,
      broadcast_health,
      runtime_health,
      connectivity_health,
      thumbnail_at,
      broadcast_started_at,
      runtime_started_at,
      updated_at
    )
    VALUES ($1, '', 'unknown', 'unknown', 'offline', $2, $2, $2, $2)
    ON CONFLICT (instance_id) DO UPDATE SET
      thumbnail_at = EXCLUDED.thumbnail_at,
      updated_at = EXCLUDED.updated_at
  `, [instanceId, capturedAt]);

  const existing = cache.get(instanceId);
  if (existing) {
    existing.thumbnailAt = capturedAt;
    existing.updatedAt = capturedAt;
  } else {
    cache.set(instanceId, {
      instanceId,
      agentId: '',
      broadcastHealth: 'unknown',
      runtimeHealth: 'unknown',
      connectivityHealth: 'offline',
      lastHeartbeatAt: null,
      lastObservations: null,
      thumbnailAt: capturedAt,
      broadcastStartedAt: capturedAt,
      runtimeStartedAt: capturedAt,
      updatedAt: capturedAt,
    });
  }
}

export async function setConnectivity(instanceId: string, connectivity: ConnectivityHealth): Promise<void> {
  const timestamp = nowIso();
  await exec(`
    UPDATE instance_state
    SET connectivity_health = $2, updated_at = $3
    WHERE instance_id = $1
  `, [instanceId, connectivity, timestamp]);

  const existing = cache.get(instanceId);
  if (existing) {
    existing.connectivityHealth = connectivity;
    existing.updatedAt = timestamp;
  }
}

export async function markInstanceOffline(instanceId: string): Promise<InstanceState | undefined> {
  const timestamp = nowIso();
  const existing = cache.get(instanceId);
  if (!existing) {
    return undefined;
  }

  const broadcastStartedAt = existing.broadcastHealth === 'unknown'
    ? existing.broadcastStartedAt
    : timestamp;
  const runtimeStartedAt = existing.runtimeHealth === 'unknown'
    ? existing.runtimeStartedAt
    : timestamp;

  await exec(`
    UPDATE instance_state
    SET
      broadcast_health = 'unknown',
      runtime_health = 'unknown',
      connectivity_health = 'offline',
      broadcast_started_at = $2,
      runtime_started_at = $3,
      updated_at = $4
    WHERE instance_id = $1
  `, [instanceId, broadcastStartedAt, runtimeStartedAt, timestamp]);

  existing.broadcastHealth = 'unknown';
  existing.runtimeHealth = 'unknown';
  existing.connectivityHealth = 'offline';
  existing.broadcastStartedAt = broadcastStartedAt;
  existing.runtimeStartedAt = runtimeStartedAt;
  existing.updatedAt = timestamp;
  return existing;
}

export async function logEvent(
  instanceId: string,
  eventType: string,
  fromState: object | null,
  toState: object | null,
  observations: object | null,
  alertSent: boolean,
): Promise<void> {
  await exec(`
    INSERT INTO events (instance_id, event_type, from_state, to_state, observations, alert_sent, created_at)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)
  `, [
    instanceId,
    eventType,
    fromState ? JSON.stringify(fromState) : null,
    toState ? JSON.stringify(toState) : null,
    observations ? JSON.stringify(observations) : null,
    alertSent,
    nowIso(),
  ]);
}

export async function wasAlertSentForCurrentIncident(instanceId: string, broadcastHealth: string): Promise<boolean> {
  const row = await queryOne<Record<string, unknown>>(`
    SELECT alert_sent, to_state
    FROM events
    WHERE instance_id = $1 AND event_type = 'state_change'
    ORDER BY created_at DESC
    LIMIT 1
  `, [instanceId]);

  if (!row) {
    return false;
  }

  const toState = asObservationMap(row.to_state);
  return Boolean(row.alert_sent) && toState?.broadcastHealth === broadcastHealth;
}

export async function getPersistedState(instanceId: string): Promise<InstanceState | null> {
  const row = await queryOne<Record<string, unknown>>(`
    SELECT
      instance_id,
      agent_id,
      broadcast_health,
      runtime_health,
      connectivity_health,
      last_heartbeat_at,
      last_observations,
      thumbnail_at,
      broadcast_started_at,
      runtime_started_at,
      updated_at
    FROM instance_state
    WHERE instance_id = $1
  `, [instanceId]);

  return row ? rowToState(row) : null;
}
