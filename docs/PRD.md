# Clarix Pulse — Product Requirements Document

**Project**: Clarix Pulse
**Version**: 1.0.0
**Date**: 2026-03-26
**Author**: NOIRE TV / Caspan Media
**Status**: Approved — Implementation in progress

---

## 1. Problem Statement

NOIRE TV operates broadcast playout across 4 physical sites with 7 independent playout instances.
There is currently no unified monitoring system. Operators must manually check each PC to determine
if a channel is on-air, which introduces unacceptable risk of undetected off-air events, slow incident
response, and operational blind spots — especially during overnight and weekend hours.

---

## 2. Goal

Build **Clarix Pulse**: a production-grade broadcast monitoring system that provides:

- Real-time visibility of all 7 playout instances from a single web dashboard
- Automatic alerting (Telegram + email) when a channel goes or is likely to go off-air
- Clear separation of playout failure from network/connectivity failure
- A lightweight agent deployable on all playout PCs with zero per-site Python dependency
- A UDP stream confidence probe for sites with encoder/network access

---

## 3. Users

| User | Context | Primary Need |
|---|---|---|
| Broadcast operator | On call, checking phone | Know immediately if a channel is off-air |
| Technical director | Office or remote | Understand root cause (playout crash vs network loss) |
| Support team (Caspan Media) | support@caspenmedia.com | Receive email alerts for escalation |

---

## 4. Sites and Instances

| PC | Site ID | Location | Instances |
|---|---|---|---|
| NY Main | `ny-main` | New York, Main | insta-1, insta-2, admax-1 |
| NY Backup | `ny-backup` | New York, Backup | admax-1, admax-2 |
| NJ Optimum | `nj-optimum` | New Jersey | admax-1 |
| FL Digicel | `digicel` | Florida | admax-1 |

**Total**: 4 PCs, 7 playout instances across 2 software types (Insta Playout, Admax).

---

## 5. Features

### 5.1 Core (v1.0)

| # | Feature | Priority |
|---|---|---|
| F1 | Real-time dashboard grouped by site | P0 |
| F2 | Per-instance colour-coded health status | P0 |
| F3 | Separate broadcast_health, runtime_health, connectivity_health | P0 |
| F4 | Loud audio alarm on OFF AIR state | P0 |
| F5 | Telegram alert on state change (critical + recovery) | P0 |
| F6 | Email alert to support@caspenmedia.com | P0 |
| F7 | Local agent auto-starts as Windows service on boot | P0 |
| F8 | Agent deploys as single .exe — no Python install required | P0 |
| F9 | Deep log monitoring (Insta + Admax validated) | P0 |
| F10 | Process presence + window presence monitoring | P0 |
| F11 | Stall detection via file position delta (30s/60s threshold) | P0 |
| F12 | Content error detection via FNF/playlistscan logs | P1 |
| F13 | UDP stream confidence probe (NY Backup + Digicel) | P1 |
| F14 | Stream thumbnail snapshot in dashboard | P1 |
| F15 | Heartbeat stale/offline indicator (orange/gray) | P0 |
| F16 | Mobile-responsive dashboard | P1 |
| F17 | SQLite-backed alert dedup (survives hub restart) | P0 |

### 5.2 Future (v1.x)

- Auto-restart of crashed playout application after 180s (observation mode first)
- Historical event log view in dashboard
- Per-instance maintenance mode (suppress alerts)
- Multi-user authentication for dashboard

---

## 6. Non-Goals (v1.0)

- No video preview / live stream in browser (thumbnails only)
- No user login / authentication for dashboard (internal tool)
- No automatic playout restart (alert-only mode at launch)
- No support for platforms other than Windows on playout PCs
- No public-facing status page

---

## 7. Health State Model

### 7.1 Three independent health domains

```
broadcast_health:   healthy | degraded | off_air_likely | off_air_confirmed | unknown
runtime_health:     healthy | paused | restarting | stalled | stopped | content_error | unknown
connectivity_health: online | stale | offline
```

The hub is the sole state engine. Agents send raw observations only.

### 7.2 Colour mapping for dashboard

| Colour | Condition |
|---|---|
| Green  | broadcast=healthy AND runtime=healthy |
| Yellow | broadcast=degraded OR runtime in {paused, restarting, stalled, content_error} |
| Red    | broadcast in {off_air_likely, off_air_confirmed} OR runtime=stopped |
| Orange | connectivity=stale (heartbeat delayed, last state valid) |
| Gray   | connectivity=offline (heartbeat lost, state unknown) |

### 7.3 Alert severity

| Severity | Trigger |
|---|---|
| Critical | off_air_likely, off_air_confirmed, runtime=stopped |
| Warning  | degraded, stalled, content_error, connectivity=stale |
| Recovery | Return to broadcast=healthy + runtime=healthy |

---

## 8. Agent Monitoring Protocol

The same protocol applies to all 7 instances. UDP probe is optional per instance.

**Every 10 seconds, the agent**:
1. Checks process presence and window presence
2. Tails new log lines (Insta or Admax, per playout_type)
3. Reads file state indicators (filebar/Settings.ini for stall detection)
4. Checks FNF and playlistscan logs for content errors
5. Pings gateway IP and public internet
6. If `udp_probe.enabled`: runs ffprobe/ffmpeg against encoder stream
7. POSTs one raw observation heartbeat per instance to hub

---

## 9. Key Constraints

- Hub must remain reachable even if one or more playout PCs lose internet
- Internet loss on a playout PC must NOT automatically trigger OFF AIR — must be separated
- NJ Optimum: SDI-only output — no UDP probe available
- Agent package must work without Python, ffmpeg, or any other pre-install on playout PCs
- All communication is outbound agent → hub (no hub callback to agents — NAT compatible)

---

## 10. Success Metrics

| Metric | Target |
|---|---|
| Time from off-air event to alert | < 30 seconds |
| False positive rate (alert when actually on-air) | < 1 per week |
| Agent uptime (as Windows service) | > 99.9% |
| Dashboard uptime | > 99.9% (VPS SLA) |
| Alert dedup correctness (no duplicate alerts) | 100% |

---

## 11. Deployment

| Component | Where | How |
|---|---|---|
| Hub + Dashboard | RackNerd VPS 2.5GB (192.3.76.144) | PM2 + Caddy |
| DNS | Cloudflare (pulse.clarixtech.com) | A record → VPS IP, proxied |
| Agent | Each playout PC | clarix-agent.exe as Windows service via NSSM |

---

## 12. Revision History

| Date | Version | Change |
|---|---|---|
| 2026-03-26 | 1.0.0 | Initial PRD — approved for implementation |
