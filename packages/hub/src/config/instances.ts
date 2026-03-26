// Instance registry — source of truth for all 7 monitored playout instances
// Agents map to instances via agentId → allowedInstanceIds

export interface InstanceConfig {
  id: string;
  label: string;
  siteId: string;
  siteName: string;
  playoutType: 'insta' | 'admax';
  udpProbeEnabled: boolean;
}

export interface SiteConfig {
  id: string;
  name: string;
  instances: InstanceConfig[];
}

export interface AgentConfig {
  agentId: string;
  allowedInstanceIds: string[];
}

export const INSTANCES: InstanceConfig[] = [
  // NY Main PC — 3 instances
  {
    id: 'ny-main-insta-1',
    label: 'NY Main — Insta 1',
    siteId: 'ny-main',
    siteName: 'NY Main',
    playoutType: 'insta',
    udpProbeEnabled: false,
  },
  {
    id: 'ny-main-insta-2',
    label: 'NY Main — Insta 2',
    siteId: 'ny-main',
    siteName: 'NY Main',
    playoutType: 'insta',
    udpProbeEnabled: false,
  },
  {
    id: 'ny-main-admax-1',
    label: 'NY Main — Admax 1',
    siteId: 'ny-main',
    siteName: 'NY Main',
    playoutType: 'admax',
    udpProbeEnabled: false,
  },
  // NY Backup PC — 2 instances (UDP probe via encoder)
  {
    id: 'ny-backup-admax-1',
    label: 'NY Backup — Admax 1',
    siteId: 'ny-backup',
    siteName: 'NY Backup',
    playoutType: 'admax',
    udpProbeEnabled: true,
  },
  {
    id: 'ny-backup-admax-2',
    label: 'NY Backup — Admax 2',
    siteId: 'ny-backup',
    siteName: 'NY Backup',
    playoutType: 'admax',
    udpProbeEnabled: true,
  },
  // NJ Optimum PC — 1 instance (SDI only, no UDP)
  {
    id: 'nj-optimum-admax-1',
    label: 'NJ Optimum — Admax',
    siteId: 'nj-optimum',
    siteName: 'NJ Optimum',
    playoutType: 'admax',
    udpProbeEnabled: false,
  },
  // FL Digicel PC — 1 instance (UDP probe via encoder)
  {
    id: 'digicel-admax-1',
    label: 'FL Digicel — Admax',
    siteId: 'digicel',
    siteName: 'FL Digicel',
    playoutType: 'admax',
    udpProbeEnabled: true,
  },
];

// Site grouping for dashboard
export const SITES: SiteConfig[] = [
  {
    id: 'ny-main',
    name: 'NY Main',
    instances: INSTANCES.filter((i) => i.siteId === 'ny-main'),
  },
  {
    id: 'ny-backup',
    name: 'NY Backup',
    instances: INSTANCES.filter((i) => i.siteId === 'ny-backup'),
  },
  {
    id: 'nj-optimum',
    name: 'NJ Optimum',
    instances: INSTANCES.filter((i) => i.siteId === 'nj-optimum'),
  },
  {
    id: 'digicel',
    name: 'FL Digicel',
    instances: INSTANCES.filter((i) => i.siteId === 'digicel'),
  },
];

// Agent-to-instance mapping — hub validates each heartbeat against this
export const AGENT_MAP: AgentConfig[] = [
  {
    agentId: 'ny-main-pc',
    allowedInstanceIds: ['ny-main-insta-1', 'ny-main-insta-2', 'ny-main-admax-1'],
  },
  {
    agentId: 'ny-backup-pc',
    allowedInstanceIds: ['ny-backup-admax-1', 'ny-backup-admax-2'],
  },
  {
    agentId: 'nj-optimum-pc',
    allowedInstanceIds: ['nj-optimum-admax-1'],
  },
  {
    agentId: 'digicel-pc',
    allowedInstanceIds: ['digicel-admax-1'],
  },
];

export const INSTANCE_MAP = new Map(INSTANCES.map((i) => [i.id, i]));
export const AGENT_INSTANCE_MAP = new Map(AGENT_MAP.map((a) => [a.agentId, a.allowedInstanceIds]));
