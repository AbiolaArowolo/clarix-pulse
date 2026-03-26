export type BroadcastHealth = 'healthy' | 'degraded' | 'off_air_likely' | 'off_air_confirmed' | 'unknown';
export type RuntimeHealth = 'healthy' | 'paused' | 'restarting' | 'stalled' | 'stopped' | 'content_error' | 'unknown';
export type ConnectivityHealth = 'online' | 'stale' | 'offline';
export type MonitoringMode = 'local' | 'hybrid';

export interface InstanceState {
  id: string;
  nodeId: string;
  playerId: string;
  label: string;
  siteId: string;
  playoutType: 'insta' | 'admax';
  monitoringMode: MonitoringMode;
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

export function getStatusColor(inst: InstanceState): StatusColor {
  if (inst.connectivityHealth === 'offline') return 'gray';
  if (inst.connectivityHealth === 'stale') return 'orange';
  if (inst.broadcastHealth === 'off_air_confirmed' || inst.broadcastHealth === 'off_air_likely') return 'red';
  if (inst.runtimeHealth === 'stopped') return 'red';
  if (
    inst.broadcastHealth === 'degraded'
    || inst.runtimeHealth === 'paused'
    || inst.runtimeHealth === 'restarting'
    || inst.runtimeHealth === 'stalled'
    || inst.runtimeHealth === 'content_error'
  ) return 'yellow';
  if (inst.broadcastHealth === 'healthy' && inst.runtimeHealth === 'healthy') return 'green';
  return 'gray';
}

export function isAlarmState(inst: InstanceState): boolean {
  return getStatusColor(inst) === 'red';
}
