# Clarix Pulse — Monitoring Specification

**Version**: 1.0.0
**Date**: 2026-03-26

---

## Instance Registry

| Instance ID | Site | Software | Agent PC | UDP Probe |
|---|---|---|---|---|
| `ny-main-insta-1` | NY Main | Insta Playout | `ny-main-pc` | No |
| `ny-main-insta-2` | NY Main | Insta Playout | `ny-main-pc` | No |
| `ny-main-admax-1` | NY Main | Admax | `ny-main-pc` | No |
| `ny-backup-admax-1` | NY Backup | Admax | `ny-backup-pc` | Yes (encoder LAN) |
| `ny-backup-admax-2` | NY Backup | Admax | `ny-backup-pc` | Yes (encoder LAN) |
| `nj-optimum-admax-1` | NJ Optimum | Admax | `nj-optimum-pc` | No (SDI only) |
| `digicel-admax-1` | FL Digicel | Admax | `digicel-pc` | Yes (encoder LAN) |

---

## Health State Model

Three independent domains — never mixed:

### broadcast_health

| Value | Meaning | Dashboard colour |
|---|---|---|
| `healthy` | On-air confidence is high | Green |
| `degraded` | Playback active but with warnings | Yellow |
| `off_air_likely` | Strong signal of playout failure | Red |
| `off_air_confirmed` | UDP output confirmed absent/frozen/black | Red |
| `unknown` | Agent offline — state indeterminate | Gray |

### runtime_health

| Value | Meaning | Trigger |
|---|---|---|
| `healthy` | Process up, log active, position advancing | Default when no issues |
| `paused` | Explicit pause token in log | `stopxxx2` (Admax) / "Paused" (Insta) |
| `restarting` | Process restarted or re-init token seen | restart event or `reinit` log token |
| `stalled` | Process up but position frozen >30s | filebar/Frame delta = 0 |
| `stopped` | Process absent | `playout_process_up = 0` |
| `content_error` | New entries in FNF or playlistscan log | new log lines in error files |
| `unknown` | Insufficient data | No observations received |

### connectivity_health

| Value | Meaning | Trigger |
|---|---|---|
| `online` | Heartbeats arriving normally | Last heartbeat <45s ago |
| `stale` | Heartbeats delayed | Last heartbeat 45–90s ago |
| `offline` | No heartbeats | Last heartbeat >90s ago |

---

## Monitoring Protocol — All Instances

Every 10 seconds, the agent runs these checks in order:

### Step 1: Process presence

| Parameter | Insta Playout | Admax |
|---|---|---|
| Allowed processes | `Insta Playout.exe`, `Insta Playout 2.exe` | `Admax-One Playout2.0.exe`, `Admax-One Playout2.0.2.exe` |
| Blocked processes | — | `admaxter.exe` (NOT a valid playout signal) |
| Window check | via `pywin32 EnumWindows` | same |

### Step 2: Deep log monitoring (validated primary signal)

| Software | Log path | Tokens detected |
|---|---|---|
| Insta Playout | `C:\Program Files\Indytek\Insta log\DD-MM-YYYY.txt` | "Paused", "Fully Played", playlist transitions |
| Admax | `<admax_root>\logs\logs\Playout\YYYY-MM-DD.txt` | `stopxxx2` → paused; "Application Exited by client!" → stopped; re-init pattern → restarting |

Log file is tailed (new lines only) every poll. File rotation at midnight is handled.

### Step 3: File state indicators (stall detection)

| Software | File | Metric | Stall warning | Stall critical |
|---|---|---|---|---|
| Insta | `filebar.txt` (JSON) | `FilePosition` | delta=0 for 30s | delta=0 for 60s |
| Admax | `Settings.ini` | `Frame` value | delta=0 for 30s | delta=0 for 60s |

Content error detection (both software types):
- New entries in `FNF` log → `content_error`
- New entries in `playlistscan` log → `content_error`

### Step 4: Connectivity

| Metric | Method | Meaning |
|---|---|---|
| `gateway_up` | Ping default gateway IP | Local LAN reachability |
| `internet_up` | Ping 1.1.1.1 and 8.8.8.8 | Public internet reachability |

Internet loss does NOT trigger OFF AIR — these are kept separate.

### Step 5: UDP output probe (NY Backup and Digicel only)

| Check | Tool | Parameter | Critical threshold |
|---|---|---|---|
| Stream present | ffprobe | `-show_entries format=duration` | `output_signal_present=0` |
| Freeze | ffmpeg `freezedetect` | `noise=0.001:duration=2` | `output_freeze_seconds >= 20` |
| Black | ffmpeg `blackdetect` | `d=2:pix_th=0.1` | `output_black_ratio >= 0.98` |
| Audio silence | ffmpeg `silencedetect` | `noise=-50dB:d=5` | `output_audio_silence_seconds >= 30` (supporting only) |
| Thumbnail | ffmpeg single frame | JPEG, max 50KB | sent to dashboard every 10s |

---

## State Decision Matrix

| Observation | broadcast_health | runtime_health |
|---|---|---|
| `output_signal_present=0` (UDP enabled) | `off_air_confirmed` | — |
| `output_freeze_seconds >= 20` (UDP enabled) | `off_air_confirmed` | — |
| `output_black_ratio >= 0.98` (UDP enabled) | `off_air_confirmed` | — |
| `playout_process_up=0` | `off_air_likely` | `stopped` |
| `log_last_token=app_exited` | `off_air_likely` | `stopped` |
| `log_last_token=stopxxx2` | `degraded` | `paused` |
| `log_last_token=paused` | `degraded` | `paused` |
| `log_last_token=reinit` | `degraded` | `restarting` |
| `restart_events_15m >= 2` | `degraded` | `restarting` |
| Position delta=0 for 30s | `degraded` | `stalled` |
| Position delta=0 for 60s | `off_air_likely` | `stalled` |
| `fnf_new_entries > 0` or `playlistscan_new_entries > 0` | `degraded` | `content_error` |
| `playout_process_up=1, window_up=0` | `degraded` | `healthy` |
| All clear | `healthy` | `healthy` |

---

## Alert Policy

### Critical (OFF AIR / PLAYOUT FAILURE)

Triggers when `broadcast_health` = `off_air_confirmed` or `off_air_likely`

Examples:
- `🔴 OFF AIR: NY Main — Admax 1 — output signal missing`
- `🟠 OFF AIR LIKELY: NJ Optimum — Admax — process missing`

### Warning (DEGRADED / NETWORK ISSUE)

Triggers when:
- `runtime_health` = `paused`, `stalled`, `content_error`, `restarting`
- `connectivity_health` = `offline` (heartbeat lost)

Examples:
- `⚠️ NETWORK ISSUE: NY Main — Insta 1 — heartbeat missing`
- `⚠️ DEGRADED: FL Digicel — Admax — restart loop detected`

### Recovery

Triggers when `broadcast_health` returns to `healthy` after a critical state.

Example:
- `✅ RECOVERED: NY Main — Admax 1 — broadcast health restored`

### Dedup

Alerts are deduplicated via SQLite `events` table. One alert per incident.
A new alert is sent only when the instance recovers and re-enters a critical state.

---

## Heartbeat Thresholds

| Metric | Warning | Critical |
|---|---|---|
| `agent_heartbeat_age_seconds` | 45s | 90s |
| `playout_process_up=0` | immediate | 15s |
| `playout_window_up=0` (process up) | immediate | 30s |
| Position delta=0 | 30s | 60s |
| `restart_events_15m` | — | ≥ 2 |
| `output_signal_present=0` | — | 10s |
| `output_freeze_seconds` | — | ≥ 20s |
| `output_black_ratio` | — | ≥ 0.98 for 20s |
| `internet_up=0` | — | 60s |
| `gateway_up=0` | — | 30s |
