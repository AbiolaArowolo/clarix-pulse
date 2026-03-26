// State Engine — sole authority for computing all three health domains
// Receives raw observations from agents, emits broadcast_health + runtime_health + connectivity_health

import { BroadcastHealth, RuntimeHealth, ConnectivityHealth } from '../store/db';

export interface Observations extends Record<string, unknown> {
  // Process
  playout_process_up?: number;       // 1 or 0
  playout_window_up?: number;        // 1 or 0
  restart_events_15m?: number;       // count
  // Log tokens (from agent deep log monitoring)
  log_last_token?: string | null;    // 'stopxxx2' | 'app_exited' | 'reinit' | null
  // File state (stall detection)
  filebar_position_delta_30s?: number;  // Insta: FilePosition change over 30s
  frame_delta_30s?: number;             // Admax: Frame value change over 30s
  filebar_position_delta_60s?: number;
  frame_delta_60s?: number;
  // Content errors
  fnf_new_entries?: number;          // new lines in FNF log
  playlistscan_new_entries?: number; // new lines in playlistscan log
  // UDP output (agent-side, optional)
  output_signal_present?: number;    // 1 or 0
  output_freeze_seconds?: number;
  output_black_ratio?: number;       // 0.0 to 1.0
  output_audio_silence_seconds?: number;
  // Connectivity
  internet_up?: number;              // 1 or 0
  gateway_up?: number;               // 1 or 0
}

export interface HealthResult {
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  connectivityHealth: ConnectivityHealth;
}

export function computeHealth(obs: Observations, udpProbeEnabled: boolean): HealthResult {
  const runtimeHealth = computeRuntime(obs);
  const broadcastHealth = computeBroadcast(obs, runtimeHealth, udpProbeEnabled);
  const connectivityHealth = computeConnectivity(obs);

  return { broadcastHealth, runtimeHealth, connectivityHealth };
}

function computeRuntime(obs: Observations): RuntimeHealth {
  // Stopped: process gone
  if (obs.playout_process_up === 0) return 'stopped';

  // Check log tokens for explicit state transitions
  if (obs.log_last_token === 'app_exited') return 'stopped';
  if (obs.log_last_token === 'reinit') return 'restarting';
  if (obs.log_last_token === 'stopxxx2') return 'paused';
  if (obs.log_last_token === 'paused') return 'paused';

  // Content error
  if ((obs.fnf_new_entries ?? 0) > 0 || (obs.playlistscan_new_entries ?? 0) > 0) {
    return 'content_error';
  }

  // Stall detection (critical threshold: 60s delta = 0)
  const positionDelta60 = obs.filebar_position_delta_60s ?? obs.frame_delta_60s;
  if (positionDelta60 !== undefined && positionDelta60 === 0 && obs.playout_process_up === 1) {
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
  udpProbeEnabled: boolean
): BroadcastHealth {
  // UDP output signals take priority when enabled and data is present
  if (udpProbeEnabled && obs.output_signal_present !== undefined) {
    if (obs.output_signal_present === 0) return 'off_air_confirmed';
    if ((obs.output_freeze_seconds ?? 0) >= 20) return 'off_air_confirmed';
    if ((obs.output_black_ratio ?? 0) >= 0.98) return 'off_air_confirmed';
  }

  // Runtime-derived broadcast health
  if (runtimeHealth === 'stopped') return 'off_air_likely';
  if (runtimeHealth === 'stalled') return 'off_air_likely';
  if (runtimeHealth === 'paused') return 'degraded';
  if (runtimeHealth === 'restarting') return 'degraded';
  if (runtimeHealth === 'content_error') return 'degraded';

  // Window missing but process present
  if (obs.playout_process_up === 1 && obs.playout_window_up === 0) return 'degraded';

  // Stall warning threshold (30s, not yet critical at 60s)
  const positionDelta30 = obs.filebar_position_delta_30s ?? obs.frame_delta_30s;
  if (positionDelta30 !== undefined && positionDelta30 === 0 && obs.playout_process_up === 1) {
    return 'degraded';
  }

  if (runtimeHealth === 'healthy') return 'healthy';

  return 'unknown';
}

function computeConnectivity(obs: Observations): ConnectivityHealth {
  // Both gateway and internet must be healthy for 'online'
  if (obs.gateway_up === 1 && obs.internet_up === 1) return 'online';
  // Gateway up but no internet — still connected locally
  if (obs.gateway_up === 1 && obs.internet_up === 0) return 'online';
  // No gateway
  if (obs.gateway_up === 0) return 'offline';
  return 'online';
}
