// State Engine - sole authority for computing all three health domains.
// Receives raw observations from agents, emits broadcast_health + runtime_health + connectivity_health.

import { BroadcastHealth, RuntimeHealth, ConnectivityHealth } from '../store/db';

const UDP_RED_AFTER_SECONDS = 40;
const UDP_FREEZE_WARNING_SECONDS = 2;
const UDP_SILENCE_WARNING_SECONDS = 8;
const RUNTIME_PAUSED_RED_AFTER_SECONDS = 60;
const RUNTIME_STOPPED_RED_AFTER_SECONDS = 60;
const RUNTIME_STALLED_RED_AFTER_SECONDS = 45;
const PLAYBACK_CPU_ACTIVE_RATIO = 0.5;
const PERSISTED_RUNTIME_FAULTS: RuntimeHealth[] = ['paused', 'stopped', 'stalled'];

export interface Observations extends Record<string, unknown> {
  // Process
  playout_process_up?: number;
  playout_window_up?: number;
  restart_events_15m?: number;
  playout_cpu_usage_ratio_poll?: number;
  // Log tokens (from agent deep log monitoring)
  log_last_token?: string | null;
  log_last_token_fresh?: number;
  // File state (stall detection)
  filebar_position_delta_poll?: number;
  frame_delta_poll?: number;
  filebar_position_delta_30s?: number;
  frame_delta_30s?: number;
  filebar_position_delta_60s?: number;
  frame_delta_60s?: number;
  position_signal_present?: number;
  position_static_polls?: number;
  // Insta runtime state
  insta_runtime_state?: string | null;
  insta_running_flag?: number;
  insta_pause_flag?: number;
  insta_runningstatus_raw?: string | null;
  insta_mainplaylist_changed_poll?: number;
  insta_mainplaylist_newer_than_log?: number;
  // Content errors
  fnf_new_entries?: number;
  playlistscan_new_entries?: number;
  // UDP output (agent-side, optional)
  output_signal_present?: number;
  output_freeze_seconds?: number;
  output_black_ratio?: number;
  output_audio_silence_seconds?: number;
  udp_enabled?: number;
  udp_input_count?: number;
  udp_healthy_input_count?: number;
  udp_selected_input_id?: string | null;
  // Connectivity
  internet_up?: number;
  gateway_up?: number;
}

export interface HealthComputationContext {
  currentTime?: Date;
  previousBroadcastHealth?: BroadcastHealth;
  previousBroadcastStartedAt?: string | null;
  previousRuntimeHealth?: RuntimeHealth;
  previousRuntimeStartedAt?: string | null;
}

export interface HealthResult {
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  connectivityHealth: ConnectivityHealth;
  broadcastStateAgeSeconds: number;
  runtimeStateAgeSeconds: number;
}

export function computeHealth(
  obs: Observations,
  udpProbeEnabled: boolean,
  context: HealthComputationContext = {}
): HealthResult {
  const runtimeHealth = computeRuntime(obs, context);
  const runtimeStateAgeSeconds = computeStateAgeSeconds(
    runtimeHealth,
    context.previousRuntimeHealth,
    context.previousRuntimeStartedAt,
    context.currentTime
  );
  const broadcastHealth = computeBroadcast(obs, runtimeHealth, runtimeStateAgeSeconds, udpProbeEnabled, context);
  const broadcastStateAgeSeconds = computeStateAgeSeconds(
    broadcastHealth,
    context.previousBroadcastHealth,
    context.previousBroadcastStartedAt,
    context.currentTime
  );
  const connectivityHealth = computeConnectivity(obs);

  return {
    broadcastHealth,
    runtimeHealth,
    connectivityHealth,
    broadcastStateAgeSeconds,
    runtimeStateAgeSeconds,
  };
}

function computeStateAgeSeconds<TState extends string>(
  currentState: TState,
  previousState?: TState,
  previousStartedAt?: string | null,
  currentTime?: Date
): number {
  if (!previousStartedAt || previousState !== currentState) {
    return 0;
  }

  const currentTimeMs = (currentTime ?? new Date()).getTime();
  const previousStartMs = Date.parse(previousStartedAt);
  if (Number.isNaN(previousStartMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((currentTimeMs - previousStartMs) / 1000));
}

function computePersistedUdpFaultAgeSeconds(context: HealthComputationContext): number {
  if (!context.previousBroadcastStartedAt) {
    return 0;
  }

  if (context.previousBroadcastHealth !== 'degraded' && context.previousBroadcastHealth !== 'off_air_confirmed') {
    return 0;
  }

  const currentTimeMs = (context.currentTime ?? new Date()).getTime();
  const previousStartMs = Date.parse(context.previousBroadcastStartedAt);
  if (Number.isNaN(previousStartMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((currentTimeMs - previousStartMs) / 1000));
}

function computePersistedRuntimeFaultAgeSeconds(context: HealthComputationContext): number {
  if (!context.previousBroadcastStartedAt) {
    return 0;
  }

  if (!context.previousRuntimeHealth || !PERSISTED_RUNTIME_FAULTS.includes(context.previousRuntimeHealth)) {
    return 0;
  }

  if (context.previousBroadcastHealth !== 'degraded' && context.previousBroadcastHealth !== 'off_air_likely') {
    return 0;
  }

  const currentTimeMs = (context.currentTime ?? new Date()).getTime();
  const previousStartMs = Date.parse(context.previousBroadcastStartedAt);
  if (Number.isNaN(previousStartMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((currentTimeMs - previousStartMs) / 1000));
}

function computeRuntimeDerivedBroadcastHealth(
  obs: Observations,
  runtimeHealth: RuntimeHealth,
  runtimeStateAgeSeconds: number,
  persistedRuntimeFaultAgeSeconds: number
): BroadcastHealth {
  const runtimeFaultAgeSeconds = Math.max(runtimeStateAgeSeconds, persistedRuntimeFaultAgeSeconds);

  if (isPlayerShutdown(obs)) {
    return 'off_air_likely';
  }

  if (runtimeHealth === 'paused') {
    return runtimeFaultAgeSeconds >= RUNTIME_PAUSED_RED_AFTER_SECONDS ? 'off_air_likely' : 'degraded';
  }
  if (runtimeHealth === 'stopped') {
    return runtimeFaultAgeSeconds >= RUNTIME_STOPPED_RED_AFTER_SECONDS ? 'off_air_likely' : 'degraded';
  }
  if (runtimeHealth === 'stalled') {
    return runtimeFaultAgeSeconds >= RUNTIME_STALLED_RED_AFTER_SECONDS ? 'off_air_likely' : 'degraded';
  }
  if (runtimeHealth === 'restarting') return 'degraded';
  if (runtimeHealth === 'content_error') return 'degraded';
  return 'unknown';
}

function broadcastSeverity(health: BroadcastHealth): number {
  switch (health) {
    case 'off_air_confirmed':
      return 4;
    case 'off_air_likely':
      return 3;
    case 'degraded':
      return 2;
    case 'healthy':
      return 1;
    case 'unknown':
    default:
      return 0;
  }
}

function maxBroadcastHealth(left: BroadcastHealth, right: BroadcastHealth): BroadcastHealth {
  return broadcastSeverity(left) >= broadcastSeverity(right) ? left : right;
}

function hasPlaybackMotion(obs: Observations): boolean {
  const pollDelta = obs.filebar_position_delta_poll ?? obs.frame_delta_poll;
  return pollDelta !== undefined && pollDelta > 0;
}

function hasRepeatedStaticPosition(obs: Observations): boolean {
  return (obs.position_signal_present ?? 0) === 1
    && (obs.position_static_polls ?? 0) >= 2;
}

function hasPlaybackCpuActivity(obs: Observations): boolean {
  return (obs.playout_cpu_usage_ratio_poll ?? 0) >= PLAYBACK_CPU_ACTIVE_RATIO;
}

function hasFreshPlaybackRecoverySignal(obs: Observations): boolean {
  const logToken = typeof obs.log_last_token === 'string'
    ? obs.log_last_token
    : null;
  const logTokenFresh = (obs.log_last_token_fresh ?? 0) === 1;

  if (!logTokenFresh) {
    return false;
  }

  return logToken === 'fully_played' || logToken === 'skipped';
}

function hasInstaPlaylistAdvance(obs: Observations): boolean {
  return (obs.insta_mainplaylist_changed_poll ?? 0) === 1
    || (obs.insta_mainplaylist_newer_than_log ?? 0) === 1;
}

function isPlayerShutdown(obs: Observations): boolean {
  const logToken = typeof obs.log_last_token === 'string'
    ? obs.log_last_token
    : null;
  const logTokenFresh = (obs.log_last_token_fresh ?? 0) === 1;

  return obs.playout_process_up === 0 || (logToken === 'app_exited' && logTokenFresh);
}

function computeRuntime(obs: Observations, context: HealthComputationContext): RuntimeHealth {
  const logToken = typeof obs.log_last_token === 'string'
    ? obs.log_last_token
    : null;
  const logTokenFresh = (obs.log_last_token_fresh ?? 0) === 1;

  // Stopped: process gone
  if (obs.playout_process_up === 0) return 'stopped';

  // Explicit log tokens that are still authoritative
  if (logToken === 'app_exited' && logTokenFresh) return 'stopped';
  if (logToken === 'reinit' && logTokenFresh) return 'restarting';

  const instaRuntimeState = typeof obs.insta_runtime_state === 'string'
    ? obs.insta_runtime_state
    : undefined;
  const explicitStoppedInsta = instaRuntimeState === 'stopped'
    || (obs.insta_running_flag ?? 1) === 0;
  const explicitPausedInsta = instaRuntimeState === 'paused'
    || (obs.insta_pause_flag === 1 && !explicitStoppedInsta);
  const explicitHealthyInsta = instaRuntimeState === 'healthy';
  const playbackMotionDetected = hasPlaybackMotion(obs);
  const playbackCpuActive = hasPlaybackCpuActivity(obs);
  const freshPlaybackRecoverySignal = hasFreshPlaybackRecoverySignal(obs);
  const playlistAdvanceDetected = hasInstaPlaylistAdvance(obs);
  const explicitMotionHealthy = obs.playout_process_up === 1
    && playbackMotionDetected
    && !explicitStoppedInsta
    && !explicitPausedInsta;
  // Some installations stop updating filebar.txt reliably while playback is still healthy.
  // CPU activity is still useful for general healthy-vs-stalled fallback, but on certain
  // Insta installs it is not strong enough to clear a paused latch by itself.
  const pauseRecoveryProven = explicitMotionHealthy || freshPlaybackRecoverySignal || playlistAdvanceDetected;
  const healthyPlaybackProven = pauseRecoveryProven || playbackCpuActive;
  const repeatedStaticPosition = hasRepeatedStaticPosition(obs);
  const keepPausedWhileStatic = context.previousRuntimeHealth === 'paused'
    && obs.playout_process_up === 1
    && !explicitStoppedInsta
    && !pauseRecoveryProven;
  const keepStoppedWhileStatic = context.previousRuntimeHealth === 'stopped'
    && obs.playout_process_up === 1
    && !healthyPlaybackProven;
  const stalePauseShouldWin = logToken === 'paused'
    && !logTokenFresh
    && !pauseRecoveryProven
    && context.previousRuntimeHealth === 'paused';

  if (explicitStoppedInsta) {
    return 'stopped';
  }

  if (logToken === 'paused' && logTokenFresh) {
    return 'paused';
  }

  if (logToken === 'stopxxx2' && (logTokenFresh || (context.previousRuntimeHealth === 'paused' && !pauseRecoveryProven))) {
    return 'paused';
  }

  if (keepStoppedWhileStatic) {
    return 'stopped';
  }

  if (explicitPausedInsta) {
    return 'paused';
  }

  if (repeatedStaticPosition && !pauseRecoveryProven) {
    return 'paused';
  }

  if (explicitMotionHealthy) {
    return 'healthy';
  }

  if (freshPlaybackRecoverySignal) {
    return 'healthy';
  }

  // Fresh log tokens should reflect immediately. A real pause should stay latched
  // until the agent sees playback movement again.
  if (logToken === 'app_exited') {
    return explicitHealthyInsta ? 'healthy' : 'stopped';
  }
  if (logToken === 'reinit') {
    return explicitHealthyInsta ? 'healthy' : 'restarting';
  }
  if (stalePauseShouldWin || keepPausedWhileStatic) {
    return 'paused';
  }

  if (explicitHealthyInsta) {
    return 'healthy';
  }

  // Content error
  if ((obs.fnf_new_entries ?? 0) > 0 || (obs.playlistscan_new_entries ?? 0) > 0) {
    return 'content_error';
  }

  // Stall detection (critical threshold: 60s delta = 0)
  const positionDelta60 = obs.filebar_position_delta_60s ?? obs.frame_delta_60s;
  if (positionDelta60 !== undefined && positionDelta60 === 0 && obs.playout_process_up === 1) {
    if (healthyPlaybackProven) {
      return 'healthy';
    }
    return 'stalled';
  }

  // Restart loop
  if ((obs.restart_events_15m ?? 0) >= 2) return 'restarting';

  // If process is up and no negative signals
  if (obs.playout_process_up === 1) return 'healthy';

  return 'unknown';
}

function computeBroadcast(
  obs: Observations,
  runtimeHealth: RuntimeHealth,
  runtimeStateAgeSeconds: number,
  udpProbeEnabled: boolean,
  context: HealthComputationContext
): BroadcastHealth {
  const persistedRuntimeFaultAgeSeconds = computePersistedRuntimeFaultAgeSeconds(context);
  const runtimeDerivedBroadcastHealth = computeRuntimeDerivedBroadcastHealth(
    obs,
    runtimeHealth,
    runtimeStateAgeSeconds,
    persistedRuntimeFaultAgeSeconds,
  );

  // UDP output signals take priority when enabled.
  if (udpProbeEnabled && obs.output_signal_present !== undefined) {
    const udpFaultDetected = obs.output_signal_present === 0
      || (obs.output_freeze_seconds ?? 0) >= UDP_FREEZE_WARNING_SECONDS
      || (obs.output_black_ratio ?? 0) >= 0.98
      || (obs.output_audio_silence_seconds ?? 0) >= UDP_SILENCE_WARNING_SECONDS;

    if (udpFaultDetected) {
      const udpFaultAgeSeconds = computePersistedUdpFaultAgeSeconds(context);
      const udpDerivedBroadcastHealth = udpFaultAgeSeconds >= UDP_RED_AFTER_SECONDS
        ? 'off_air_confirmed'
        : 'degraded';
      return maxBroadcastHealth(runtimeDerivedBroadcastHealth, udpDerivedBroadcastHealth);
    }

    return maxBroadcastHealth(runtimeDerivedBroadcastHealth, 'healthy');
  }

  // Runtime-derived broadcast health.
  if (runtimeDerivedBroadcastHealth !== 'unknown') {
    return runtimeDerivedBroadcastHealth;
  }

  // Window missing but process present.
  if (obs.playout_process_up === 1 && obs.playout_window_up === 0) {
    if (hasPlaybackCpuActivity(obs)) {
      return 'healthy';
    }
    return 'degraded';
  }

  // Stall warning threshold (30s, not yet critical at 60s).
  const positionDelta30 = obs.filebar_position_delta_30s ?? obs.frame_delta_30s;
  if (positionDelta30 !== undefined && positionDelta30 === 0 && obs.playout_process_up === 1) {
    if (hasPlaybackCpuActivity(obs)) {
      return 'healthy';
    }
    return 'degraded';
  }

  if (runtimeHealth === 'healthy') return 'healthy';

  return 'unknown';
}

function computeConnectivity(obs: Observations): ConnectivityHealth {
  if (obs.gateway_up === 1 && obs.internet_up === 1) return 'online';
  if (obs.gateway_up === 1 && obs.internet_up === 0) return 'online';
  if (obs.gateway_up === 0) return 'offline';
  return 'online';
}
