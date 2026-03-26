// Player registry — source of truth for all monitored playout players.
// Nodes map to players via nodeId → allowedPlayerIds.

export interface InstanceConfig {
  id: string;
  playerId: string;
  nodeId: string;
  label: string;
  siteId: string;
  siteName: string;
  playoutType: 'insta' | 'admax';
  udpMonitoringCapable: boolean;
}

export interface SiteConfig {
  id: string;
  name: string;
  instances: InstanceConfig[];
}

export interface AgentConfig {
  nodeId: string;
  allowedPlayerIds: string[];
}

function player(config: Omit<InstanceConfig, 'id'> & { id?: string }): InstanceConfig {
  return {
    ...config,
    id: config.id ?? config.playerId,
  };
}

export const INSTANCES: InstanceConfig[] = [
  player({
    playerId: 'ny-main-insta-1',
    nodeId: 'ny-main-pc',
    label: 'NY Main — Insta 1',
    siteId: 'ny-main',
    siteName: 'NY Main',
    playoutType: 'insta',
    udpMonitoringCapable: true,
  }),
  player({
    playerId: 'ny-main-insta-2',
    nodeId: 'ny-main-pc',
    label: 'NY Main — Insta 2',
    siteId: 'ny-main',
    siteName: 'NY Main',
    playoutType: 'insta',
    udpMonitoringCapable: true,
  }),
  player({
    playerId: 'ny-main-admax-1',
    nodeId: 'ny-main-pc',
    label: 'NY Main — Admax 1',
    siteId: 'ny-main',
    siteName: 'NY Main',
    playoutType: 'admax',
    udpMonitoringCapable: true,
  }),
  player({
    playerId: 'ny-backup-admax-1',
    nodeId: 'ny-backup-pc',
    label: 'NY Backup — Admax 1',
    siteId: 'ny-backup',
    siteName: 'NY Backup',
    playoutType: 'admax',
    udpMonitoringCapable: true,
  }),
  player({
    playerId: 'ny-backup-admax-2',
    nodeId: 'ny-backup-pc',
    label: 'NY Backup — Admax 2',
    siteId: 'ny-backup',
    siteName: 'NY Backup',
    playoutType: 'admax',
    udpMonitoringCapable: true,
  }),
  player({
    playerId: 'nj-optimum-admax-1',
    nodeId: 'nj-optimum-pc',
    label: 'NJ Optimum — Admax',
    siteId: 'nj-optimum',
    siteName: 'NJ Optimum',
    playoutType: 'admax',
    udpMonitoringCapable: true,
  }),
  player({
    playerId: 'digicel-admax-1',
    nodeId: 'digicel-pc',
    label: 'FL Digicel — Admax',
    siteId: 'digicel',
    siteName: 'FL Digicel',
    playoutType: 'admax',
    udpMonitoringCapable: true,
  }),
];

export const SITES: SiteConfig[] = [
  {
    id: 'ny-main',
    name: 'NY Main',
    instances: INSTANCES.filter((instance) => instance.siteId === 'ny-main'),
  },
  {
    id: 'ny-backup',
    name: 'NY Backup',
    instances: INSTANCES.filter((instance) => instance.siteId === 'ny-backup'),
  },
  {
    id: 'nj-optimum',
    name: 'NJ Optimum',
    instances: INSTANCES.filter((instance) => instance.siteId === 'nj-optimum'),
  },
  {
    id: 'digicel',
    name: 'FL Digicel',
    instances: INSTANCES.filter((instance) => instance.siteId === 'digicel'),
  },
];

export const AGENT_MAP: AgentConfig[] = [
  {
    nodeId: 'ny-main-pc',
    allowedPlayerIds: ['ny-main-insta-1', 'ny-main-insta-2', 'ny-main-admax-1'],
  },
  {
    nodeId: 'ny-backup-pc',
    allowedPlayerIds: ['ny-backup-admax-1', 'ny-backup-admax-2'],
  },
  {
    nodeId: 'nj-optimum-pc',
    allowedPlayerIds: ['nj-optimum-admax-1'],
  },
  {
    nodeId: 'digicel-pc',
    allowedPlayerIds: ['digicel-admax-1'],
  },
];

export const INSTANCE_MAP = new Map(INSTANCES.map((instance) => [instance.id, instance]));
export const AGENT_INSTANCE_MAP = new Map(AGENT_MAP.map((agent) => [agent.nodeId, agent.allowedPlayerIds]));
