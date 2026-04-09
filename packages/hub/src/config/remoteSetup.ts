import YAML from 'yaml';

export interface RemoteUdpInputDraft {
  udpInputId: string;
  enabled: boolean;
  streamUrl: string;
  thumbnailIntervalS: number;
}

export interface RemotePlayerDraft {
  playerId: string;
  label: string;
  playoutType: string;
  monitoringEnabled: boolean;
  paths: Record<string, unknown>;
  processSelectors: Record<string, unknown>;
  logSelectors: Record<string, unknown>;
  udpInputs: RemoteUdpInputDraft[];
}

export interface RemoteSetupDraft {
  nodeId: string;
  nodeName: string;
  siteId: string;
  hubUrl: string;
  pollIntervalSeconds: number;
  players: RemotePlayerDraft[];
}

const PLAYOUT_TYPE_ALIASES: Record<string, string> = {
  airbox: 'playbox_neo',
  airbox_neo: 'playbox_neo',
  broadstream: 'broadstream_oasys',
  cinegy: 'cinegy_air',
  custom: 'generic_windows',
  evertz: 'evertz_streampro',
  generic: 'generic_windows',
  grassvalley_itx: 'grass_valley_itx',
  itx: 'grass_valley_itx',
  marina: 'pebble_marina',
  oasys: 'broadstream_oasys',
  overture: 'evertz_streampro',
  playbox: 'playbox_neo',
  playboxneo: 'playbox_neo',
  streampro: 'evertz_streampro',
  versio: 'imagine_versio',
};

const SUPPORTED_PLAYOUT_TYPES = new Set([
  'insta',
  'admax',
  'cinegy_air',
  'playbox_neo',
  'grass_valley_itx',
  'imagine_versio',
  'broadstream_oasys',
  'pebble_marina',
  'evertz_streampro',
  'generic_windows',
]);

const PLACEHOLDER_HUB_URLS = new Set([
  'http://monitor.example.com',
  'https://monitor.example.com',
]);

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }
  return fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(asString(value), 10);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, normalized));
}

function asMapping(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => asString(entry))
    .filter(Boolean);
}

function firstConfiguredString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function isPlaceholderHubUrl(value: string): boolean {
  return PLACEHOLDER_HUB_URLS.has(value.trim().replace(/\/+$/, '').toLowerCase());
}

function normalizePlayoutType(value: unknown): string {
  const raw = asString(value, 'insta').toLowerCase();
  if (!raw) return 'insta';

  const normalized = PLAYOUT_TYPE_ALIASES[raw.replace(/[\s-]+/g, '_')] ?? raw.replace(/[\s-]+/g, '_');
  if (SUPPORTED_PLAYOUT_TYPES.has(normalized)) {
    return normalized;
  }

  return 'generic_windows';
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

function normalizeSelectors(value: unknown): Record<string, unknown> {
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

function normalizedAdmaxRoots(paths: Record<string, unknown>): string[] {
  const candidates = [
    ...asList(paths.admax_root_candidates),
    ...asList(paths.admaxRootCandidates),
  ];
  const direct = asString(paths.admax_root ?? paths.admaxRoot);
  if (direct) {
    candidates.unshift(direct);
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of candidates) {
    const cleaned = candidate.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized;
}

function normalizePaths(playoutType: string, rawValue: unknown): Record<string, unknown> {
  const rawPaths = asMapping(rawValue);
  const genericLogPath = asString(
    rawPaths.log_path
    ?? rawPaths.logPath
    ?? rawPaths.activity_log
    ?? rawPaths.activityLog
    ?? rawPaths.log_file
    ?? rawPaths.logFile,
  );
  const fnfLog = asString(rawPaths.fnf_log ?? rawPaths.fnfLog);
  const playlistScanLog = asString(rawPaths.playlistscan_log ?? rawPaths.playlistscanLog);

  if (playoutType === 'admax') {
    const admaxRoots = normalizedAdmaxRoots(rawPaths);
    const normalized: Record<string, unknown> = {};
    if (admaxRoots.length > 0) normalized.admax_root_candidates = admaxRoots;
    if (fnfLog) normalized.fnf_log = fnfLog;
    if (playlistScanLog) normalized.playlistscan_log = playlistScanLog;

    const playoutLogDir = asString(rawPaths.playout_log_dir ?? rawPaths.playoutLogDir ?? rawPaths.admax_log_dir);
    if (playoutLogDir) normalized.playout_log_dir = playoutLogDir;

    const statePath = asString(rawPaths.admax_state_path ?? rawPaths.admaxStatePath ?? rawPaths.settings_ini);
    if (statePath) normalized.admax_state_path = statePath;

    return normalized;
  }

  if (playoutType === 'insta') {
    const normalized: Record<string, unknown> = {};
    const sharedLogDir = asString(rawPaths.shared_log_dir ?? rawPaths.sharedLogDir);
    const instanceRoot = asString(rawPaths.instance_root ?? rawPaths.instanceRoot ?? rawPaths.player_root);
    if (sharedLogDir) normalized.shared_log_dir = sharedLogDir;
    if (instanceRoot) normalized.instance_root = instanceRoot;
    if (fnfLog) normalized.fnf_log = fnfLog;
    if (playlistScanLog) normalized.playlistscan_log = playlistScanLog;
    return normalized;
  }

  const normalized: Record<string, unknown> = {};
  if (genericLogPath) normalized.log_path = genericLogPath;
  if (fnfLog) normalized.fnf_log = fnfLog;
  if (playlistScanLog) normalized.playlistscan_log = playlistScanLog;
  return normalized;
}

function normalizeUdpInputs(playerId: string, value: unknown): RemoteUdpInputDraft[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 5)
    .map((entry, index) => {
      const input = asMapping(entry);
      return {
        udpInputId: asString(
          input.udpInputId
          ?? input.udp_input_id
          ?? input.id
          ?? input.input_id,
          `${playerId}-udp-${index + 1}`,
        ),
        enabled: asBool(input.enabled, false),
        streamUrl: normalizeStreamUrl(input.streamUrl ?? input.stream_url),
        thumbnailIntervalS: clampInt(input.thumbnailIntervalS ?? input.thumbnail_interval_s, 10, 1, 300),
      };
    })
    .filter((entry) => entry.enabled || Boolean(entry.streamUrl));
}

function normalizePlayerDraft(rawValue: unknown, index: number, fallbackNodeId: string): RemotePlayerDraft | null {
  const rawPlayer = asMapping(rawValue);
  const playoutType = normalizePlayoutType(
    rawPlayer.playoutType
    ?? rawPlayer.playout_type
    ?? rawPlayer.software
    ?? rawPlayer.profile,
  );
  const playerId = asString(
    rawPlayer.playerId
    ?? rawPlayer.player_id
    ?? rawPlayer.id
    ?? rawPlayer.instance_id,
    `${fallbackNodeId || 'node'}-${playoutType}-${index + 1}`,
  );
  if (!playerId) return null;

  return {
    playerId,
    label: asString(rawPlayer.label),
    playoutType,
    monitoringEnabled: asBool(rawPlayer.monitoringEnabled ?? rawPlayer.monitoring_enabled, true),
    paths: normalizePaths(playoutType, rawPlayer.paths),
    processSelectors: normalizeSelectors(rawPlayer.processSelectors ?? rawPlayer.process_selectors),
    logSelectors: normalizeSelectors(rawPlayer.logSelectors ?? rawPlayer.log_selectors),
    udpInputs: normalizeUdpInputs(
      playerId,
      rawPlayer.udpInputs
      ?? rawPlayer.udp_inputs
      ?? rawPlayer.udp_probe,
    ),
  };
}

function parseStructuredText(reportText: string): unknown {
  const trimmed = reportText.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw new Error('Upload a JSON or YAML discovery report first.');
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Fall through to YAML.
  }

  try {
    return YAML.parse(trimmed) as unknown;
  } catch {
    throw new Error('The discovery report must be valid JSON or YAML.');
  }
}

export function normalizeRemoteSetupDraft(rawValue: unknown, fallbackHubUrl: string): RemoteSetupDraft {
  const raw = asMapping(rawValue);
  const machine = asMapping(raw.machine);
  const discovery = asMapping(raw.discovery);
  const existingPulseConfig = asMapping(
    discovery.existing_pulse_config
    ?? discovery.existingPulseConfig,
  );
  const nodeId = firstConfiguredString(
    raw.nodeId,
    raw.node_id,
    raw.agent_id,
    existingPulseConfig.nodeId,
    existingPulseConfig.node_id,
    existingPulseConfig.agent_id,
    machine.hostname,
  );
  const nodeName = firstConfiguredString(
    raw.nodeName,
    raw.node_name,
    existingPulseConfig.nodeName,
    existingPulseConfig.node_name,
    nodeId,
  );
  const siteId = firstConfiguredString(
    raw.siteId,
    raw.site_id,
    existingPulseConfig.siteId,
    existingPulseConfig.site_id,
    nodeId,
  );
  const importedHubUrl = firstConfiguredString(
    raw.hubUrl,
    raw.hub_url,
    existingPulseConfig.hubUrl,
    existingPulseConfig.hub_url,
  );
  const playersRaw = Array.isArray(raw.players)
    ? raw.players
    : Array.isArray(raw.instances)
      ? raw.instances
      : [];
  const seen = new Set<string>();
  const players = playersRaw
    .map((entry, index) => normalizePlayerDraft(entry, index, nodeId))
    .filter((entry): entry is RemotePlayerDraft => entry !== null)
    .filter((entry) => {
      const key = entry.playerId.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    nodeId,
    nodeName,
    siteId,
    hubUrl: importedHubUrl && !isPlaceholderHubUrl(importedHubUrl)
      ? importedHubUrl
      : asString(fallbackHubUrl),
    pollIntervalSeconds: clampInt(raw.pollIntervalSeconds ?? raw.poll_interval_seconds, 3, 1, 120),
    players,
  };
}

export function parseRemoteSetupReport(reportText: string, fallbackHubUrl: string): RemoteSetupDraft {
  return normalizeRemoteSetupDraft(parseStructuredText(reportText), fallbackHubUrl);
}

export function buildEnrollmentInput(draft: RemoteSetupDraft): {
  nodeId: string;
  nodeName: string;
  siteId: string;
  players: Array<{ playerId: string; playoutType: string; label?: string }>;
} {
  return {
    nodeId: draft.nodeId.trim(),
    nodeName: draft.nodeName.trim(),
    siteId: draft.siteId.trim(),
    players: draft.players.map((player) => ({
      playerId: player.playerId.trim(),
      playoutType: player.playoutType,
      label: player.label.trim() || undefined,
    })),
  };
}

export function buildMirrorPayload(draft: RemoteSetupDraft): Record<string, unknown> {
  return {
    node_id: draft.nodeId,
    node_name: draft.nodeName,
    site_id: draft.siteId,
    hub_url: draft.hubUrl,
    poll_interval_seconds: draft.pollIntervalSeconds,
    players: draft.players.map((player) => ({
      player_id: player.playerId,
      playout_type: player.playoutType,
      label: player.label,
      paths: player.paths,
      process_selectors: player.processSelectors,
      log_selectors: player.logSelectors,
      udp_inputs: player.udpInputs.map((udpInput) => ({
        udp_input_id: udpInput.udpInputId,
        enabled: udpInput.enabled,
        stream_url: udpInput.streamUrl,
        thumbnail_interval_s: udpInput.thumbnailIntervalS,
      })),
    })),
  };
}

export function serializeAgentConfigYaml(
  draft: RemoteSetupDraft,
  agentToken: string,
  enrollmentKey?: string | null,
): string {
  const document = {
    node_id: draft.nodeId,
    node_name: draft.nodeName,
    site_id: draft.siteId,
    hub_url: draft.hubUrl,
    agent_token: agentToken,
    ...(enrollmentKey ? { enrollment_key: enrollmentKey } : {}),
    poll_interval_seconds: draft.pollIntervalSeconds,
    players: draft.players.map((player) => ({
      player_id: player.playerId,
      playout_type: player.playoutType,
      ...(player.label ? { label: player.label } : {}),
      paths: player.paths,
      process_selectors: player.processSelectors,
      log_selectors: player.logSelectors,
      udp_inputs: player.udpInputs.map((udpInput) => ({
        udp_input_id: udpInput.udpInputId,
        enabled: udpInput.enabled,
        stream_url: udpInput.streamUrl,
        thumbnail_interval_s: udpInput.thumbnailIntervalS,
      })),
    })),
  };

  return YAML.stringify(document);
}
