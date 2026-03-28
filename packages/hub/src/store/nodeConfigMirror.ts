import { db } from './db';

export interface MirroredUdpInputConfig {
  udpInputId: string;
  enabled: boolean;
  streamUrl: string;
  thumbnailIntervalS: number;
}

export interface MirroredPlayerConfig {
  playerId: string;
  playoutType: 'insta' | 'admax';
  paths: Record<string, unknown>;
  udpInputs: MirroredUdpInputConfig[];
}

export interface MirroredNodeConfig {
  nodeId: string;
  nodeName: string;
  siteId: string;
  hubUrl: string;
  pollIntervalSeconds: number;
  players: MirroredPlayerConfig[];
  updatedAt: string;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return fallback;
}

function clampInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(asString(value), 10);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(maximum, Math.max(minimum, normalized));
}

function asMapping(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeStreamUrl(value: unknown): string {
  const raw = asString(value);
  if (!raw) return '';
  if (raw.includes('REPLACE_ME')) return '';

  const lowered = raw.toLowerCase();
  if (lowered.startsWith('udp@://')) {
    return `udp://@${raw.slice('udp@://'.length)}`;
  }
  if (lowered.startsWith('udp://')) {
    return raw;
  }
  if (raw.startsWith('@')) {
    return `udp://@${raw.slice(1)}`;
  }
  return raw;
}

function normalizeUdpInputs(playerId: string, value: unknown): MirroredUdpInputConfig[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 5)
    .map((entry, index) => {
      const input = asMapping(entry);
      return {
        udpInputId: asString(input.udpInputId ?? input.udp_input_id, `${playerId}-udp-${index + 1}`),
        enabled: asBool(input.enabled, false),
        streamUrl: normalizeStreamUrl(input.streamUrl ?? input.stream_url),
        thumbnailIntervalS: clampInt(input.thumbnailIntervalS ?? input.thumbnail_interval_s, 10, 1, 300),
      };
    })
    .filter((entry) => entry.enabled || Boolean(entry.streamUrl));
}

function normalizePlayer(raw: unknown, index: number): MirroredPlayerConfig | null {
  const player = asMapping(raw);
  const playerId = asString(player.playerId ?? player.player_id ?? player.id ?? player.instance_id);
  if (!playerId) return null;

  return {
    playerId,
    playoutType: asString(player.playoutType ?? player.playout_type, 'insta') === 'admax' ? 'admax' : 'insta',
    paths: asMapping(player.paths),
    udpInputs: normalizeUdpInputs(playerId, player.udpInputs ?? player.udp_inputs ?? []),
  };
}

function normalizeNodeConfig(raw: unknown, fallbackNodeId = ''): MirroredNodeConfig | null {
  const doc = asMapping(raw);
  const nodeId = asString(doc.nodeId ?? doc.node_id, fallbackNodeId);
  if (!nodeId) return null;

  const playersRaw = Array.isArray(doc.players) ? doc.players : [];
  const players = playersRaw
    .map((player, index) => normalizePlayer(player, index))
    .filter((player): player is MirroredPlayerConfig => player !== null);

  return {
    nodeId,
    nodeName: asString(doc.nodeName ?? doc.node_name, nodeId),
    siteId: asString(doc.siteId ?? doc.site_id),
    hubUrl: asString(doc.hubUrl ?? doc.hub_url),
    pollIntervalSeconds: clampInt(doc.pollIntervalSeconds ?? doc.poll_interval_seconds, 5, 1, 300),
    players,
    updatedAt: asString(doc.updatedAt ?? doc.updated_at, new Date().toISOString()),
  };
}

export async function updateMirroredNodeConfig(nodeId: string, payload: unknown): Promise<MirroredNodeConfig | null> {
  const normalized = normalizeNodeConfig(payload, nodeId);
  if (!normalized) return null;

  const updatedAt = new Date().toISOString();
  const stored: MirroredNodeConfig = {
    ...normalized,
    nodeId,
    updatedAt,
  };

  await db.execute({
    sql: `INSERT INTO node_config_mirror (node_id, payload, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(node_id) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at`,
    args: [nodeId, JSON.stringify(stored), updatedAt],
  });

  return stored;
}

export async function getMirroredNodeConfig(nodeId: string): Promise<MirroredNodeConfig | null> {
  const result = await db.execute({
    sql: `SELECT payload FROM node_config_mirror WHERE node_id = ?`,
    args: [nodeId],
  });
  if (result.rows.length === 0) return null;

  try {
    return normalizeNodeConfig(JSON.parse(result.rows[0].payload as string), nodeId);
  } catch {
    return null;
  }
}

export async function getMirroredPlayerConfig(playerId: string): Promise<{
  nodeId: string;
  playerId: string;
  udpInputs: MirroredUdpInputConfig[];
  updatedAt: string | null;
  sourcePath: string;
  source: 'node';
} | null> {
  const result = await db.execute(`SELECT payload, updated_at FROM node_config_mirror`);
  for (const row of result.rows) {
    try {
      const config = normalizeNodeConfig(JSON.parse(row.payload as string));
      const player = config?.players.find((entry) => entry.playerId === playerId);
      if (!config || !player) continue;

      return {
        nodeId: config.nodeId,
        playerId,
        udpInputs: player.udpInputs,
        updatedAt: asString(row.updated_at, config.updatedAt),
        sourcePath: 'node://local-config',
        source: 'node',
      };
    } catch {
      continue;
    }
  }

  return null;
}
