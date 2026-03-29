import React, { ChangeEvent, useMemo, useState } from 'react';
import { copyTextToClipboard } from '../lib/clipboard';

interface RemoteSetupPlayerPayload {
  playerId: string;
  label: string;
  playoutType: string;
  monitoringEnabled: boolean;
  paths: Record<string, unknown>;
  processSelectors: Record<string, unknown>;
  logSelectors: Record<string, unknown>;
  udpInputs: Array<{
    udpInputId: string;
    enabled: boolean;
    streamUrl: string;
    thumbnailIntervalS: number;
  }>;
}

interface RemoteSetupDraftPayload {
  nodeId: string;
  nodeName: string;
  siteId: string;
  hubUrl: string;
  pollIntervalSeconds: number;
  players: RemoteSetupPlayerPayload[];
}

interface RemoteSetupResponse {
  ok?: boolean;
  draft?: RemoteSetupDraftPayload;
  error?: string;
}

interface RemoteProvisionResponse {
  ok?: boolean;
  nodeId?: string;
  siteId?: string;
  agentToken?: string;
  configYaml?: string;
  downloadFileName?: string;
  configPullUrl?: string | null;
  configPullExpiresAt?: string | null;
  updatedAt?: string;
  error?: string;
}

interface InstallHandoffLinkResponse {
  ok?: boolean;
  nodeId?: string;
  nodeName?: string;
  url?: string;
  expiresAt?: string;
  metrics?: {
    createdEvent?: string;
    openedEvent?: string;
  };
  error?: string;
}

interface PlayerFormState {
  playerId: string;
  label: string;
  playoutType: string;
  monitoringEnabled: boolean;
  paths: Record<string, unknown>;
  processSelectorsText: string;
  logSelectorsText: string;
  udpInputsText: string;
  advancedOpen: boolean;
}

interface SetupFormState {
  nodeId: string;
  nodeName: string;
  siteId: string;
  hubUrl: string;
  pollIntervalSeconds: number;
  players: PlayerFormState[];
}

const PLAYOUT_OPTIONS = [
  { id: 'insta', label: 'Indytek Insta', tone: 'Native' },
  { id: 'admax', label: 'Unimedia Admax', tone: 'Native' },
  { id: 'generic_windows', label: 'Generic Windows Playout', tone: 'Generic' },
  { id: 'cinegy_air', label: 'Cinegy Air', tone: 'Generic' },
  { id: 'playbox_neo', label: 'PlayBox Neo AirBox', tone: 'Generic' },
  { id: 'grass_valley_itx', label: 'Grass Valley iTX', tone: 'Generic' },
  { id: 'imagine_versio', label: 'Imagine Versio', tone: 'Generic' },
  { id: 'broadstream_oasys', label: 'BroadStream OASYS', tone: 'Generic' },
  { id: 'pebble_marina', label: 'Pebble Marina', tone: 'Generic' },
  { id: 'evertz_streampro', label: 'Evertz StreamPro / Overture', tone: 'Generic' },
];

function defaultHubUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function prettyJson(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value) && value.length === 0) return fallback;
  if (!Array.isArray(value) && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0) {
    return fallback;
  }
  return JSON.stringify(value, null, 2);
}

function asUdpString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
}

function asUdpBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }
  return fallback;
}

function clampUdpInterval(value: unknown, fallback = 10): number {
  const parsed = Number.parseInt(asUdpString(value), 10);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(300, Math.max(1, normalized));
}

function defaultUdpInput(playerId: string, index: number): RemoteSetupPlayerPayload['udpInputs'][number] {
  const safePlayerId = playerId.trim() || 'player';
  return {
    udpInputId: `${safePlayerId}-udp-${index + 1}`,
    enabled: false,
    streamUrl: '',
    thumbnailIntervalS: 10,
  };
}

function normalizeUdpInput(
  value: unknown,
  playerId: string,
  index: number,
): RemoteSetupPlayerPayload['udpInputs'][number] {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    udpInputId: asUdpString(
      input.udpInputId
      ?? input.udp_input_id
      ?? input.id
      ?? input.input_id,
      `${playerId || 'player'}-udp-${index + 1}`,
    ),
    enabled: asUdpBool(input.enabled, false),
    streamUrl: asUdpString(input.streamUrl ?? input.stream_url),
    thumbnailIntervalS: clampUdpInterval(input.thumbnailIntervalS ?? input.thumbnail_interval_s, 10),
  };
}

function serializeUdpInputs(inputs: RemoteSetupPlayerPayload['udpInputs']): string {
  return JSON.stringify(inputs, null, 2);
}

function parseUdpInputsText(
  udpInputsText: string,
  playerId: string,
): { inputs: RemoteSetupPlayerPayload['udpInputs']; error: string | null } {
  try {
    const parsed = safeJsonArray(udpInputsText, `${playerId || 'Player'} UDP inputs`);
    return {
      inputs: parsed.slice(0, 5).map((entry, index) => normalizeUdpInput(entry, playerId, index)),
      error: null,
    };
  } catch (error) {
    return {
      inputs: [],
      error: error instanceof Error ? error.message : 'UDP inputs must be valid JSON.',
    };
  }
}

function blankPlayer(index: number, nodeId: string): PlayerFormState {
  const safeNode = nodeId.trim() || 'node';
  return {
    playerId: `${safeNode}-player-${index + 1}`,
    label: '',
    playoutType: 'generic_windows',
    monitoringEnabled: true,
    paths: {},
    processSelectorsText: '{}',
    logSelectorsText: '{}',
    udpInputsText: '[]',
    advancedOpen: false,
  };
}

function blankDraft(): SetupFormState {
  return {
    nodeId: '',
    nodeName: '',
    siteId: '',
    hubUrl: defaultHubUrl(),
    pollIntervalSeconds: 5,
    players: [],
  };
}

function playerFromPayload(player: RemoteSetupPlayerPayload): PlayerFormState {
  return {
    playerId: player.playerId,
    label: player.label ?? '',
    playoutType: player.playoutType || 'generic_windows',
    monitoringEnabled: player.monitoringEnabled ?? true,
    paths: player.paths ?? {},
    processSelectorsText: prettyJson(player.processSelectors ?? {}, '{}'),
    logSelectorsText: prettyJson(player.logSelectors ?? {}, '{}'),
    udpInputsText: prettyJson(player.udpInputs ?? [], '[]'),
    advancedOpen: false,
  };
}

function draftFromPayload(payload: RemoteSetupDraftPayload): SetupFormState {
  return {
    nodeId: payload.nodeId ?? '',
    nodeName: payload.nodeName ?? '',
    siteId: payload.siteId ?? '',
    hubUrl: payload.hubUrl ?? defaultHubUrl(),
    pollIntervalSeconds: payload.pollIntervalSeconds ?? 5,
    players: Array.isArray(payload.players) ? payload.players.map(playerFromPayload) : [],
  };
}

function safeJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function safeJsonArray(text: string, label: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`);
  }

  return parsed;
}

function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function readPathValue(paths: Record<string, unknown>, key: string): string {
  const direct = paths[key];
  if (typeof direct === 'string') return direct;

  if (key === 'admax_root') {
    const candidates = paths.admax_root_candidates;
    if (Array.isArray(candidates) && typeof candidates[0] === 'string') {
      return candidates[0];
    }
  }

  return '';
}

function summaryTone(player: PlayerFormState): string {
  if (!player.monitoringEnabled) return 'Monitoring off';
  return player.advancedOpen ? 'Advanced open' : 'Ready';
}

export function RemoteSetupPanel() {
  const [form, setForm] = useState<SetupFormState>(() => blankDraft());
  const [importing, setImporting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastProvision, setLastProvision] = useState<RemoteProvisionResponse | null>(null);
  const [handoffLink, setHandoffLink] = useState<InstallHandoffLinkResponse | null>(null);
  const [creatingHandoffLink, setCreatingHandoffLink] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const stats = useMemo(() => ({
    players: form.players.length,
    monitoringOff: form.players.filter((player) => !player.monitoringEnabled).length,
    advancedOpen: form.players.filter((player) => player.advancedOpen).length,
  }), [form.players]);

  const requestHeaders = (contentType = true): HeadersInit => {
    const headers = new Headers();
    if (contentType) {
      headers.set('Content-Type', 'application/json');
    }
    return headers;
  };

  const updateForm = <K extends keyof SetupFormState>(key: K, value: SetupFormState[K]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const updatePlayer = (index: number, patch: Partial<PlayerFormState>) => {
    setForm((current) => ({
      ...current,
      players: current.players.map((player, playerIndex) => (
        playerIndex === index ? { ...player, ...patch } : player
      )),
    }));
  };

  const updatePlayerPath = (index: number, key: string, value: string) => {
    setForm((current) => ({
      ...current,
      players: current.players.map((player, playerIndex) => {
        if (playerIndex !== index) return player;

        const nextPaths = { ...player.paths };
        if (key === 'admax_root') {
          if (value.trim()) {
            nextPaths.admax_root_candidates = [value];
          } else {
            delete nextPaths.admax_root_candidates;
          }
        } else if (value.trim()) {
          nextPaths[key] = value;
        } else {
          delete nextPaths[key];
        }

        return {
          ...player,
          paths: nextPaths,
        };
      }),
    }));
  };

  const addUdpInput = (index: number) => {
    setForm((current) => ({
      ...current,
      players: current.players.map((player, playerIndex) => {
        if (playerIndex !== index) return player;

        const { inputs } = parseUdpInputsText(player.udpInputsText, player.playerId);
        if (inputs.length >= 5) return player;

        return {
          ...player,
          udpInputsText: serializeUdpInputs([...inputs, defaultUdpInput(player.playerId, inputs.length)]),
        };
      }),
    }));
  };

  const updateUdpInput = (
    index: number,
    udpIndex: number,
    patch: Partial<RemoteSetupPlayerPayload['udpInputs'][number]>,
  ) => {
    setForm((current) => ({
      ...current,
      players: current.players.map((player, playerIndex) => {
        if (playerIndex !== index) return player;

        const { inputs } = parseUdpInputsText(player.udpInputsText, player.playerId);
        return {
          ...player,
          udpInputsText: serializeUdpInputs(
            inputs.map((udpInput, currentIndex) => (
              currentIndex === udpIndex ? { ...udpInput, ...patch } : udpInput
            )),
          ),
        };
      }),
    }));
  };

  const removeUdpInput = (index: number, udpIndex: number) => {
    setForm((current) => ({
      ...current,
      players: current.players.map((player, playerIndex) => {
        if (playerIndex !== index) return player;

        const { inputs } = parseUdpInputsText(player.udpInputsText, player.playerId);
        return {
          ...player,
          udpInputsText: serializeUdpInputs(inputs.filter((_, currentIndex) => currentIndex !== udpIndex)),
        };
      }),
    }));
  };

  const addPlayer = () => {
    setForm((current) => ({
      ...current,
      players: [...current.players, blankPlayer(current.players.length, current.nodeId)],
    }));
  };

  const removePlayer = (index: number) => {
    setForm((current) => ({
      ...current,
      players: current.players.filter((_, playerIndex) => playerIndex !== index),
    }));
  };

  const clearForm = () => {
    setForm(blankDraft());
    setLastProvision(null);
    setHandoffLink(null);
    setNotice('Remote setup form cleared.');
    setError(null);
  };

  const importReport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);
    setNotice(null);

    try {
      const reportText = await file.text();
      const response = await fetch('/api/config/remote/import-report', {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({
          reportText,
          hubUrl: form.hubUrl || defaultHubUrl(),
        }),
      });
      const payload = await response.json() as RemoteSetupResponse;
      if (!response.ok || !payload.draft) {
        throw new Error(String(payload?.error ?? 'Failed to import discovery report.'));
      }

      setForm(draftFromPayload(payload.draft));
      setLastProvision(null);
      setNotice(`Imported ${file.name}. Review the node details and provision when ready.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import discovery report.');
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  };

  const buildProvisionPayload = (): RemoteSetupDraftPayload => ({
    nodeId: form.nodeId.trim(),
    nodeName: form.nodeName.trim(),
    siteId: form.siteId.trim(),
    hubUrl: form.hubUrl.trim(),
    pollIntervalSeconds: Math.max(1, Math.min(120, Number(form.pollIntervalSeconds) || 5)),
    players: form.players.map((player) => ({
      playerId: player.playerId.trim(),
      label: player.label.trim(),
      playoutType: player.playoutType,
      monitoringEnabled: player.monitoringEnabled,
      paths: player.paths,
      processSelectors: safeJsonObject(player.processSelectorsText, `${player.playerId || 'Player'} process selectors`),
      logSelectors: safeJsonObject(player.logSelectorsText, `${player.playerId || 'Player'} log selectors`),
      udpInputs: safeJsonArray(player.udpInputsText, `${player.playerId || 'Player'} UDP inputs`) as RemoteSetupPlayerPayload['udpInputs'],
    })),
  });

  const provision = async () => {
    setProvisioning(true);
    setError(null);
    setNotice(null);
    setCopyNotice(null);

    try {
      const draft = buildProvisionPayload();

      const response = await fetch('/api/config/remote/provision', {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({ draft }),
      });
      const payload = await response.json() as RemoteProvisionResponse;
      if (!response.ok || !payload.ok || !payload.configYaml || !payload.downloadFileName) {
        throw new Error(String(payload?.error ?? 'Failed to provision remote node setup.'));
      }

      downloadTextFile(payload.downloadFileName, payload.configYaml);
      setLastProvision(payload);
      setHandoffLink(null);
      setNotice(`Provisioned ${payload.nodeId}. The node config downloaded with a fresh agent token.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to provision remote node setup.');
    } finally {
      setProvisioning(false);
    }
  };

  const copyConfigPullLink = async () => {
    if (!lastProvision?.configPullUrl) return;
    try {
      await copyTextToClipboard(lastProvision.configPullUrl);
      setCopyNotice('Secure config link copied.');
    } catch {
      setCopyNotice('Copy failed. Select the link and copy it manually.');
    }
  };

  const createInstallHandoffLink = async () => {
    if (!lastProvision?.nodeId) return;

    setCreatingHandoffLink(true);
    setError(null);
    setNotice(null);
    setCopyNotice(null);

    try {
      const response = await fetch('/api/config/remote/install-handoff-link', {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({ nodeId: lastProvision.nodeId }),
      });
      const payload = await response.json() as InstallHandoffLinkResponse;
      if (!response.ok || !payload.ok || !payload.url || !payload.expiresAt) {
        throw new Error(String(payload?.error ?? 'Failed to create the install handoff link.'));
      }

      setHandoffLink(payload);
      setNotice(`Install handoff page ready for ${payload.nodeName ?? payload.nodeId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the install handoff link.');
    } finally {
      setCreatingHandoffLink(false);
    }
  };

  const copyInstallHandoffLink = async () => {
    if (!handoffLink?.url) return;
    try {
      await copyTextToClipboard(handoffLink.url);
      setCopyNotice('Install handoff link copied.');
    } catch {
      setCopyNotice('Copy failed. Select the handoff link and copy it manually.');
    }
  };

  return (
    <section className="overflow-hidden rounded-[32px] border border-cyan-500/20 bg-[linear-gradient(135deg,rgba(3,15,29,0.96),rgba(8,24,44,0.94)_45%,rgba(21,39,63,0.92))] shadow-[0_28px_90px_rgba(2,12,27,0.42)] backdrop-blur">
      <div className="border-b border-cyan-500/15 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
              Remote Setup
            </div>
            <h2 className="mt-3 text-xl font-semibold text-white sm:text-2xl">Provision nodes from the remote dashboard</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Upload a discovery report, keep advanced selector fields folded until you need them, and generate a ready-to-download node config with a fresh agent token.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Players</p>
              <p className="mt-1 text-lg font-semibold text-white">{stats.players}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Monitoring Off</p>
              <p className="mt-1 text-lg font-semibold text-white">{stats.monitoringOff}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Advanced Open</p>
              <p className="mt-1 text-lg font-semibold text-white">{stats.advancedOpen}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-800/80 bg-slate-950/40 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-700 bg-slate-950/65 px-4 py-3 text-sm text-slate-300 transition-colors hover:border-cyan-400/50">
                <input
                  type="file"
                  accept=".json,.yaml,.yml,.txt"
                  className="hidden"
                  onChange={(event) => void importReport(event)}
                />
                {importing ? 'Importing report...' : 'Upload discovery report'}
              </label>

              <button
                type="button"
                onClick={addPlayer}
                className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100 transition-colors hover:border-emerald-400 hover:bg-emerald-500/16"
              >
                Add player
              </button>

              <button
                type="button"
                onClick={clearForm}
                className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-semibold text-slate-100 transition-colors hover:border-slate-500 hover:text-white"
              >
                Clear form
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800/80 bg-slate-950/40 p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-200">Node Identity</h3>
              <p className="mt-1 text-sm text-slate-400">Uploaded reports can fill these automatically, but you can edit them before provisioning.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Node ID</span>
                <input
                  type="text"
                  value={form.nodeId}
                  onChange={(event) => updateForm('nodeId', event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
              <label>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Node Name</span>
                <input
                  type="text"
                  value={form.nodeName}
                  onChange={(event) => updateForm('nodeName', event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
              <label>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Site ID</span>
                <input
                  type="text"
                  value={form.siteId}
                  onChange={(event) => updateForm('siteId', event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
              <label>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Hub URL</span>
                <input
                  type="text"
                  value={form.hubUrl}
                  onChange={(event) => updateForm('hubUrl', event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
              <label className="md:max-w-[220px]">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Poll Interval</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={form.pollIntervalSeconds}
                  onChange={(event) => updateForm('pollIntervalSeconds', Number(event.target.value) || 5)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
            </div>
          </div>

          <div className="space-y-4">
            {form.players.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/35 px-5 py-8 text-center">
                <p className="text-base font-medium text-slate-200">No players added yet.</p>
                <p className="mt-2 text-sm text-slate-400">
                  Upload a discovery report or start with <span className="font-medium text-slate-200">Add player</span>.
                </p>
              </div>
            )}
            {form.players.map((player, index) => {
              const isInsta = player.playoutType === 'insta';
              const isAdmax = player.playoutType === 'admax';
              const primaryPathKey = isInsta ? 'shared_log_dir' : isAdmax ? 'admax_root' : 'log_path';
              const secondaryPathKey = isInsta ? 'instance_root' : isAdmax ? 'fnf_log' : 'fnf_log';
              const tertiaryPathKey = isInsta ? 'fnf_log' : 'playlistscan_log';
              const udpEditor = parseUdpInputsText(player.udpInputsText, player.playerId);

              return (
                <article
                  key={`${player.playerId}-${index}`}
                  className="rounded-3xl border border-slate-800/80 bg-[linear-gradient(180deg,rgba(12,22,38,0.92),rgba(9,18,31,0.88))] p-4 shadow-[0_16px_50px_rgba(2,12,27,0.18)]"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                          Player {index + 1}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                          player.monitoringEnabled
                            ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-100'
                            : 'border-amber-500/35 bg-amber-500/12 text-amber-100'
                        }`}>
                          {summaryTone(player)}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-slate-400">
                        Monitoring can be disabled per player before the node ever comes online.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => updatePlayer(index, { monitoringEnabled: !player.monitoringEnabled })}
                        className={`rounded-2xl border px-4 py-2 text-sm font-semibold transition-colors ${
                          player.monitoringEnabled
                            ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-100 hover:border-emerald-400'
                            : 'border-slate-700 bg-slate-900/80 text-slate-100 hover:border-slate-500'
                        }`}
                      >
                        {player.monitoringEnabled ? 'Monitoring enabled' : 'Monitoring disabled'}
                      </button>
                      <button
                        type="button"
                        onClick={() => updatePlayer(index, { advancedOpen: !player.advancedOpen })}
                        className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:border-cyan-400/45"
                      >
                        {player.advancedOpen ? 'Hide advanced' : 'Advanced'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removePlayer(index)}
                        className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 transition-colors hover:border-red-400/45"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <label>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Player ID</span>
                      <input
                        type="text"
                        value={player.playerId}
                        onChange={(event) => updatePlayer(index, { playerId: event.target.value })}
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                      />
                    </label>
                    <label>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Display Label</span>
                      <input
                        type="text"
                        value={player.label}
                        onChange={(event) => updatePlayer(index, { label: event.target.value })}
                        placeholder="Optional override"
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400"
                      />
                    </label>
                    <label>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Playout Profile</span>
                      <select
                        value={player.playoutType}
                        onChange={(event) => updatePlayer(index, { playoutType: event.target.value })}
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                      >
                        {PLAYOUT_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label} ({option.tone})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/65 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Remote Summary</p>
                      <p className="mt-2 text-sm text-slate-300">
                        {player.monitoringEnabled ? 'Alarms and health will be active for this player.' : 'This player is created on the hub with monitoring disabled.'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    <label>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {isInsta ? 'Shared Log Dir' : isAdmax ? 'Admax Root' : 'Primary Log Path'}
                      </span>
                      <input
                        type="text"
                        value={readPathValue(player.paths, primaryPathKey)}
                        onChange={(event) => updatePlayerPath(index, primaryPathKey, event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                      />
                    </label>

                    <label>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {isInsta ? 'Instance Root' : isAdmax ? 'FNF Log' : 'Content Error Log'}
                      </span>
                      <input
                        type="text"
                        value={readPathValue(player.paths, secondaryPathKey)}
                        onChange={(event) => updatePlayerPath(index, secondaryPathKey, event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                      />
                    </label>

                    <label>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {isInsta ? 'FNF Log' : 'Scan Log'}
                      </span>
                      <input
                        type="text"
                        value={readPathValue(player.paths, tertiaryPathKey)}
                        onChange={(event) => updatePlayerPath(index, tertiaryPathKey, event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                      />
                    </label>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">UDP Inputs</p>
                        <p className="mt-2 text-sm text-slate-300">
                          Add up to 5 optional stream probes for this player and turn each one on or off here.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addUdpInput(index)}
                        disabled={udpEditor.inputs.length >= 5}
                        className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition-colors hover:border-emerald-400 hover:bg-emerald-500/16 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Add stream
                      </button>
                    </div>

                    {udpEditor.error ? (
                      <div className="mt-3 rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
                        {udpEditor.error}
                      </div>
                    ) : udpEditor.inputs.length === 0 ? (
                      <div className="mt-3 rounded-2xl border border-dashed border-slate-700 bg-slate-950/35 px-4 py-5 text-sm text-slate-400">
                        No UDP streams added for this player yet.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {udpEditor.inputs.map((udpInput, udpIndex) => (
                          <div
                            key={`${udpInput.udpInputId}-${udpIndex}`}
                            className={`rounded-2xl border p-4 ${udpInput.enabled
                              ? 'border-emerald-500/25 bg-emerald-500/8'
                              : 'border-slate-700 bg-slate-900/70'
                            }`}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-slate-100">Stream {udpIndex + 1}</p>
                                <p className="mt-1 text-xs text-slate-400">
                                  {udpInput.enabled
                                    ? 'Monitoring is active for this UDP stream.'
                                    : 'Saved but disabled until you turn monitoring on.'}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => updateUdpInput(index, udpIndex, { enabled: !udpInput.enabled })}
                                  className={`rounded-2xl border px-4 py-2 text-sm font-semibold transition-colors ${udpInput.enabled
                                    ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-100 hover:border-emerald-400'
                                    : 'border-slate-700 bg-slate-900/80 text-slate-100 hover:border-slate-500'
                                  }`}
                                >
                                  {udpInput.enabled ? 'Monitoring on' : 'Monitoring off'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeUdpInput(index, udpIndex)}
                                  className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 transition-colors hover:border-red-400/45"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                              <label>
                                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Stream ID</span>
                                <input
                                  type="text"
                                  value={udpInput.udpInputId}
                                  onChange={(event) => updateUdpInput(index, udpIndex, { udpInputId: event.target.value })}
                                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                                />
                              </label>
                              <label>
                                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Thumbnail Interval (Seconds)</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={300}
                                  value={udpInput.thumbnailIntervalS}
                                  onChange={(event) => updateUdpInput(index, udpIndex, {
                                    thumbnailIntervalS: clampUdpInterval(event.target.value, 10),
                                  })}
                                  disabled={!udpInput.enabled}
                                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                                />
                              </label>
                            </div>

                            <label className="mt-3 block">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Stream URL</span>
                              <input
                                type="text"
                                value={udpInput.streamUrl}
                                onChange={(event) => updateUdpInput(index, udpIndex, { streamUrl: event.target.value })}
                                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {player.advancedOpen && (
                    <div className="mt-4 grid gap-3 xl:grid-cols-3">
                      <label className="xl:col-span-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Playlist / Secondary Log</span>
                        <input
                          type="text"
                          value={readPathValue(player.paths, 'playlistscan_log')}
                          onChange={(event) => updatePlayerPath(index, 'playlistscan_log', event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                        />
                      </label>

                      <label className="xl:col-span-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Process Selectors JSON</span>
                        <textarea
                          value={player.processSelectorsText}
                          onChange={(event) => updatePlayer(index, { processSelectorsText: event.target.value })}
                          className="mt-2 min-h-[180px] w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                        />
                      </label>

                      <label className="xl:col-span-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Log Selectors JSON</span>
                        <textarea
                          value={player.logSelectorsText}
                          onChange={(event) => updatePlayer(index, { logSelectorsText: event.target.value })}
                          className="mt-2 min-h-[180px] w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                        />
                      </label>

                      <label className="xl:col-span-3">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">UDP Inputs JSON (Advanced)</span>
                        <textarea
                          value={player.udpInputsText}
                          onChange={(event) => updatePlayer(index, { udpInputsText: event.target.value })}
                          className="mt-2 min-h-[180px] w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                        />
                      </label>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void provision()}
            disabled={provisioning}
            className="w-full rounded-3xl border border-amber-400/35 bg-amber-400/12 px-5 py-4 text-base font-semibold text-amber-50 transition-colors hover:border-amber-300 hover:bg-amber-400/18 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {provisioning ? 'Provisioning node...' : 'Provision node and download config'}
          </button>
        </div>

        <aside className="space-y-5">
          <div className="rounded-3xl border border-slate-800/80 bg-slate-950/40 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-200">How this flow works</h3>
            <div className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
              <p>1. Upload a discovery report from a Windows node, or build the node draft manually.</p>
              <p>2. Keep advanced selectors hidden unless the player needs custom matching. UDP inputs stay visible in each player card.</p>
              <p>3. Provisioning uses your signed-in tenant, mirrors the node config, rotates a fresh agent token, and downloads a ready YAML config for the node.</p>
            </div>
          </div>

          {lastProvision && (
            <div className="rounded-3xl border border-emerald-500/25 bg-emerald-500/10 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-50">Last Provision</h3>
              <div className="mt-3 space-y-2 text-sm text-emerald-100">
                <p>Node: {lastProvision.nodeId}</p>
                <p>Site: {lastProvision.siteId}</p>
                <p>Updated: {lastProvision.updatedAt ?? 'just now'}</p>
                <p>Agent token issued and bundled into the downloaded config.</p>
              </div>
              {lastProvision.configPullUrl && (
                <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-slate-950/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/80">Secure config link</p>
                  <p className="mt-2 text-sm leading-6 text-emerald-50">
                    Paste this into the node&apos;s local UI to pull the provisioned <code>config.yaml</code> directly.
                  </p>
                  <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-cyan-100">
                    {lastProvision.configPullUrl}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void copyConfigPullLink()}
                      className="rounded-full border border-emerald-400/35 bg-emerald-400/12 px-4 py-2 text-sm font-semibold text-emerald-50 transition-colors hover:border-emerald-300"
                    >
                      Copy secure config link
                    </button>
                    <span className="text-xs text-emerald-100/70">
                      Expires: {lastProvision.configPullExpiresAt ?? 'shortly'}
                    </span>
                  </div>
                </div>
              )}
              <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-slate-950/60 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-100/80">Shareable install handoff</p>
                <p className="mt-2 text-sm leading-6 text-cyan-50">
                  Create one public handoff page with the installer and this node&apos;s secure config link so a field operator can finish setup without signing in.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void createInstallHandoffLink()}
                    disabled={creatingHandoffLink}
                    className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {creatingHandoffLink ? 'Creating handoff page...' : 'Create install handoff page'}
                  </button>
                  {handoffLink?.metrics?.createdEvent && (
                    <span className="text-xs text-cyan-100/70">Metric: {handoffLink.metrics.createdEvent}</span>
                  )}
                </div>
                {handoffLink?.url && (
                  <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-slate-950 p-4">
                    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-cyan-100">
                      {handoffLink.url}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void copyInstallHandoffLink()}
                        className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
                      >
                        Copy handoff link
                      </button>
                      <span className="text-xs text-cyan-100/70">Expires: {handoffLink.expiresAt}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {notice && (
            <div className="rounded-3xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-50">
              {notice}
            </div>
          )}

          {copyNotice && (
            <div className="rounded-3xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
              {copyNotice}
            </div>
          )}

          {error && (
            <div className="rounded-3xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
