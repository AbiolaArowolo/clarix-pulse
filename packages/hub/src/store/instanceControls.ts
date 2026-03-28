import { INSTANCES } from '../config/instances';
import { db } from './db';

export interface InstanceControls {
  instanceId: string;
  monitoringEnabled: boolean;
  maintenanceMode: boolean;
  updatedAt: string;
}

const cache = new Map<string, InstanceControls>();

const now = () => new Date().toISOString();

function rowToControls(row: Record<string, unknown>): InstanceControls {
  return {
    instanceId: row.instance_id as string,
    monitoringEnabled: Number(row.monitoring_enabled ?? 1) !== 0,
    maintenanceMode: Number(row.maintenance_mode ?? 0) !== 0,
    updatedAt: row.updated_at as string,
  };
}

export async function initInstanceControls(): Promise<void> {
  const timestamp = now();

  for (const instance of INSTANCES) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO instance_controls
              (instance_id, monitoring_enabled, maintenance_mode, updated_at)
            VALUES (?, 1, 0, ?)`,
      args: [instance.id, timestamp],
    });
  }

  const result = await db.execute('SELECT * FROM instance_controls');
  cache.clear();
  for (const row of result.rows) {
    const controls = rowToControls(row as Record<string, unknown>);
    cache.set(controls.instanceId, controls);
  }
}

export function getInstanceControls(instanceId: string): InstanceControls {
  return cache.get(instanceId) ?? {
    instanceId,
    monitoringEnabled: true,
    maintenanceMode: false,
    updatedAt: now(),
  };
}

export async function updateInstanceControls(
  instanceId: string,
  patch: {
    monitoringEnabled?: boolean;
    maintenanceMode?: boolean;
  },
): Promise<InstanceControls> {
  const current = getInstanceControls(instanceId);
  const next: InstanceControls = {
    instanceId,
    monitoringEnabled: patch.monitoringEnabled ?? current.monitoringEnabled,
    maintenanceMode: patch.maintenanceMode ?? current.maintenanceMode,
    updatedAt: now(),
  };

  await db.execute({
    sql: `INSERT INTO instance_controls
            (instance_id, monitoring_enabled, maintenance_mode, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(instance_id) DO UPDATE SET
            monitoring_enabled = excluded.monitoring_enabled,
            maintenance_mode = excluded.maintenance_mode,
            updated_at = excluded.updated_at`,
    args: [
      instanceId,
      next.monitoringEnabled ? 1 : 0,
      next.maintenanceMode ? 1 : 0,
      next.updatedAt,
    ],
  });

  cache.set(instanceId, next);
  return next;
}

export function isAlertingSuppressed(instanceId: string): boolean {
  const controls = getInstanceControls(instanceId);
  return !controls.monitoringEnabled || controls.maintenanceMode;
}
