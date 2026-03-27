# Pulse - Admax Monitoring Matrix

**Date**: 2026-03-27

---

## Scope

This document describes the recommended monitoring matrix for an Admax playout player in Pulse.

It is software-specific, not customer-specific.

---

## Core Rule

Internet loss is not the same as off-air.

Pulse must keep these domains separate:

- `broadcast_health`
- `runtime_health`
- `connectivity_health`

---

## Recommended Signals

| Metric | Meaning | Source | Suggested Role |
|---|---|---|---|
| `agent_heartbeat_age_seconds` | Time since hub last heard from node | hub state | connectivity only |
| `playout_process_up` | Real Admax playout process exists | local process check | strong runtime signal |
| `playout_window_up` | Admax UI/window still exists | local window probe | supporting runtime signal |
| `restart_events_15m` | Unexpected restart count | local agent history | restart warning signal |
| `frame_delta_30s` / `frame_delta_60s` | Frame advancement | local runtime file | stall signal |
| `output_signal_present` | Output carrier or stream present | UDP probe | primary broadcast signal |
| `output_freeze_seconds` | Output appears frozen | UDP probe | primary broadcast signal |
| `output_black_ratio` | Output appears black | UDP probe | primary broadcast signal |
| `output_audio_silence_seconds` | Output audio is silent | UDP probe | supporting broadcast signal |
| `internet_up` | Internet reachable | connectivity check | connectivity only |
| `gateway_up` | Default gateway reachable | connectivity check | connectivity only |

---

## Important Admax Rule

Do not use helper or launcher processes as proof that playout is healthy. Monitor the actual Admax playout executable and supporting runtime files.

---

## Decision Matrix

| Condition | Result |
|---|---|
| UDP output missing, frozen, black, or silent beyond threshold | `broadcast_health=degraded`, then `off_air_confirmed` if it persists |
| Playout process missing and no UDP confirmation is available | `broadcast_health=degraded`, then `off_air_likely` if sustained |
| Process present but window missing or restart loop detected | `broadcast_health=degraded` |
| Runtime frame movement frozen | `runtime_health=stalled`, `broadcast_health=degraded` |
| Heartbeat missing but last local state was healthy | `connectivity_health=offline`, `broadcast_health=unknown` |
| Internet lost while local runtime remains healthy | connectivity issue only, not off-air |

---

## Recommended Alert Policy

### Critical

Use for:

- `off_air_confirmed`
- sustained `off_air_likely`

Examples:

- `OFF AIR: Site A - Admax 1 - output signal missing`
- `OFF AIR LIKELY: Site B - Admax 2 - process missing`

### Warning

Use for:

- restart loops
- window missing while process remains present
- heartbeat stale or offline while local state is otherwise unknown or last-known healthy

### Recovery

Use when:

- broadcast returns to healthy after a critical incident

---

## Best-Practice Recommendation

If an Admax deployment has a reliable output-confidence source, use it. Without output confidence, Pulse can still detect process loss, restart loops, stalls, and reporting loss, but it cannot label every incident as fully confirmed off-air.
