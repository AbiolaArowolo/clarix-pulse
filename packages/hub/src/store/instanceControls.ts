import { exec, query } from './db';

export interface InstanceControls {
  instanceId: string;
  monitoringEnabled: boolean;
  maintenanceMode: boolean;
  updatedAt: string;
}

const cache = new Map<string, InstanceControls>();

function nowIso(): string {
  return new Date().toISOString();
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return nowIso();
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function rowToControls(row: Record<string, unknown>): InstanceControls {
  return {
    instanceId: String(row.instance_id),
    monitoringEnabled: Boolean(row.monitoring_enabled),
    maintenanceMode: Boolean(row.maintenance_mode),
    updatedAt: toIso(row.updated_at as Date | string | null | undefined),
  };
}

export async function initInstanceControls(): Promise<void> {
  const rows = await query<Record<string, unknown>>(`
    SELECT instance_id, monitoring_enabled, maintenance_mode, updated_at
    FROM instance_controls
  `);

  cache.clear();
  for (const row of rows) {
    const controls = rowToControls(row);
    cache.set(controls.instanceId, controls);
  }
}

export function getInstanceControls(instanceId: string): InstanceControls {
  return cache.get(instanceId) ?? {
    instanceId,
    monitoringEnabled: true,
    maintenanceMode: false,
    updatedAt: nowIso(),
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
    updatedAt: nowIso(),
  };

  await exec(`
    INSERT INTO instance_controls (instance_id, monitoring_enabled, maintenance_mode, updated_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (instance_id) DO UPDATE SET
      monitoring_enabled = EXCLUDED.monitoring_enabled,
      maintenance_mode = EXCLUDED.maintenance_mode,
      updated_at = EXCLUDED.updated_at
  `, [instanceId, next.monitoringEnabled, next.maintenanceMode, next.updatedAt]);

  cache.set(instanceId, next);
  return next;
}

export function isAlertingSuppressed(instanceId: string): boolean {
  const controls = getInstanceControls(instanceId);
  return !controls.monitoringEnabled || controls.maintenanceMode;
}
