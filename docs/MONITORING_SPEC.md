# Pulse - Monitoring Specification

**Version**: 1.0.0  
**Date**: 2026-03-27

---

## 1. Registry Model

Pulse expects operators to define their own node and player registry.

### Example Reference Registry

| Node ID | Player ID | Site | Software | UDP |
|---|---|---|---|---|
| `site-a-node-1` | `site-a-insta-1` | Site A | Insta | Optional |
| `site-a-node-1` | `site-a-insta-2` | Site A | Insta | Optional |
| `site-a-node-2` | `site-a-admax-1` | Site A | Admax | Optional |
| `site-b-node-1` | `site-b-admax-1` | Site B | Admax | Enabled |
| `site-b-node-1` | `site-b-admax-2` | Site B | Admax | Enabled |
| `site-c-node-1` | `site-c-insta-1` | Site C | Insta | Optional |

A node can carry multiple players. A player can carry multiple UDP inputs. UDP is enabled or disabled per player, not globally per node.

---

## 2. Health State Model

Pulse keeps three independent domains:

### `broadcast_health`

| Value | Meaning |
|---|---|
| `healthy` | High confidence that output is on-air |
| `degraded` | Playback appears active, but warnings exist |
| `off_air_likely` | Strong local runtime evidence of outage |
| `off_air_confirmed` | UDP output probe confirms outage |
| `unknown` | Reporting path is offline or indeterminate |

### `runtime_health`

| Value | Meaning |
|---|---|
| `healthy` | Process and runtime movement look normal |
| `paused` | Runtime explicitly reports pause |
| `restarting` | Restart or re-init behavior detected |
| `stalled` | Process is up but runtime movement is frozen |
| `stopped` | Process is missing or runtime says not running |
| `content_error` | FNF or playlist scan errors detected |
| `unknown` | Not enough evidence |

### `connectivity_health`

| Value | Meaning |
|---|---|
| `online` | Heartbeats are current |
| `stale` | Heartbeats are delayed |
| `offline` | Heartbeats are missing |

---

## 3. Polling Sequence

On each poll interval, the agent runs these checks for each player:

1. process and window presence
2. deep log monitoring
3. local runtime file checks
4. content error log checks
5. connectivity checks
6. optional UDP probe checks
7. heartbeat POST to the hub

---

## 4. Signal Sources

### 4.1 Process and Window Signals

Used to determine whether the monitored playout application is actually running and visible in the session.

### 4.2 Log Signals

Used to detect:

- pause
- fully played
- skip
- restart / re-init
- app exit

### 4.3 Runtime File Signals

Used to detect:

- persistent playback state
- file position or frame advancement
- freezes or stalls

### 4.4 Connectivity Signals

Typical checks:

- default gateway reachability
- public internet reachability

Connectivity failure is tracked separately from playout failure.

### 4.5 UDP Signals

When UDP is enabled for a player, the agent can run:

- presence checks with `ffprobe`
- freeze detection with `ffmpeg`
- black detection with `ffmpeg`
- silence detection with `ffmpeg`
- thumbnail capture with `ffmpeg`

If a player has several enabled inputs, the agent evaluates them as a matrix and reports the best active input as the selected source.

---

## 5. Runtime and Alarm Rules

### 5.1 Connectivity Thresholds

| Condition | Result |
|---|---|
| heartbeat age < 45s | `online` |
| heartbeat age 45-90s | `stale` |
| heartbeat age > 90s | `offline` |

### 5.2 Runtime Escalation Without UDP Confirmation

| Condition | Immediate State | Red Escalation |
|---|---|---|
| explicit pause | `runtime_health=paused`, `broadcast_health=degraded` | after about 60s continuous pause |
| stopped / process missing | `runtime_health=stopped`, `broadcast_health=degraded` | after about 45s continuous stop |
| stalled runtime | `runtime_health=stalled`, `broadcast_health=degraded` | after about 45s continuous stall state |

### 5.3 UDP Escalation

| Condition | Immediate State | Red Escalation |
|---|---|---|
| missing, frozen, black, or silent UDP output | `broadcast_health=degraded` | after about 40s continuous UDP fault |

### 5.4 Recovery

The red alarm clears when the hub receives a healthy heartbeat or, for UDP-enabled players, the first healthy UDP-confirmed sample after the fault clears.

---

## 6. Decision Matrix

| Observation | Broadcast | Runtime |
|---|---|---|
| healthy local and UDP signals | `healthy` | `healthy` |
| explicit pause | `degraded` | `paused` |
| restart tokens or repeated restarts | `degraded` | `restarting` |
| stall evidence | `degraded` | `stalled` |
| process missing | `degraded` then `off_air_likely` if sustained | `stopped` |
| content error logs | `degraded` | `content_error` |
| UDP fault | `degraded` then `off_air_confirmed` if sustained | unchanged |
| reporting path offline | `unknown` | `unknown` |

---

## 7. Alert Policy

### Critical

Used for:

- `off_air_likely`
- `off_air_confirmed`

Examples:

- `OFF AIR: Site A - Admax 1 - output signal missing`
- `OFF AIR LIKELY: Site C - Insta 1 - process missing`

### Warning

Used for:

- `paused`
- `stalled`
- `restarting`
- `content_error`
- `connectivity_health=offline` or `stale`

Examples:

- `DEGRADED: Site A - Insta 2 - paused`
- `NETWORK ISSUE: Site B - Admax 1 - heartbeat missing`

### Recovery

Example:

- `RECOVERED: Site A - Admax 1 - broadcast health restored`

Alerts are deduplicated through the SQLite event store so the same incident does not re-alert on every poll.
