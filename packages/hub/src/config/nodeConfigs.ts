import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

type RawMapping = Record<string, unknown>;

export interface UdpInputConfig {
  udpInputId: string;
  enabled: boolean;
  streamUrl: string;
  thumbnailIntervalS: number;
}

export interface PlayerNodeConfig {
  nodeId: string;
  playerId: string;
  udpInputs: UdpInputConfig[];
  updatedAt: string | null;
  sourcePath: string;
}

export interface DesiredNodeConfig {
  nodeId: string;
  players: Array<{
    playerId: string;
    udpInputs: UdpInputConfig[];
  }>;
  updatedAt: string | null;
}

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const CONFIG_DIR = path.join(REPO_ROOT, 'configs');
const TOKENIZED_CONFIG_DIR = path.join(REPO_ROOT, 'packages/agent/release/tokenized-configs');

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

function asInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, asInt(value, fallback)));
}

function asMapping(value: unknown): RawMapping {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawMapping : {};
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
  if (raw.includes('://')) {
    return raw;
  }
  return `udp://${raw}`;
}

function shouldKeepUdpInput(entry: UdpInputConfig): boolean {
  return entry.enabled || Boolean(entry.streamUrl.trim());
}

function configFiles(): string[] {
  if (!fs.existsSync(CONFIG_DIR)) return [];

  return fs.readdirSync(CONFIG_DIR)
    .filter((entry) => entry.toLowerCase().endsWith('.yaml'))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => path.join(CONFIG_DIR, entry));
}

function loadYamlDoc(filePath: string): RawMapping | null {
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = YAML.parse(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RawMapping : null;
}

function writeYamlDoc(filePath: string, doc: RawMapping): void {
  const rendered = YAML.stringify(doc, { lineWidth: 0 });
  fs.writeFileSync(filePath, rendered.endsWith('\n') ? rendered : `${rendered}\n`, 'utf-8');
}

function normalizeUdpInputs(playerId: string, value: unknown): UdpInputConfig[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 5)
    .map((entry, index) => {
      const udp = asMapping(entry);
      const udpInputId = asString(
        udp.udp_input_id ?? udp.id ?? udp.input_id,
        `${playerId}-udp-${index + 1}`
      );

      return {
        udpInputId,
        enabled: asBool(udp.enabled, false),
        streamUrl: normalizeStreamUrl(udp.stream_url ?? udp.url ?? udp.uri),
        thumbnailIntervalS: clampInt(udp.thumbnail_interval_s, 10, 1, 300),
      };
    })
    .filter((entry) => entry.udpInputId)
    .filter(shouldKeepUdpInput);
}

function serializeUdpInputs(playerId: string, udpInputs: UdpInputConfig[]): Array<Record<string, unknown>> {
  return udpInputs
    .slice(0, 5)
    .map((entry, index) => ({
      udp_input_id: asString(entry.udpInputId, `${playerId}-udp-${index + 1}`),
      enabled: !!entry.enabled,
      stream_url: normalizeStreamUrl(entry.streamUrl),
      thumbnail_interval_s: clampInt(entry.thumbnailIntervalS, 10, 1, 300),
    }))
    .filter((entry) => Boolean(asBool(entry.enabled, false) || asString(entry.stream_url)));
}

function extractPlayers(doc: RawMapping, filePath: string): PlayerNodeConfig[] {
  const nodeId = asString(doc.node_id ?? doc.agent_id);
  if (!nodeId) return [];

  const playersRaw = Array.isArray(doc.players)
    ? doc.players
    : Array.isArray(doc.instances)
      ? doc.instances
      : [];
  const updatedAt = fs.existsSync(filePath) ? fs.statSync(filePath).mtime.toISOString() : null;

  return playersRaw
    .map((player) => asMapping(player))
    .map((player) => {
      const playerId = asString(player.player_id ?? player.id ?? player.instance_id);
      if (!playerId) return null;

      return {
        nodeId,
        playerId,
        udpInputs: normalizeUdpInputs(playerId, player.udp_inputs),
        updatedAt,
        sourcePath: filePath,
      } satisfies PlayerNodeConfig;
    })
    .filter((player): player is PlayerNodeConfig => player !== null);
}

function updateTokenizedMirror(configPath: string, doc: RawMapping): void {
  if (!fs.existsSync(TOKENIZED_CONFIG_DIR)) return;

  fs.mkdirSync(TOKENIZED_CONFIG_DIR, { recursive: true });
  const mirrorPath = path.join(TOKENIZED_CONFIG_DIR, path.basename(configPath));
  writeYamlDoc(mirrorPath, doc);
}

export function getPlayerNodeConfig(playerId: string): PlayerNodeConfig | null {
  for (const filePath of configFiles()) {
    const doc = loadYamlDoc(filePath);
    if (!doc) continue;

    const player = extractPlayers(doc, filePath).find((entry) => entry.playerId === playerId);
    if (player) {
      return player;
    }
  }

  return null;
}

export function getNodeDesiredConfig(nodeId: string): DesiredNodeConfig | null {
  for (const filePath of configFiles()) {
    const doc = loadYamlDoc(filePath);
    if (!doc) continue;

    const players = extractPlayers(doc, filePath).filter((entry) => entry.nodeId === nodeId);
    if (players.length === 0) continue;

    return {
      nodeId,
      players: players.map((player) => ({
        playerId: player.playerId,
        udpInputs: player.udpInputs,
      })),
      updatedAt: players[0]?.updatedAt ?? null,
    };
  }

  return null;
}

export function updatePlayerUdpInputs(playerId: string, udpInputs: UdpInputConfig[]): PlayerNodeConfig | null {
  for (const filePath of configFiles()) {
    const doc = loadYamlDoc(filePath);
    if (!doc) continue;

    const playersKey = Array.isArray(doc.players) ? 'players' : Array.isArray(doc.instances) ? 'instances' : null;
    if (!playersKey) continue;

    const players = doc[playersKey];
    if (!Array.isArray(players)) continue;

    const playerIndex = players.findIndex((entry) => {
      const player = asMapping(entry);
      return asString(player.player_id ?? player.id ?? player.instance_id) === playerId;
    });
    if (playerIndex < 0) continue;

    const player = asMapping(players[playerIndex]);
    player.udp_inputs = serializeUdpInputs(playerId, udpInputs);
    delete player.udp_probe;
    players[playerIndex] = player;
    doc[playersKey] = players;

    writeYamlDoc(filePath, doc);
    updateTokenizedMirror(filePath, doc);
    return getPlayerNodeConfig(playerId);
  }

  return null;
}
