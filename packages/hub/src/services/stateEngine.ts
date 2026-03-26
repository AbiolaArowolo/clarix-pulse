// State Engine - sole authority for computing all three health domains.
// Receives raw observations from agents, emits broadcast_health + runtime_health + connectivity_health.

import { BroadcastHealth, RuntimeHealth, ConnectivityHealth } from '../store/db';

const OFF_AIR_GRACE_SECONDS = 45;

export interface Observations extends Record<string, unknown> {
  // Process
  playout_process_up?: number;
  playout_window_up?: number;
  restart_events_15m?: number;
  // Log tokens (from agent deep log monitoring)
  log_last_token?: string | null;
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
  previousRuntimeHealth?: RuntimeHealth;
  previousRuntimeStartedAt?: string | null;
}

export interface HealthResult {
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  connectivityHealth: ConnectivityHealth;
  runtimeStateAgeSeconds: number;
}

export function computeHealth(
  obs: Observations,
  udpProbeEnabled: boolean,
  context: HealthComputationContext = {}
): HealthResult {
  const runtimeHealth = computeRuntime(obs);
  const runtimeStateAgeSeconds = computeRuntimeStateAgeSeconds(runtimeHealth, context);
  const broadcastHealth = computeBroadcast(obs, runtimeHealth, udpProbeEnabled, runtimeStateAgeSeconds);
  const connectivityHealth = computeConnectivity(obs);

  return { broadcastHealth, runtimeHealth, connectivityHealth, runtimeStateAgeSeconds };
}

function computeRuntimeStateAgeSeconds(
  runtimeHealth: RuntimeHealth,
  context: HealthComputationContext
): number {
  if (!context.previousRuntimeStartedAt || context.previousRuntimeHealth !== runtimeHealth) {
    return 0;
  }

  const currentTimeMs = (context.currentTime ?? new Date()).getTime();
  const previousStartMs = Date.parse(context.previousRuntimeStartedAt);
  if (Number.isNaN(previousStartMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((currentTimeMs - previousStartMs) / 1000));
}

function computeRuntime(obs: Observations): RuntimeHealth {
  // Stopped: process gone
  if (obs.playout_process_up === 0) return 'stopped';

  // Explicit log tokens that are still authoritative
  if (obs.log_last_token === 'app_exited') return 'stopped';
  if (obs.log_last_token === 'reinit') return 'restarting';

  const instaRuntimeState = typeof obs.insta_runtime_state === 'string'
    ? obs.insta_runtime_state
    : undefined;
  const hasExplicitInstaState = instaRuntimeState !== undefined
    || obs.insta_running_flag !== undefined
    || obs.insta_pause_flag !== undefined;

  if (instaRuntimeState === 'paused' || obs.insta_pause_flag === 1) {
    return 'paused';
  }

  if (instaRuntimeState === 'stopped') {
    return 'stopped';
  }

  if (!instaRuntimeState && hasExplicitInstaState && obs.insta_running_flag === 0) {
    return 'stopped';
  }

  // Admax pause token, or Insta pause fallback when no explicit runtime file is available.
  if (obs.log_last_token === 'stopxxx2') return 'paused';
  if (obs.log_last_token === 'paused' && !hasExplicitInstaState) return 'paused';

  // Content error
  if ((obs.fnf_new_entries ?? 0) > 0 || (obs.playlistscan_new_entries ?? 0) > 0) {
    return 'content_error';
  }

  // Stall detection (critical threshold: 60s delta = 0)
  const positionDelta60 = obs.filebar_position_delta_60s ?? obs.frame_delta_60s;
  if (positionDelta60 !== undefined && positionDelta60 === 0 && obs.playout_process_up === 1) {
    // If Insta exposes an explicit healthy runtime flag, trust it over a stale filebar.
    if (instaRuntimeState === 'healthy' || obs.insta_running_flag === 1) {
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
  udpProbeEnabled: boolean,
  runtimeStateAgeSeconds: number
): BroadcastHealth {
  // UDP output signals take priority when enabled and data is present.
  if (udpProbeEnabled && obs.output_signal_present !== undefined) {
    if (obs.output_signal_present === 0) return 'off_air_confirmed';
    if ((obs.output_freeze_seconds ?? 0) >= 20) return 'off_air_confirmed';
    if ((obs.output_black_ratio ?? 0) >= 0.98) return 'off_air_confirmed';
  }

  // Runtime-derived broadcast health with a grace period for pause/stop before red alerting.
  if (runtimeHealth === 'stopped') {
    return runtimeStateAgeSeconds >= OFF_AIR_GRACE_SECONDS ? 'off_air_likely' : 'degraded';
  }
  if (runtimeHealth === 'stalled') return 'off_air_likely';
  if (runtimeHealth === 'paused') {
    return runtimeStateAgeSeconds >= OFF_AIR_GRACE_SECONDS ? 'off_air_likely' : 'degraded';
  }
  if (runtimeHealth === 'restarting') return 'degraded';
  if (runtimeHealth === 'content_error') return 'degraded';

  // Window missing but process present.
  if (obs.playout_process_up === 1 && obs.playout_window_up === 0) return 'degraded';

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
  // Both gateway and internet must be healthy for 'online'
  if (obs.gateway_up === 1 && obs.internet_up === 1) return 'online';
  // Gateway up but no internet - still connected locally
  if (obs.gateway_up === 1 && obs.internet_up === 0) return 'online';
  // No gateway
  if (obs.gateway_up === 0) return 'offline';
  return 'online';
}
