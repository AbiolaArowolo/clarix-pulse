export type BroadcastHealth = 'healthy' | 'degraded' | 'off_air_likely' | 'off_air_confirmed' | 'unknown';
export type RuntimeHealth = 'healthy' | 'paused' | 'restarting' | 'stalled' | 'stopped' | 'content_error' | 'unknown';
export type ConnectivityHealth = 'online' | 'stale' | 'offline';
export type MonitoringMode = 'local' | 'hybrid' | 'maintenance' | 'disabled';

export interface InstanceState {
  id: string;
  nodeId: string;
  playerId: string;
  label: string;
  siteId: string;
  playoutType: string;
  commissioned: boolean;
  monitoringMode: MonitoringMode;
  monitoringEnabled: boolean;
  maintenanceMode: boolean;
  udpMonitoringCapable: boolean;
  udpMonitoringEnabled: boolean;
  udpInputCount: number;
  udpHealthyInputCount: number;
  udpSelectedInputId: string | null;
  udpProbeEnabled: boolean;
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  connectivityHealth: ConnectivityHealth;
  lastHeartbeatAt: string | null;
  updatedAt: string | null;
  hasThumbnail: boolean;
  thumbnailAt: string | null;
  thumbnailDataUrl?: string;
}

export interface SiteState {
  id: string;
  name: string;
  instances: InstanceState[];
}

export type StatusColor = 'green' | 'yellow' | 'red' | 'orange' | 'gray';

export interface HeadlineStatus {
  color: StatusColor;
  label: string;
}

export function isInactiveInstance(inst: InstanceState): boolean {
  return !inst.commissioned && !inst.lastHeartbeatAt;
}

export function isMonitoringSuppressed(inst: InstanceState): boolean {
  return !inst.monitoringEnabled || inst.maintenanceMode;
}

export function getRuntimeBadgeColor(inst: InstanceState): StatusColor {
  if (isInactiveInstance(inst)) return 'gray';
  if (isMonitoringSuppressed(inst)) return 'gray';
  if (inst.runtimeHealth === 'stopped') return 'red';
  if (
    inst.runtimeHealth === 'paused'
    || inst.runtimeHealth === 'restarting'
    || inst.runtimeHealth === 'stalled'
    || inst.runtimeHealth === 'content_error'
  ) return 'yellow';
  if (inst.runtimeHealth === 'healthy') return 'green';
  return 'gray';
}

export function getConnectivityBadgeColor(inst: InstanceState): StatusColor {
  if (isInactiveInstance(inst)) return 'gray';
  if (isMonitoringSuppressed(inst)) return 'gray';
  return inst.connectivityHealth === 'online' ? 'green' : 'yellow';
}

export function getHeadlineStatus(inst: InstanceState): HeadlineStatus {
  if (isInactiveInstance(inst)) {
    return { color: 'gray', label: 'Inactive' };
  }

  if (!inst.monitoringEnabled) {
    return { color: 'gray', label: 'Monitoring Off' };
  }

  if (inst.maintenanceMode) {
    return { color: 'orange', label: 'Maintenance' };
  }

  if (
    inst.broadcastHealth === 'off_air_confirmed'
    || inst.broadcastHealth === 'off_air_likely'
    || inst.runtimeHealth === 'stopped'
  ) {
    return { color: 'red', label: 'Off Air' };
  }

  if (inst.connectivityHealth === 'offline' || inst.connectivityHealth === 'stale') {
    return { color: 'yellow', label: 'Offline' };
  }

  if (inst.runtimeHealth === 'paused') {
    return { color: 'yellow', label: 'Paused' };
  }

  if (inst.runtimeHealth === 'restarting') {
    return { color: 'yellow', label: 'Restarting' };
  }

  if (inst.runtimeHealth === 'stalled') {
    return { color: 'yellow', label: 'Stalled' };
  }

  if (inst.runtimeHealth === 'content_error' || inst.broadcastHealth === 'degraded') {
    return { color: 'yellow', label: 'Warning' };
  }

  if (inst.runtimeHealth === 'healthy' || inst.broadcastHealth === 'healthy' || inst.lastHeartbeatAt) {
    return { color: 'green', label: 'Active' };
  }

  return { color: 'gray', label: 'Inactive' };
}

export function getStatusColor(inst: InstanceState): StatusColor {
  return getHeadlineStatus(inst).color;
}

export function isConnectivityWarning(inst: InstanceState): boolean {
  if (isInactiveInstance(inst)) return false;
  if (isMonitoringSuppressed(inst)) return false;
  if (getStatusColor(inst) === 'red') return false;
  return inst.connectivityHealth === 'offline' || inst.connectivityHealth === 'stale';
}

export function isAlarmState(inst: InstanceState): boolean {
  if (isMonitoringSuppressed(inst)) return false;
  return inst.broadcastHealth === 'off_air_likely' || inst.broadcastHealth === 'off_air_confirmed';
}
