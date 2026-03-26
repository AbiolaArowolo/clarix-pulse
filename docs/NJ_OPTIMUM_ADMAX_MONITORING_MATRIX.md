# NJ Optimum Admax Monitoring Matrix

Date: 2026-03-22

## Scope

This document defines the recommended monitoring matrix for the `NJ optimum`
Admax playout player.

It intentionally supersedes the older handover assumption that `Optimum` was
an Insta site. For this site, the current playout to monitor is `Admax`.

## Core Rule

Internet loss is not the same as off-air.

The monitor must keep these health domains separate:

- `broadcast_health`
- `runtime_health`
- `connectivity_health`

## Recommended Health States

### Broadcast Health

- `healthy`
- `degraded`
- `off_air_likely`
- `off_air_confirmed`
- `unknown`

### Connectivity Health

- `online`
- `stale`
- `offline`

## Metric Set

| Metric | Meaning | Source | Suggested threshold | Role |
|---|---|---|---|---|
| `agent_heartbeat_age_seconds` | Time since the central hub last heard from the local agent | local agent -> hub | warn `>45s`, critical `>90s` | connectivity only |
| `playout_process_up` | Real Admax playout process exists | local process check | critical if `0` for `15s` | strong runtime signal |
| `playout_window_up` | Admax main UI/window still exists in the interactive session | local window/session probe | critical if `0` for `30s` | supporting runtime signal |
| `playout_restart_events_15m` | Unexpected app restart count over 15 minutes | local agent + Windows events | critical if `>=2` | supporting runtime signal |
| `playout_runtime_heartbeat_age_seconds` | Time since a proven Admax playback field last changed | local file/API/DB probe | warn `>45s`, critical `>90s` | disabled until proven reliable |
| `output_signal_present` | Real output carrier/video presence exists | SDI/encoder/capture probe | critical if `0` for `10s` | primary off-air signal |
| `output_freeze_seconds` | Output appears frozen | video confidence probe | critical if `>20s` | primary off-air signal |
| `output_black_ratio_10s` | Portion of last 10s judged black | video confidence probe | critical if `>=0.98` for `20s` | primary off-air signal |
| `output_audio_silence_seconds` | Continuous silence length | audio confidence probe | critical if `>30s` | supporting only |
| `internet_up` | Internet reachable from the playout PC | local agent | critical if `0` for `60s` | connectivity only |
| `gateway_up` | Default gateway reachable | local agent | critical if `0` for `30s` | connectivity only |

## Important Admax Rule

Do not use `admaxter.exe` as proof that playout is on-air.

The process check must target the real Admax playout executable, such as the
actual `Admax-One Playout...exe` process running the channel.

## Decision Matrix

| Condition | Result |
|---|---|
| `output_signal_present=0` beyond threshold | `broadcast_health=off_air_confirmed` |
| `output_freeze_seconds` beyond threshold | `broadcast_health=off_air_confirmed` |
| `output_black_ratio_10s` beyond threshold and video should be active | `broadcast_health=off_air_confirmed` |
| `playout_process_up=0` beyond threshold and no output probe is available | `broadcast_health=off_air_likely` |
| `playout_process_up=1` but `playout_window_up=0` or repeated restart events occur | `broadcast_health=degraded` or `off_air_likely`, depending on duration |
| proven `playout_runtime_heartbeat_age_seconds` exceeds threshold | `broadcast_health=off_air_likely` |
| `agent_heartbeat_age_seconds` critical, but last local broadcast state was healthy | `connectivity_health=offline`, `broadcast_health=unknown` |
| `internet_up=0`, but local output/runtime checks remain healthy | `connectivity_health=offline`, not off-air |
| no output probe and runtime signals are healthy | `broadcast_health=healthy` with lower confidence |

## Recommended Alert Policy

### Critical

Use for:

- `off_air_confirmed`
- `off_air_likely` persisting past threshold

Examples:

- `OFF AIR: NJ optimum Admax output signal missing`
- `OFF AIR: NJ optimum Admax output frozen for 24s`
- `PLAYOUT FAILURE LIKELY: NJ optimum Admax process missing for 18s`

### Warning

Use for:

- repeated app restarts
- window missing but process still present
- heartbeat stale while local state is otherwise healthy

Examples:

- `DEGRADED: NJ optimum Admax restarted 2 times in 15m`
- `NETWORK ISSUE: NJ optimum Admax heartbeat missing, playback state unknown`

### Recovery

Examples:

- `RECOVERED: NJ optimum Admax output confidence restored`
- `RECOVERED: NJ optimum Admax process and heartbeat normal`

## Restart Policy

Recommended starting point:

1. Observation mode first
2. Tune for several days
3. Then allow controlled restart

Suggested restart trigger:

- only after `180s` of persistent `off_air_likely` or `off_air_confirmed`
- restart the Admax application player, not the whole PC
- suppress restart during maintenance windows

## Current Confidence Assessment

### What is strong already

- process presence and crash detection
- connectivity separation
- alert labeling for `NJ optimum`

### What is still not proven

- a reliable internal Admax playback heartbeat
- whether this site has any SDI or encoder confidence source available

## Best Practical Recommendation

If `NJ optimum` has an SDI-only path, the best long-term solution is to add a
small output-confidence probe. Without that, the monitor can still detect:

- process missing
- crash loops
- reporting loss

But it cannot truthfully label every event as confirmed off-air.
