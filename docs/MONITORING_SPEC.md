# Pulse - Monitoring Specification

**Document Date**: 2026-03-27

Current release note:

- the monitoring rules in this document were intentionally left unchanged during the PostgreSQL / installer / enrollment refactor

## Scope

This document describes the current monitoring behavior of the shipped release.

## Health Domains

| Domain | Values |
|---|---|
| `broadcast_health` | `healthy`, `degraded`, `off_air_likely`, `off_air_confirmed`, `unknown` |
| `runtime_health` | `healthy`, `paused`, `restarting`, `stalled`, `stopped`, `content_error`, `unknown` |
| `connectivity_health` | `online`, `stale`, `offline` |

---

## Poll Sequence

On each cycle, the agent can collect:

1. process and window presence
2. deep log tokens
3. runtime file movement and runtime flags
4. content error logs
5. connectivity checks
6. optional UDP probes
7. one heartbeat per player

The hub is the only place that computes final health.

---

## Runtime Signal Families

### Process Signals

Used for:

- process present / missing
- restart evidence
- CPU activity

### Log Signals

Used for:

- pause
- skip
- fully played
- reinit
- app exit

### Runtime File Signals

Used for:

- playback movement
- freeze / stall detection
- current runtime flags
- current playlist / file advancement

### Connectivity Signals

Used for:

- default gateway reachability
- public internet reachability

### UDP Signals

When enabled for a player, the agent may probe:

- presence
- freeze
- black
- silence
- thumbnail frame

---

## Current Escalation Rules

### Connectivity

| Condition | Result |
|---|---|
| heartbeat age under about 45s | `online` |
| heartbeat age about 45s to 90s | `stale` |
| heartbeat age over about 90s | `offline` |

### Runtime Without UDP Confirmation

| Condition | Immediate Result | Escalation |
|---|---|---|
| explicit pause | `runtime=paused`, `broadcast=degraded` | red after about 60s |
| explicit stop while process is still up | `runtime=stopped`, `broadcast=degraded` | red after about 60s |
| process missing / player shut down | `runtime=stopped`, `broadcast=off_air_likely` | immediate |
| stall evidence | `runtime=stalled`, `broadcast=degraded` | red after about 45s |
| restart evidence | `runtime=restarting`, `broadcast=degraded` | warning state |

### UDP

| Condition | Immediate Result | Escalation |
|---|---|---|
| missing / frozen / black / silent UDP output | `broadcast=degraded` | red after about 40s sustained fault |

---

## Current Pause Recovery Rule

For the current release, pause recovery is intentionally conservative.

A paused player should not clear back to healthy from process CPU activity alone.

Stronger resume evidence includes:

- playback movement
- fresh positive log token such as `fully_played` or `skipped`
- playlist or runtime file advancement

This rule was important in the March 27, 2026 live NJ Optimum work because CPU activity remained high even while the player was paused.

---

## Decision Matrix

| Observation | Broadcast | Runtime |
|---|---|---|
| local runtime healthy, no warnings | `healthy` | `healthy` |
| paused under 60s | `degraded` | `paused` |
| paused at or above 60s | `off_air_likely` | `paused` |
| stopped under 60s while process still present | `degraded` | `stopped` |
| stopped at or above 60s while process still present | `off_air_likely` | `stopped` |
| player shut down / process missing | `off_air_likely` | `stopped` |
| stalled runtime under threshold | `degraded` | `stalled` |
| stalled runtime after sustained threshold | `off_air_likely` | `stalled` |
| content error | `degraded` | `content_error` |
| UDP sustained fault | `off_air_confirmed` | unchanged |
| no current reporting path | `unknown` | `unknown` |

---

## Alert Policy

### Critical

Used for:

- `off_air_likely`
- `off_air_confirmed`

### Warning / Degraded

Used for:

- `paused`
- `stalled`
- `restarting`
- `content_error`
- connectivity `stale` / `offline`

### Recovery

Sent when a previously critical player returns to healthy conditions.

Current alerting is deduplicated through hub persistence.

---

## Current Known Monitoring Caveats

As of March 27, 2026:

- some Insta installs can keep CPU active while paused
- some local runtime files can be stale and should not be trusted alone
- UDP is optional and should strengthen confidence, not replace all local runtime monitoring

The dated release record and live challenges are documented in [docs/RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
