// Legacy bootstrap catalog for first-run Postgres seeding.
// Runtime reads nodes and players from the database after bootstrap.

export interface InstanceConfig {
  id: string;
  playerId: string;
  nodeId: string;
  label: string;
  siteId: string;
  siteName: string;
  playoutType: 'insta' | 'admax';
  udpMonitoringCapable: boolean;
  commissioned: boolean;
}

export interface SiteConfig {
  id: string;
  name: string;
  instances: InstanceConfig[];
}

function player(config: Omit<InstanceConfig, 'id' | 'commissioned'> & { id?: string; commissioned?: boolean }): InstanceConfig {
  return {
    ...config,
    id: config.id ?? config.playerId,
    commissioned: config.commissioned ?? true,
  };
}

export const INSTANCES: InstanceConfig[] = [
  player({
    playerId: 'ny-main-insta-1',
    nodeId: 'ny-main-pc',
    label: 'NY Main - Insta 1',
    siteId: 'ny-main',
    siteName: 'NY Main',
    playoutType: 'insta',
    udpMonitoringCapable: true,
    commissioned: false,
  }),
  player({
    playerId: 'ny-main-insta-2',
    nodeId: 'ny-main-pc',
    label: 'NY Main - Insta 2',
    siteId: 'ny-main',
    siteName: 'NY Main',
    playoutType: 'insta',
    udpMonitoringCapable: true,
    commissioned: false,
  }),
  player({
    playerId: 'ny-main-admax-1',
    nodeId: 'ny-main-pc',
    label: 'NY Main - Admax 1',
    siteId: 'ny-main',
    siteName: 'NY Main',
    playoutType: 'admax',
    udpMonitoringCapable: true,
    commissioned: false,
  }),
  player({
    playerId: 'ny-backup-admax-1',
    nodeId: 'ny-backup-pc',
    label: 'NY Backup - Admax 1',
    siteId: 'ny-backup',
    siteName: 'NY Backup',
    playoutType: 'admax',
    udpMonitoringCapable: true,
    commissioned: false,
  }),
  player({
    playerId: 'ny-backup-admax-2',
    nodeId: 'ny-backup-pc',
    label: 'NY Backup - Admax 2',
    siteId: 'ny-backup',
    siteName: 'NY Backup',
    playoutType: 'admax',
    udpMonitoringCapable: true,
    commissioned: false,
  }),
  player({
    playerId: 'nj-optimum-insta-1',
    nodeId: 'nj-optimum-pc',
    label: 'NJ Optimum - Insta',
    siteId: 'nj-optimum',
    siteName: 'NJ Optimum',
    playoutType: 'insta',
    udpMonitoringCapable: true,
    commissioned: true,
  }),
  player({
    playerId: 'digicel-admax-1',
    nodeId: 'digicel-pc',
    label: 'FL Digicel - Admax',
    siteId: 'digicel',
    siteName: 'FL Digicel',
    playoutType: 'admax',
    udpMonitoringCapable: true,
    commissioned: false,
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
