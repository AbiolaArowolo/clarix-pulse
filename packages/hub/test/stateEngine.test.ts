import assert from 'node:assert/strict';
import test from 'node:test';
import { computeHealth } from '../src/services/stateEngine';

test('computeHealth treats native stopped flags as authoritative even when a shared process is still up', () => {
  const result = computeHealth(
    {
      playout_process_up: 1,
      insta_running_flag: 0,
      insta_runtime_state: 'stopped',
    },
    false,
  );

  assert.equal(result.runtimeHealth, 'stopped');
  assert.equal(result.broadcastHealth, 'degraded');
});

test('computeHealth escalates a persisted paused runtime to off-air-likely after 60 seconds', () => {
  const now = new Date('2026-04-06T14:00:00.000Z');
  const result = computeHealth(
    {
      playout_process_up: 1,
      insta_pause_flag: 1,
      insta_runtime_state: 'paused',
    },
    false,
    {
      currentTime: now,
      previousRuntimeHealth: 'paused',
      previousRuntimeStartedAt: '2026-04-06T13:58:50.000Z',
      previousBroadcastHealth: 'degraded',
      previousBroadcastStartedAt: '2026-04-06T13:58:50.000Z',
    },
  );

  assert.equal(result.runtimeHealth, 'paused');
  assert.equal(result.broadcastHealth, 'off_air_likely');
});

test('computeHealth classifies repeated static native position polls as paused before the red threshold', () => {
  const result = computeHealth(
    {
      playout_process_up: 1,
      position_signal_present: 1,
      position_static_polls: 2,
      filebar_position_delta_poll: 0,
      filebar_position_delta_30s: 0,
    },
    false,
  );

  assert.equal(result.runtimeHealth, 'paused');
  assert.equal(result.broadcastHealth, 'degraded');
});

test('computeHealth clears paused latch when static position persists but CPU activity proves playback resumed', () => {
  const result = computeHealth(
    {
      playout_process_up: 1,
      position_signal_present: 1,
      position_static_polls: 250,
      filebar_position_delta_poll: 0,
      playout_cpu_usage_ratio_poll: 1.2,
    },
    false,
    {
      previousRuntimeHealth: 'paused',
      previousRuntimeStartedAt: '2026-04-06T13:58:50.000Z',
      previousBroadcastHealth: 'degraded',
      previousBroadcastStartedAt: '2026-04-06T13:58:50.000Z',
    },
  );

  assert.equal(result.runtimeHealth, 'healthy');
  assert.equal(result.broadcastHealth, 'healthy');
});

test('computeHealth clears stale stop token pause when CPU activity proves playback resumed', () => {
  const result = computeHealth(
    {
      playout_process_up: 1,
      log_last_token: 'stopxxx2',
      log_last_token_fresh: 0,
      playout_cpu_usage_ratio_poll: 1.1,
    },
    false,
    {
      previousRuntimeHealth: 'paused',
      previousRuntimeStartedAt: '2026-04-06T13:58:50.000Z',
      previousBroadcastHealth: 'degraded',
      previousBroadcastStartedAt: '2026-04-06T13:58:50.000Z',
    },
  );

  assert.equal(result.runtimeHealth, 'healthy');
  assert.equal(result.broadcastHealth, 'healthy');
});

test('computeHealth keeps player health separate from a network outage reported by the node', () => {
  const result = computeHealth(
    {
      playout_process_up: 1,
      filebar_position_delta_poll: 12,
      gateway_up: 0,
      internet_up: 0,
    },
    false,
  );

  assert.equal(result.runtimeHealth, 'healthy');
  assert.equal(result.broadcastHealth, 'healthy');
  assert.equal(result.connectivityHealth, 'offline');
});

test('computeHealth ignores stale reinit token once process is back up', () => {
  const result = computeHealth(
    {
      playout_process_up: 1,
      log_last_token: 'reinit',
      log_last_token_fresh: 0,
    },
    false,
    {
      previousRuntimeHealth: 'restarting',
      previousRuntimeStartedAt: '2026-04-06T13:58:50.000Z',
      previousBroadcastHealth: 'degraded',
      previousBroadcastStartedAt: '2026-04-06T13:58:50.000Z',
    },
  );

  assert.equal(result.runtimeHealth, 'healthy');
  assert.equal(result.broadcastHealth, 'healthy');
});

test('computeHealth ignores stale app_exited token once process is back up', () => {
  const result = computeHealth(
    {
      playout_process_up: 1,
      log_last_token: 'app_exited',
      log_last_token_fresh: 0,
    },
    false,
    {
      previousRuntimeHealth: 'restarting',
      previousRuntimeStartedAt: '2026-04-06T13:58:50.000Z',
      previousBroadcastHealth: 'degraded',
      previousBroadcastStartedAt: '2026-04-06T13:58:50.000Z',
    },
  );

  assert.equal(result.runtimeHealth, 'healthy');
  assert.equal(result.broadcastHealth, 'healthy');
});

test('computeHealth keeps fresh pause token from forcing paused when CPU proves active playback', () => {
  const result = computeHealth(
    {
      playout_process_up: 1,
      log_last_token: 'paused',
      log_last_token_fresh: 1,
      playout_cpu_usage_ratio_poll: 1.1,
    },
    false,
  );

  assert.equal(result.runtimeHealth, 'healthy');
  assert.equal(result.broadcastHealth, 'healthy');
});

test('computeHealth keeps stale running flag from forcing stopped when CPU proves active playback', () => {
  const result = computeHealth(
    {
      playout_process_up: 1,
      insta_running_flag: 0,
      playout_cpu_usage_ratio_poll: 1.2,
    },
    false,
  );

  assert.equal(result.runtimeHealth, 'healthy');
  assert.equal(result.broadcastHealth, 'healthy');
});

test('computeHealth does not use previous broadcast age to escalate a newly paused runtime to off-air', () => {
  const now = new Date('2026-04-06T14:00:00.000Z');
  const result = computeHealth(
    {
      playout_process_up: 1,
      insta_pause_flag: 1,
      insta_runtime_state: 'paused',
    },
    false,
    {
      currentTime: now,
      previousRuntimeHealth: 'paused',
      previousRuntimeStartedAt: '2026-04-06T13:59:50.000Z',
      previousBroadcastHealth: 'degraded',
      previousBroadcastStartedAt: '2026-04-06T13:49:50.000Z',
    },
  );

  assert.equal(result.runtimeHealth, 'paused');
  assert.equal(result.broadcastHealth, 'degraded');
});

test('computeHealth does not escalate first UDP fault to confirmed when previous degraded state was runtime-driven', () => {
  const now = new Date('2026-04-06T14:00:00.000Z');
  const result = computeHealth(
    {
      playout_process_up: 1,
      filebar_position_delta_poll: 1,
      output_signal_present: 0,
    },
    true,
    {
      currentTime: now,
      previousRuntimeHealth: 'paused',
      previousRuntimeStartedAt: '2026-04-06T13:50:00.000Z',
      previousBroadcastHealth: 'degraded',
      previousBroadcastStartedAt: '2026-04-06T13:50:00.000Z',
    },
  );

  assert.equal(result.runtimeHealth, 'healthy');
  assert.equal(result.broadcastHealth, 'degraded');
});

test('computeHealth keeps UDP confirmed off-air latched while the same UDP fault persists', () => {
  const now = new Date('2026-04-06T14:00:00.000Z');
  const result = computeHealth(
    {
      playout_process_up: 1,
      filebar_position_delta_poll: 1,
      output_signal_present: 0,
      udp_enabled: 1,
      udp_input_count: 1,
    },
    true,
    {
      currentTime: now,
      previousRuntimeHealth: 'healthy',
      previousRuntimeStartedAt: '2026-04-06T13:59:00.000Z',
      previousBroadcastHealth: 'off_air_confirmed',
      previousBroadcastStartedAt: '2026-04-06T13:59:45.000Z',
    },
  );

  assert.equal(result.runtimeHealth, 'healthy');
  assert.equal(result.broadcastHealth, 'off_air_confirmed');
});
