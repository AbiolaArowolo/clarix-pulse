import { exec, queryOne } from './db';
import { syncRegistryFromNodeMirror } from './registry';

export interface MirroredUdpInputConfig {
  udpInputId: string;
  enabled: boolean;
  streamUrl: string;
  thumbnailIntervalS: number;
}

export interface MirroredPlayerConfig {
  playerId: string;
  label: string;
  playoutType: string;
  paths: Record<string, unknown>;
  processSelectors: Record<string, unknown>;
  logSelectors: Record<string, unknown>;
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
  if (!raw || raw.includes('REPLACE_ME')) return '';

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

function normalizeSelectorValue(value: unknown): string | string[] | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => asString(entry))
      .filter(Boolean);
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function normalizeSelectorMap(value: unknown): Record<string, unknown> {
  const selectors = asMapping(value);
  const normalized: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(selectors)) {
    const cleaned = normalizeSelectorValue(rawValue);
    if (cleaned !== null) {
      normalized[key] = cleaned;
    }
  }

  return normalized;
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

function normalizePlayer(raw: unknown): MirroredPlayerConfig | null {
  const player = asMapping(raw);
  const playerId = asString(player.playerId ?? player.player_id ?? player.id ?? player.instance_id);
  if (!playerId) return null;

  return {
    playerId,
    label: asString(player.label),
    playoutType: asString(player.playoutType ?? player.playout_type, 'insta') || 'insta',
    paths: asMapping(player.paths),
    processSelectors: normalizeSelectorMap(player.processSelectors ?? player.process_selectors),
    logSelectors: normalizeSelectorMap(player.logSelectors ?? player.log_selectors),
    udpInputs: normalizeUdpInputs(playerId, player.udpInputs ?? player.udp_inputs),
  };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeNodeConfig(raw: unknown, fallbackNodeId = ''): MirroredNodeConfig | null {
  const doc = asMapping(raw);
  const nodeId = asString(doc.nodeId ?? doc.node_id, fallbackNodeId);
  if (!nodeId) return null;

  const playersRaw = Array.isArray(doc.players) ? doc.players : [];
  const players = playersRaw
    .map((entry) => normalizePlayer(entry))
    .filter((entry): entry is MirroredPlayerConfig => entry !== null);

  return {
    nodeId,
    nodeName: asString(doc.nodeName ?? doc.node_name, nodeId),
    siteId: asString(doc.siteId ?? doc.site_id, nodeId),
    hubUrl: asString(doc.hubUrl ?? doc.hub_url),
    pollIntervalSeconds: clampInt(doc.pollIntervalSeconds ?? doc.poll_interval_seconds, 5, 1, 300),
    players,
    updatedAt: asString(doc.updatedAt ?? doc.updated_at, new Date().toISOString()),
  };
}

function serializePayload(payload: MirroredNodeConfig): string {
  return JSON.stringify(payload);
}

export async function updateMirroredNodeConfig(
  tenantId: string,
  nodeId: string,
  payload: unknown,
): Promise<MirroredNodeConfig | null> {
  const normalized = normalizeNodeConfig(payload, nodeId);
  if (!normalized) return null;

  const updatedAt = new Date().toISOString();
  const stored: MirroredNodeConfig = {
    ...normalized,
    nodeId,
    updatedAt,
  };

  await syncRegistryFromNodeMirror({
    tenantId,
    nodeId,
    nodeName: stored.nodeName,
    siteId: stored.siteId,
    players: stored.players.map((player) => ({
      playerId: player.playerId,
      playoutType: player.playoutType,
      label: player.label || `${stored.nodeName} - ${player.playerId}`,
    })),
  });

  await exec(`
    INSERT INTO node_config_mirror (node_id, payload, updated_at)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT (node_id) DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = EXCLUDED.updated_at
  `, [nodeId, serializePayload(stored), updatedAt]);

  return stored;
}

export async function updateMirroredPlayerStreamUrl(
  playerId: string,
  tenantId: string,
  udpInputId: string,
  streamUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const row = await queryOne<Record<string, unknown>>(
    `
      SELECT m.node_id, m.payload, m.updated_at
      FROM node_config_mirror m
      JOIN nodes n ON n.node_id = m.node_id
      JOIN players p ON p.node_id = n.node_id
      JOIN sites s ON s.site_id = n.site_id
      WHERE p.player_id = $1 AND s.tenant_id = $2
    `,
    [playerId, tenantId],
  );

  if (!row) {
    return { ok: false, error: 'No mirrored config found for this player.' };
  }

  const nodeId = asString(row.node_id);
  const config = normalizeNodeConfig(row.payload, nodeId);
  if (!config) {
    return { ok: false, error: 'Mirrored config is malformed.' };
  }

  const playerIndex = config.players.findIndex((p) => p.playerId === playerId);
  if (playerIndex === -1) {
    return { ok: false, error: 'Player not found in mirrored config.' };
  }

  const inputIndex = config.players[playerIndex].udpInputs.findIndex((u) => u.udpInputId === udpInputId);
  if (inputIndex === -1) {
    return { ok: false, error: 'UDP input not found.' };
  }

  const updatedAt = new Date().toISOString();
  const updatedPlayers = config.players.map((player, pi) => {
    if (pi !== playerIndex) return player;
    return {
      ...player,
      udpInputs: player.udpInputs.map((u, ui) => {
        if (ui !== inputIndex) return u;
        return { ...u, streamUrl };
      }),
    };
  });

  const stored: MirroredNodeConfig = { ...config, players: updatedPlayers, updatedAt };

  await exec(`
    UPDATE node_config_mirror SET
      payload = $1::jsonb,
      updated_at = $2
    WHERE node_id = $3
  `, [serializePayload(stored), updatedAt, nodeId]);

  return { ok: true };
}

export async function getMirroredNodeConfig(nodeId: string, tenantId: string): Promise<MirroredNodeConfig | null> {
  const row = await queryOne<Record<string, unknown>>(`
    SELECT m.payload, m.updated_at
    FROM node_config_mirror m
    JOIN nodes n ON n.node_id = m.node_id
    JOIN sites s ON s.site_id = n.site_id
    WHERE m.node_id = $1 AND s.tenant_id = $2
  `, [nodeId, tenantId]);

  if (!row) {
    return null;
  }

  const payload = normalizeNodeConfig(row.payload, nodeId);
  if (!payload) {
    return null;
  }

  return {
    ...payload,
    updatedAt: toIso(row.updated_at as Date | string | null | undefined) ?? payload.updatedAt,
  };
}

export async function getMirroredPlayerConfig(playerId: string, tenantId: string): Promise<{
  nodeId: string;
  playerId: string;
  playoutType: string;
  paths: Record<string, unknown>;
  processSelectors: Record<string, unknown>;
  logSelectors: Record<string, unknown>;
  udpInputs: MirroredUdpInputConfig[];
  updatedAt: string | null;
  sourcePath: string;
  source: 'node';
} | null> {
  const row = await queryOne<Record<string, unknown>>(
    `
      SELECT m.payload, m.updated_at
      FROM node_config_mirror m
      JOIN nodes n ON n.node_id = m.node_id
      JOIN players p ON p.node_id = n.node_id
      JOIN sites s ON s.site_id = n.site_id
      WHERE p.player_id = $1 AND s.tenant_id = $2
    `,
    [playerId, tenantId],
  );

  if (!row) {
    return null;
  }

  const config = normalizeNodeConfig(row.payload);
  const player = config?.players.find((entry) => entry.playerId === playerId);
  if (!config || !player) {
    return null;
  }

  return {
    nodeId: config.nodeId,
    playerId,
    playoutType: player.playoutType,
    paths: player.paths,
    processSelectors: player.processSelectors,
    logSelectors: player.logSelectors,
    udpInputs: player.udpInputs,
    updatedAt: toIso(row.updated_at as Date | string | null | undefined) ?? config.updatedAt,
    sourcePath: 'node://local-config',
    source: 'node',
  };
}
