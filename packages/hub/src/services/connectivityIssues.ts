import { ConnectivityHealth } from '../store/db';

interface ConnectivityIssueInput {
  connectivityHealth: ConnectivityHealth;
  lastHeartbeatAt?: string | null;
  observations?: Record<string, unknown> | null;
  currentTime?: Date;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function describeLastConnectivityCheck(observations?: Record<string, unknown> | null): string {
  const gatewayUp = asNumber(observations?.gateway_up);
  const internetUp = asNumber(observations?.internet_up);

  if (gatewayUp === 0 && internetUp === 0) {
    return 'The last node connectivity check could not reach the local gateway or the public internet.';
  }
  if (gatewayUp === 1 && internetUp === 0) {
    return 'The last node connectivity check reached the local gateway but not the public internet.';
  }
  if (gatewayUp === 0 && internetUp === 1) {
    return 'The last node connectivity check reached the public probe but not the default gateway.';
  }
  if (gatewayUp === 1 && internetUp === 1) {
    return 'The last node connectivity check looked healthy, so the hub may be unreachable from the node or the agent may have stopped reporting.';
  }
  return 'The hub is not receiving fresh heartbeat data from the node.';
}

export function describeConnectivityIssue(input: ConnectivityIssueInput): string | null {
  if (input.connectivityHealth === 'online') {
    return null;
  }

  const lastHeartbeatAt = input.lastHeartbeatAt ? Date.parse(input.lastHeartbeatAt) : Number.NaN;
  const ageSeconds = Number.isNaN(lastHeartbeatAt)
    ? null
    : Math.max(0, Math.floor(((input.currentTime ?? new Date()).getTime() - lastHeartbeatAt) / 1000));
  const connectivityDetail = describeLastConnectivityCheck(input.observations);
  const heartbeatRecentlySeen = ageSeconds !== null && ageSeconds < 15;

  if (input.connectivityHealth === 'stale') {
    if (ageSeconds !== null && ageSeconds > 0) {
      return `Heartbeats are delayed by ${formatDuration(ageSeconds)}. ${connectivityDetail}`;
    }
    return `Heartbeats are delayed from the node. ${connectivityDetail}`;
  }

  if (heartbeatRecentlySeen) {
    return `The node reported a network outage in the latest heartbeat. ${connectivityDetail}`;
  }
  if (ageSeconds !== null && ageSeconds > 0) {
    return `No heartbeat received for ${formatDuration(ageSeconds)}. ${connectivityDetail}`;
  }
  return `No heartbeat is reaching the hub from this node. ${connectivityDetail}`;
}
