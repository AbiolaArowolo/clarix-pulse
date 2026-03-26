# Pulse - Monitoring Specification

**Version**: 1.0.0
**Date**: 2026-03-26

---

## Node / Player Registry

| Node ID | Player ID | Site | Software | UDP |
|---|---|---|---|---|
| `ny-main-pc` | `ny-main-insta-1` | NY Main | Insta Playout | Optional |
| `ny-main-pc` | `ny-main-insta-2` | NY Main | Insta Playout | Optional |
| `ny-main-pc` | `ny-main-admax-1` | NY Main | Admax | Optional |
| `ny-backup-pc` | `ny-backup-admax-1` | NY Backup | Admax | Enabled |
| `ny-backup-pc` | `ny-backup-admax-2` | NY Backup | Admax | Enabled |
| `nj-optimum-pc` | `nj-optimum-insta-1` | NJ Optimum | Insta Playout | Optional |
| `digicel-pc` | `digicel-admax-1` | FL Digicel | Admax | Enabled |

A node can carry 2-5 UDP inputs across one or more players. UDP is never a node-wide assumption; it
is enabled or disabled on each player independently. A player may define multiple enabled inputs, and
the agent evaluates those inputs as a UDP matrix before choosing the best active source for headline
broadcast metrics and thumbnails.

---

## Health State Model

Three independent domains - never mixed:

### broadcast_health

| Value | Meaning | Dashboard colour |
|---|---|---|
| `healthy` | On-air confidence is high | Green |
| `degraded` | Playback active but with warnings | Yellow |
| `off_air_likely` | Strong signal of playout failure | Red |
| `off_air_confirmed` | UDP output confirmed absent/frozen/black | Red |
| `unknown` | Agent offline - state indeterminate | Gray |

### runtime_health

| Value | Meaning | Trigger |
|---|---|---|
| `healthy` | Process up, log active, position advancing | Default when no issues |
| `paused` | Explicit pause state from runtime file or log fallback | `stopxxx2` (Admax) / `runningstatus.txt` or "Paused" (Insta) |
| `restarting` | Process restarted or re-init token seen | restart event or `reinit` log token |
| `stalled` | Process up but position frozen >30s | filebar/Frame delta = 0 |
| `stopped` | Process absent or runtime file reports not running | `playout_process_up = 0` or Insta runtime state |
| `content_error` | New entries in FNF or playlistscan log | new log lines in error files |
| `unknown` | Insufficient data | No observations received |

### connectivity_health

| Value | Meaning | Trigger |
|---|---|---|
| `online` | Heartbeats arriving normally | Last heartbeat <45s ago |
| `stale` | Heartbeats delayed | Last heartbeat 45-90s ago |
| `offline` | No heartbeats | Last heartbeat >90s ago |

---

## Monitoring Protocol - All Players

On every configured poll interval, the agent runs these checks in order for each player on the
node. The Optimum reference node currently uses a 2-second poll interval for faster live feedback.

### Step 1: Process presence

| Parameter | Insta Playout | Admax |
|---|---|---|
| Allowed processes | `Insta Playout.exe`, `Insta Playout 2.exe` | `Admax-One Playout2.0.exe`, `Admax-One Playout2.0.2.exe` |
| Blocked processes | - | `admaxter.exe` (NOT a valid playout signal) |
| Window check | via `pywin32 EnumWindows` | same |

### Step 2: Deep log monitoring

| Software | Log path | Tokens detected |
|---|---|---|
| Insta Playout | `C:\Program Files\Indytek\Insta log\DD-MM-YYYY.txt` | "Paused", "Fully Played", playlist transitions |
| Admax | `<admax_root>\logs\logs\Playout\YYYY-MM-DD.txt` | `stopxxx2` -> paused; "Application Exited by client!" -> stopped; re-init pattern -> restarting |

Log file is tailed from the current end-of-file for the active agent session so stale historical
pause lines do not replay as fresh alarms after restart. File rotation at midnight is handled.

### Step 3: File state indicators

| Software | File | Metric | Stall warning | Stall critical |
|---|---|---|---|---|
| Insta | `filebar.txt` (JSON) + `runningstatus.txt` | `FilePosition` plus persistent runtime state | delta=0 for 30s | delta=0 for 60s |
| Admax | `Settings.ini` | `Frame` value | delta=0 for 30s | delta=0 for 60s |

Content error detection (both software types):

- New entries in `FNF` log -> `content_error`
- New entries in `playlistscan` log -> `content_error`

### Step 4: Connectivity

| Metric | Method | Meaning |
|---|---|---|
| `gateway_up` | Ping default gateway IP | Local LAN reachability |
| `internet_up` | Ping 1.1.1.1 and 8.8.8.8 | Public internet reachability |

Internet loss does NOT trigger OFF AIR - these are kept separate.

### Step 5: UDP output probe (optional per player)

| Check | Tool | Parameter | Alert threshold |
|---|---|---|---|
| Stream present | ffprobe | `-show_entries format=duration` | yellow immediately when missing, red after about 40s continuous fault |
| Freeze | ffmpeg `freezedetect` | `noise=0.001:duration=2` | yellow immediately when frozen, red after about 40s continuous fault |
| Black | ffmpeg `blackdetect` | `d=2:pix_th=0.1` | yellow immediately when black, red after about 40s continuous fault |
| Audio silence | ffmpeg `silencedetect` | `noise=-50dB:d=5` | yellow immediately when silent, red after about 40s continuous fault |
| Thumbnail | ffmpeg single frame | JPEG, max 50KB | sent to dashboard every 10s |

If a node carries multiple UDP inputs on one player or across several players, each player is still
monitored independently and keyed by its `player_id`. When a single player has several enabled
inputs, the agent probes them as a matrix and reports the best active input as the primary output
signal.

---

## State Decision Matrix

| Observation | broadcast_health | runtime_health |
|---|---|---|
| UDP fault detected (`output_signal_present=0`, freeze, black, or silence) | `degraded` first, then `off_air_confirmed` after about 40s continuous fault | - |
| `playout_process_up=0` for about 45s continuous, without UDP confirmation | `off_air_likely` | `stopped` |
| `log_last_token=app_exited` | `off_air_likely` | `stopped` |
| `log_last_token=stopxxx2` | `degraded` | `paused` |
| `log_last_token=paused` or Insta runtime file says paused | `degraded` | `paused` |
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

- `OFF AIR: NY Main - Admax 1 - output signal missing`
- `OFF AIR LIKELY: NJ Optimum - Insta - process missing`

### Warning (DEGRADED / NETWORK ISSUE)

Triggers when:

- `runtime_health` = `paused`, `stalled`, `content_error`, `restarting`
- `connectivity_health` = `offline` (heartbeat lost)

Examples:

- `NETWORK ISSUE: NY Main - Insta 1 - heartbeat missing`
- `DEGRADED: FL Digicel - Admax - restart loop detected`

### Recovery

Triggers when `broadcast_health` returns to `healthy` after a critical state. For UDP-enabled
players, recovery is immediate on the first healthy sample after the fault clears.

Example:

- `RECOVERED: NY Main - Admax 1 - broadcast health restored`

### Dedup

Alerts are deduplicated via SQLite `events` table. One alert per incident.
A new alert is sent only when the player recovers and re-enters a critical state.

---

## Heartbeat Thresholds

| Metric | Warning | Critical |
|---|---|---|
| `agent_heartbeat_age_seconds` | 45s | 90s |
| `playout_process_up=0` | immediate | 15s |
| `playout_window_up=0` (process up) | immediate | 30s |
| Position delta=0 | 30s | 60s |
| `restart_events_15m` | - | >= 2 |
| UDP missing / frozen / black / silent | immediate degrade | red after about 40s continuous fault |
| `internet_up=0` | - | 60s |
| `gateway_up=0` | - | 30s |
