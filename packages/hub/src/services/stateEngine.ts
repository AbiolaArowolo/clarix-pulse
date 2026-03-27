// State Engine - sole authority for computing all three health domains.
// Receives raw observations from agents, emits broadcast_health + runtime_health + connectivity_health.

import { BroadcastHealth, RuntimeHealth, ConnectivityHealth } from '../store/db';

const UDP_RED_AFTER_SECONDS = 40;
const UDP_FREEZE_WARNING_SECONDS = 2;
const UDP_SILENCE_WARNING_SECONDS = 8;
const RUNTIME_STOPPED_RED_AFTER_SECONDS = 45;
const RUNTIME_STALLED_RED_AFTER_SECONDS = 45;
const RUNTIME_PAUSED_RED_AFTER_SECONDS = 60;

export interface Observations extends Record<string, unknown> {
  // Process
  playout_process_up?: number;
  playout_window_up?: number;
  restart_events_15m?: number;
  // Log tokens (from agent deep log monitoring)
  log_last_token?: string | null;
  log_last_token_fresh?: number;
  // File state (stall detection)
  filebar_position_delta_30s?: number;
  frame_delta_30s?: number;
  filebar_position_delta_60s?: number;
  frame_delta_60s?: number;
  // Insta runtime state
  insta_runtime_state?: string | null;
  insta_running_flag?: number;
  insta_pause_flag?: number;
  insta_runningstatus_raw?: string | null;
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
  const runtimeHealth = computeRuntime(obs);
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

function computeRuntime(obs: Observations): RuntimeHealth {
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
  const hasExplicitInstaState = instaRuntimeState !== undefined
    || obs.insta_running_flag !== undefined
    || obs.insta_pause_flag !== undefined;
  const explicitHealthyInsta = instaRuntimeState === 'healthy'
    || (
      hasExplicitInstaState
      && obs.insta_running_flag !== undefined
      && obs.insta_running_flag > 0
      && obs.insta_pause_flag !== 1
    );

  if (instaRuntimeState === 'paused' || obs.insta_pause_flag === 1) {
    return 'paused';
  }

  if (instaRuntimeState === 'stopped') {
    return 'stopped';
  }

  if (!instaRuntimeState && hasExplicitInstaState && obs.insta_running_flag === 0) {
    return 'stopped';
  }

  // Fresh log tokens should reflect immediately. Once Insta reports healthy again,
  // a stale latched pause/restart token must not keep the card stuck in yellow.
  if (logToken === 'app_exited') {
    return explicitHealthyInsta ? 'healthy' : 'stopped';
  }
  if (logToken === 'reinit') {
    return explicitHealthyInsta ? 'healthy' : 'restarting';
  }
  if (logToken === 'stopxxx2' || logToken === 'paused') {
    if (logTokenFresh || !explicitHealthyInsta) {
      return 'paused';
    }
  }

  // Content error
  if ((obs.fnf_new_entries ?? 0) > 0 || (obs.playlistscan_new_entries ?? 0) > 0) {
    return 'content_error';
  }

  // Stall detection (critical threshold: 60s delta = 0)
  const positionDelta60 = obs.filebar_position_delta_60s ?? obs.frame_delta_60s;
  if (positionDelta60 !== undefined && positionDelta60 === 0 && obs.playout_process_up === 1) {
    if (instaRuntimeState === 'healthy' || obs.insta_running_flag === 1) {
      return 'healthy';
    }
    return 'stalled';
  }

  // Restart loop
  if ((obs.restart_events_15m ?? 0) >= 2) return 'restarting';

  if (explicitHealthyInsta) return 'healthy';

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
  // UDP output signals take priority when enabled.
  if (udpProbeEnabled && obs.output_signal_present !== undefined) {
    const udpFaultDetected = obs.output_signal_present === 0
      || (obs.output_freeze_seconds ?? 0) >= UDP_FREEZE_WARNING_SECONDS
      || (obs.output_black_ratio ?? 0) >= 0.98
      || (obs.output_audio_silence_seconds ?? 0) >= UDP_SILENCE_WARNING_SECONDS;

    if (udpFaultDetected) {
      const udpFaultAgeSeconds = computePersistedUdpFaultAgeSeconds(context);
      if (udpFaultAgeSeconds >= UDP_RED_AFTER_SECONDS) {
        return 'off_air_confirmed';
      }
      return 'degraded';
    }

    return 'healthy';
  }

  // Runtime-derived broadcast health.
  if (runtimeHealth === 'stopped') {
    return runtimeStateAgeSeconds >= RUNTIME_STOPPED_RED_AFTER_SECONDS ? 'off_air_likely' : 'degraded';
  }
  if (runtimeHealth === 'stalled') {
    return runtimeStateAgeSeconds >= RUNTIME_STALLED_RED_AFTER_SECONDS ? 'off_air_likely' : 'degraded';
  }
  if (runtimeHealth === 'paused') {
    return runtimeStateAgeSeconds >= RUNTIME_PAUSED_RED_AFTER_SECONDS ? 'off_air_likely' : 'degraded';
  }
  if (runtimeHealth === 'restarting') return 'degraded';
  if (runtimeHealth === 'content_error') return 'degraded';

  // Window missing but process present.
  if (obs.playout_process_up === 1 && obs.playout_window_up === 0) {
    if (obs.insta_runtime_state === 'healthy' || obs.insta_running_flag === 1) {
      return 'healthy';
    }
    return 'degraded';
  }

  // Stall warning threshold (30s, not yet critical at 60s).
  const positionDelta30 = obs.filebar_position_delta_30s ?? obs.frame_delta_30s;
  if (positionDelta30 !== undefined && positionDelta30 === 0 && obs.playout_process_up === 1) {
    if (obs.insta_runtime_state === 'healthy' || obs.insta_running_flag === 1) {
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
