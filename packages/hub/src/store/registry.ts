import crypto from 'crypto';
import { QueryResultRow } from 'pg';
import { INSTANCES, SITES } from '../config/instances';
import { exec, query, queryOne, withTransaction } from './db';

export interface SiteRecord {
  siteId: string;
  siteName: string;
  createdAt: string;
  updatedAt: string;
}

export interface NodeRecord {
  nodeId: string;
  siteId: string;
  nodeName: string;
  localUiUrl: string;
  commissioned: boolean;
  createdAt: string;
  updatedAt: string;
  lastEnrolledAt: string | null;
}

export interface PlayerRecord {
  playerId: string;
  nodeId: string;
  siteId: string;
  siteName: string;
  nodeName: string;
  label: string;
  playoutType: 'insta' | 'admax';
  udpMonitoringCapable: boolean;
  commissioned: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface EnrollmentInput {
  nodeId: string;
  nodeName: string;
  siteId: string;
  players: Array<{
    playerId: string;
    playoutType: 'insta' | 'admax';
    label?: string;
  }>;
}

export interface EnrollmentResult {
  nodeId: string;
  siteId: string;
  agentToken: string;
  players: PlayerRecord[];
  updatedAt: string;
}

interface SiteRow extends QueryResultRow {
  site_id: string;
  site_name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface NodeRow extends QueryResultRow {
  node_id: string;
  site_id: string;
  node_name: string;
  local_ui_url: string;
  commissioned: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_enrolled_at: Date | string | null;
}

interface PlayerRow extends QueryResultRow {
  player_id: string;
  node_id: string;
  site_id: string;
  site_name: string;
  node_name: string;
  label: string;
  playout_type: string;
  udp_monitoring_capable: boolean;
  commissioned: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_seen_at: Date | string | null;
}

const DEFAULT_LOCAL_UI_URL = 'http://127.0.0.1:3210/';
const LEGACY_SITE_NAME_MAP = new Map(SITES.map((site) => [site.id, site.name]));

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function titleCaseToken(value: string): string {
  if (!value) return '';
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function normalizeSiteName(siteId: string, siteName?: string): string {
  const explicit = siteName?.trim();
  if (explicit) return explicit;

  return LEGACY_SITE_NAME_MAP.get(siteId) ?? titleCaseToken(siteId);
}

function normalizeNodeName(nodeId: string, nodeName?: string): string {
  const explicit = nodeName?.trim();
  if (explicit) return explicit;

  const legacy = INSTANCES.find((instance) => instance.nodeId === nodeId)?.siteName;
  return legacy ?? titleCaseToken(nodeId);
}

function normalizePlayerLabel(nodeName: string, playerId: string, label?: string): string {
  const explicit = label?.trim();
  if (explicit) return explicit;

  const legacy = INSTANCES.find((instance) => instance.playerId === playerId)?.label;
  return legacy ?? `${nodeName} - ${playerId}`;
}

function normalizePlayoutType(value: string | undefined): 'insta' | 'admax' {
  return value === 'admax' ? 'admax' : 'insta';
}

function rowToSite(row: SiteRow): SiteRecord {
  return {
    siteId: row.site_id,
    siteName: row.site_name,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

function rowToNode(row: NodeRow): NodeRecord {
  return {
    nodeId: row.node_id,
    siteId: row.site_id,
    nodeName: row.node_name,
    localUiUrl: row.local_ui_url,
    commissioned: !!row.commissioned,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    lastEnrolledAt: toIso(row.last_enrolled_at),
  };
}

function rowToPlayer(row: PlayerRow): PlayerRecord {
  return {
    playerId: row.player_id,
    nodeId: row.node_id,
    siteId: row.site_id,
    siteName: row.site_name,
    nodeName: row.node_name,
    label: row.label,
    playoutType: normalizePlayoutType(row.playout_type),
    udpMonitoringCapable: !!row.udp_monitoring_capable,
    commissioned: !!row.commissioned,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    lastSeenAt: toIso(row.last_seen_at),
  };
}

function parseLegacyTokens(): Array<{ nodeId: string; token: string }> {
  const pairs = (process.env.AGENT_TOKENS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const parsed: Array<{ nodeId: string; token: string }> = [];
  for (const pair of pairs) {
    const [nodeId, token] = pair.split(':').map((entry) => entry.trim());
    if (!nodeId || !token) continue;
    parsed.push({ nodeId, token });
  }

  return parsed;
}

export async function initRegistry(): Promise<void> {
  const legacyTokens = parseLegacyTokens();
  const timestamp = new Date().toISOString();

  await withTransaction(async (client) => {
    for (const site of SITES) {
      await exec(`
        INSERT INTO sites (site_id, site_name, created_at, updated_at)
        VALUES ($1, $2, $3, $3)
        ON CONFLICT (site_id) DO UPDATE SET
          site_name = EXCLUDED.site_name,
          updated_at = EXCLUDED.updated_at;
      `, [site.id, site.name, timestamp], client);
    }

    for (const instance of INSTANCES) {
      const nodeName = normalizeNodeName(instance.nodeId, instance.siteName);
      await exec(`
        INSERT INTO nodes (node_id, site_id, node_name, local_ui_url, commissioned, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (node_id) DO UPDATE SET
          site_id = EXCLUDED.site_id,
          node_name = EXCLUDED.node_name,
          local_ui_url = EXCLUDED.local_ui_url,
          commissioned = EXCLUDED.commissioned,
          updated_at = EXCLUDED.updated_at;
      `, [instance.nodeId, instance.siteId, nodeName, DEFAULT_LOCAL_UI_URL, instance.commissioned, timestamp], client);

      await exec(`
        INSERT INTO players (
          player_id, node_id, site_id, label, playout_type,
          udp_monitoring_capable, commissioned, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        ON CONFLICT (player_id) DO UPDATE SET
          node_id = EXCLUDED.node_id,
          site_id = EXCLUDED.site_id,
          label = EXCLUDED.label,
          playout_type = EXCLUDED.playout_type,
          udp_monitoring_capable = EXCLUDED.udp_monitoring_capable,
          commissioned = EXCLUDED.commissioned,
          updated_at = EXCLUDED.updated_at;
      `, [
        instance.playerId,
        instance.nodeId,
        instance.siteId,
        instance.label,
        instance.playoutType,
        instance.udpMonitoringCapable,
        instance.commissioned,
        timestamp,
      ], client);
    }

    for (const { nodeId, token } of legacyTokens) {
      await exec(`
        INSERT INTO agent_tokens (token, node_id, description, active, created_at, updated_at)
        VALUES ($1, $2, 'Seeded from AGENT_TOKENS', TRUE, $3, $3)
        ON CONFLICT (token) DO UPDATE SET
          node_id = EXCLUDED.node_id,
          description = EXCLUDED.description,
          active = TRUE,
          updated_at = EXCLUDED.updated_at;
      `, [token, nodeId, timestamp], client);
    }
  });
}

export async function getSite(siteId: string): Promise<SiteRecord | null> {
  const row = await queryOne<SiteRow>(`
    SELECT site_id, site_name, created_at, updated_at
    FROM sites
    WHERE site_id = $1
  `, [siteId]);
  return row ? rowToSite(row) : null;
}

export async function getNode(nodeId: string): Promise<NodeRecord | null> {
  const row = await queryOne<NodeRow>(`
    SELECT node_id, site_id, node_name, local_ui_url, commissioned, created_at, updated_at, last_enrolled_at
    FROM nodes
    WHERE node_id = $1
  `, [nodeId]);
  return row ? rowToNode(row) : null;
}

export async function getPlayer(playerId: string): Promise<PlayerRecord | null> {
  const row = await queryOne<PlayerRow>(`
    SELECT
      p.player_id,
      p.node_id,
      p.site_id,
      s.site_name,
      n.node_name,
      p.label,
      p.playout_type,
      p.udp_monitoring_capable,
      p.commissioned,
      p.created_at,
      p.updated_at,
      p.last_seen_at
    FROM players p
    JOIN sites s ON s.site_id = p.site_id
    JOIN nodes n ON n.node_id = p.node_id
    WHERE p.player_id = $1
  `, [playerId]);
  return row ? rowToPlayer(row) : null;
}

export async function listPlayers(): Promise<PlayerRecord[]> {
  const rows = await query<PlayerRow>(`
    SELECT
      p.player_id,
      p.node_id,
      p.site_id,
      s.site_name,
      n.node_name,
      p.label,
      p.playout_type,
      p.udp_monitoring_capable,
      p.commissioned,
      p.created_at,
      p.updated_at,
      p.last_seen_at
    FROM players p
    JOIN sites s ON s.site_id = p.site_id
    JOIN nodes n ON n.node_id = p.node_id
    ORDER BY s.site_name, n.node_name, p.label, p.player_id
  `);

  return rows.map(rowToPlayer);
}

export async function listPlayersForNode(nodeId: string): Promise<PlayerRecord[]> {
  const rows = await query<PlayerRow>(`
    SELECT
      p.player_id,
      p.node_id,
      p.site_id,
      s.site_name,
      n.node_name,
      p.label,
      p.playout_type,
      p.udp_monitoring_capable,
      p.commissioned,
      p.created_at,
      p.updated_at,
      p.last_seen_at
    FROM players p
    JOIN sites s ON s.site_id = p.site_id
    JOIN nodes n ON n.node_id = p.node_id
    WHERE p.node_id = $1
    ORDER BY p.label, p.player_id
  `, [nodeId]);

  return rows.map(rowToPlayer);
}

export async function resolveNodeIdForToken(token: string): Promise<string | null> {
  const row = await queryOne<{ node_id: string }>(`
    SELECT node_id
    FROM agent_tokens
    WHERE token = $1 AND active = TRUE
  `, [token]);
  return row?.node_id ?? null;
}

export async function upsertNode(input: {
  nodeId: string;
  siteId: string;
  nodeName: string;
  localUiUrl?: string;
  commissioned?: boolean;
  lastEnrolledAt?: string | null;
}): Promise<NodeRecord> {
  const timestamp = new Date().toISOString();
  const row = await queryOne<NodeRow>(`
    INSERT INTO nodes (
      node_id, site_id, node_name, local_ui_url, commissioned, created_at, updated_at, last_enrolled_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
    ON CONFLICT (node_id) DO UPDATE SET
      site_id = EXCLUDED.site_id,
      node_name = EXCLUDED.node_name,
      local_ui_url = EXCLUDED.local_ui_url,
      commissioned = EXCLUDED.commissioned,
      updated_at = EXCLUDED.updated_at,
      last_enrolled_at = COALESCE(EXCLUDED.last_enrolled_at, nodes.last_enrolled_at)
    RETURNING node_id, site_id, node_name, local_ui_url, commissioned, created_at, updated_at, last_enrolled_at
  `, [
    input.nodeId,
    input.siteId,
    input.nodeName,
    input.localUiUrl ?? DEFAULT_LOCAL_UI_URL,
    input.commissioned ?? true,
    timestamp,
    input.lastEnrolledAt ?? null,
  ]);

  if (!row) {
    throw new Error(`Failed to upsert node ${input.nodeId}`);
  }

  return rowToNode(row);
}

export async function upsertSite(input: { siteId: string; siteName?: string }): Promise<SiteRecord> {
  const timestamp = new Date().toISOString();
  const siteName = normalizeSiteName(input.siteId, input.siteName);
  const row = await queryOne<SiteRow>(`
    INSERT INTO sites (site_id, site_name, created_at, updated_at)
    VALUES ($1, $2, $3, $3)
    ON CONFLICT (site_id) DO UPDATE SET
      site_name = EXCLUDED.site_name,
      updated_at = EXCLUDED.updated_at
    RETURNING site_id, site_name, created_at, updated_at
  `, [input.siteId, siteName, timestamp]);

  if (!row) {
    throw new Error(`Failed to upsert site ${input.siteId}`);
  }

  return rowToSite(row);
}

export async function upsertPlayer(input: {
  playerId: string;
  nodeId: string;
  siteId: string;
  nodeName?: string;
  label?: string;
  playoutType?: string;
  udpMonitoringCapable?: boolean;
  commissioned?: boolean;
  lastSeenAt?: string | null;
}): Promise<PlayerRecord> {
  const timestamp = new Date().toISOString();
  const nodeName = normalizeNodeName(input.nodeId, input.nodeName);
  const label = normalizePlayerLabel(nodeName, input.playerId, input.label);
  const row = await queryOne<PlayerRow>(`
    INSERT INTO players (
      player_id, node_id, site_id, label, playout_type,
      udp_monitoring_capable, commissioned, created_at, updated_at, last_seen_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
    ON CONFLICT (player_id) DO UPDATE SET
      node_id = EXCLUDED.node_id,
      site_id = EXCLUDED.site_id,
      label = EXCLUDED.label,
      playout_type = EXCLUDED.playout_type,
      udp_monitoring_capable = EXCLUDED.udp_monitoring_capable,
      commissioned = EXCLUDED.commissioned,
      updated_at = EXCLUDED.updated_at,
      last_seen_at = COALESCE(EXCLUDED.last_seen_at, players.last_seen_at)
    RETURNING
      players.player_id,
      players.node_id,
      players.site_id,
      (SELECT site_name FROM sites WHERE site_id = players.site_id) AS site_name,
      (SELECT node_name FROM nodes WHERE node_id = players.node_id) AS node_name,
      players.label,
      players.playout_type,
      players.udp_monitoring_capable,
      players.commissioned,
      players.created_at,
      players.updated_at,
      players.last_seen_at
  `, [
    input.playerId,
    input.nodeId,
    input.siteId,
    label,
    normalizePlayoutType(input.playoutType),
    input.udpMonitoringCapable ?? true,
    input.commissioned ?? true,
    timestamp,
    input.lastSeenAt ?? null,
  ]);

  if (!row) {
    throw new Error(`Failed to upsert player ${input.playerId}`);
  }

  return rowToPlayer(row);
}

export async function markPlayerSeen(playerId: string, observedAt = new Date().toISOString()): Promise<void> {
  await exec(`
    UPDATE players
    SET last_seen_at = $2, updated_at = $2
    WHERE player_id = $1
  `, [playerId, observedAt]);
}

export async function syncRegistryFromNodeMirror(input: {
  nodeId: string;
  nodeName?: string;
  siteId?: string;
  players?: Array<{
    playerId: string;
    playoutType?: string;
    label?: string;
  }>;
}): Promise<{ node: NodeRecord; players: PlayerRecord[] }> {
  const siteId = input.siteId?.trim() || input.nodeId;
  const site = await upsertSite({
    siteId,
    siteName: normalizeSiteName(siteId),
  });
  const node = await upsertNode({
    nodeId: input.nodeId,
    siteId: site.siteId,
    nodeName: normalizeNodeName(input.nodeId, input.nodeName),
    localUiUrl: DEFAULT_LOCAL_UI_URL,
    commissioned: true,
  });

  const players: PlayerRecord[] = [];
  for (const player of input.players ?? []) {
    if (!player.playerId) continue;
    players.push(await upsertPlayer({
      playerId: player.playerId,
      nodeId: node.nodeId,
      siteId: node.siteId,
      nodeName: node.nodeName,
      label: player.label,
      playoutType: player.playoutType,
      udpMonitoringCapable: true,
      commissioned: true,
    }));
  }

  return { node, players };
}

export async function enrollNode(input: EnrollmentInput): Promise<EnrollmentResult> {
  const nodeId = input.nodeId.trim();
  const nodeName = normalizeNodeName(nodeId, input.nodeName);
  const siteId = input.siteId.trim() || nodeId;
  const updatedAt = new Date().toISOString();
  const token = crypto.randomBytes(24).toString('hex');

  await upsertSite({ siteId, siteName: normalizeSiteName(siteId) });
  await upsertNode({
    nodeId,
    siteId,
    nodeName,
    localUiUrl: DEFAULT_LOCAL_UI_URL,
    commissioned: true,
    lastEnrolledAt: updatedAt,
  });

  await withTransaction(async (client) => {
    await exec(`
      UPDATE agent_tokens
      SET active = FALSE, updated_at = $2
      WHERE node_id = $1 AND active = TRUE
    `, [nodeId, updatedAt], client);

    await exec(`
      INSERT INTO agent_tokens (token, node_id, description, active, created_at, updated_at)
      VALUES ($1, $2, 'Created by enrollment', TRUE, $3, $3)
    `, [token, nodeId, updatedAt], client);
  });

  for (const player of input.players) {
    const playerId = player.playerId.trim();
    if (!playerId) continue;
    await upsertPlayer({
      playerId,
      nodeId,
      siteId,
      nodeName,
      label: player.label,
      playoutType: player.playoutType,
      udpMonitoringCapable: true,
      commissioned: true,
    });
  }

  return {
    nodeId,
    siteId,
    agentToken: token,
    players: await listPlayersForNode(nodeId),
    updatedAt,
  };
}
