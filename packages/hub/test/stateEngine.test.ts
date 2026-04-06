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
