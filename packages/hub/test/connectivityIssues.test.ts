import assert from 'node:assert/strict';
import test from 'node:test';
import { describeConnectivityIssue } from '../src/services/connectivityIssues';

test('describeConnectivityIssue reports delayed heartbeats with the last known network evidence', () => {
  const issue = describeConnectivityIssue({
    connectivityHealth: 'offline',
    lastHeartbeatAt: '2026-04-06T15:00:00.000Z',
    currentTime: new Date('2026-04-06T15:03:05.000Z'),
    observations: {
      gateway_up: 1,
      internet_up: 0,
    },
  });

  assert.equal(
    issue,
    'No heartbeat received for 3m 5s. The last node connectivity check reached the local gateway but not the public internet.',
  );
});

test('describeConnectivityIssue reports fresh node-side outages without framing them as player failures', () => {
  const issue = describeConnectivityIssue({
    connectivityHealth: 'offline',
    lastHeartbeatAt: '2026-04-06T15:03:00.000Z',
    currentTime: new Date('2026-04-06T15:03:05.000Z'),
    observations: {
      gateway_up: 0,
      internet_up: 0,
    },
  });

  assert.equal(
    issue,
    'The node reported a network outage in the latest heartbeat. The last node connectivity check could not reach the local gateway or the public internet.',
  );
});
