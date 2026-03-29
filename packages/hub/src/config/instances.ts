// Legacy bootstrap catalog.
// Clean installs now default to an empty tenant-aware dashboard.

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

function envEnabled(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

const LEGACY_BOOTSTRAP_CATALOG: InstanceConfig[] = [];
const LEGACY_BOOTSTRAP_SITES: SiteConfig[] = [];

export const LEGACY_BOOTSTRAP_ENABLED = envEnabled(process.env.PULSE_ENABLE_LEGACY_BOOTSTRAP);
export const LEGACY_BOOTSTRAP_PLAYER_IDS = new Set(LEGACY_BOOTSTRAP_CATALOG.map((instance) => instance.playerId));
export const LEGACY_BOOTSTRAP_NODE_IDS = new Set(LEGACY_BOOTSTRAP_CATALOG.map((instance) => instance.nodeId));
export const INSTANCES: InstanceConfig[] = LEGACY_BOOTSTRAP_ENABLED ? LEGACY_BOOTSTRAP_CATALOG : [];
export const SITES: SiteConfig[] = LEGACY_BOOTSTRAP_ENABLED ? LEGACY_BOOTSTRAP_SITES : [];

export function isLegacyBootstrapPlayerId(playerId: string): boolean {
  return LEGACY_BOOTSTRAP_PLAYER_IDS.has(playerId);
}

export function isLegacyBootstrapNodeId(nodeId: string): boolean {
  return LEGACY_BOOTSTRAP_NODE_IDS.has(nodeId);
}
