# Pulse - Architecture Document

**Version**: 1.0.0
**Date**: 2026-03-26
**Status**: Baseline - approved for implementation

---

## 1. System Overview

Pulse is a three-tier broadcast monitoring system built around nodes and players.

```text
PLAYOUT NODES (4 PCs)
  - NY Main node: multiple players, optional UDP per player
  - NY Backup node: multiple players, UDP enabled on selected players
  - NJ Optimum node: one player, optional UDP if later assigned
  - FL Digicel node: one player, UDP enabled

Each node runs one local agent and reports one heartbeat per player.
All traffic is outbound HTTPS from agent -> hub.

PULSE HUB (VPS)
  - Cloudflare proxy + Caddy TLS
  - Node.js + Express API
  - Socket.io realtime push
  - SQLite state store
  - Alerting (Telegram + email)

PULSE DASHBOARD
  - Static React SPA served by Caddy
  - Realtime state updates via Socket.io
  - Player-level cards grouped by node
```

The key design rule is that `node_id` identifies the physical PC, while `player_id` identifies the
individual playout source being monitored on that node.

---

## 2. Component Responsibilities

### 2.1 Local Agent (`clarix-agent.exe`)

- Runs as a Windows Service via NSSM and auto-starts on PC boot
- Reads local files, processes, and window state only
- Never accepts inbound connections
- Polls every 10 seconds and sends one heartbeat POST per player
- Optionally runs `ffprobe` / `ffmpeg` for UDP confidence on any enabled player
- Sends raw observations only; it does not compute health state

### 2.2 Hub (Node.js + Express + Socket.io)

- Validates node Bearer tokens
- Maps each `node_id` to its allowed `player_id` values
- Receives raw observations, runs the state engine, updates SQLite, and pushes Socket.io events
- Owns alerting, deduplication, and recovery handling
- Serves `GET /api/status` for dashboard initial load
- Never contacts encoder IPs or runs `ffprobe` / `ffmpeg`

### 2.3 Dashboard (React SPA)

- Served as static files by Caddy
- Connects to the hub via Socket.io on load
- Derives card colour and alarm state from the three health domains
- Shows thumbnails for players with one or more enabled UDP inputs
- No server-side rendering; pure client-side SPA

### 2.4 SQLite Database

Single file: `packages/hub/data/clarix.db`

Logical tables:

```sql
-- Current state per node
CREATE TABLE node_state (
    node_id TEXT PRIMARY KEY,
    connectivity_health TEXT,
    last_heartbeat_at TEXT,
    updated_at TEXT
);

-- Current state per player
CREATE TABLE player_state (
    player_id TEXT PRIMARY KEY,
    node_id TEXT,
    software TEXT,
    broadcast_health TEXT,
    runtime_health TEXT,
    last_observations TEXT,
    thumbnail_data BLOB,
    thumbnail_at TEXT,
    updated_at TEXT
);

-- Append-only event log
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT,
    player_id TEXT,
    event_type TEXT,
    from_state TEXT,
    to_state TEXT,
    observations TEXT,
    alert_sent INTEGER,
    created_at TEXT
);
```

---

## 3. Data Flow

### 3.1 Normal heartbeat flow (every 10s per player)

```text
Agent polls local files/processes for each player on the node
  -> builds observations object
  -> POST /api/heartbeat with Bearer token
  -> Hub validates token and maps node_id to allowed player_ids
  -> Hub passes observations to the state engine
  -> State engine computes broadcast_health, runtime_health, connectivity_health
  -> Hub writes new state to SQLite player_state
  -> Hub appends to SQLite events if state changed
  -> Hub emits Socket.io state_update to connected dashboards
  -> Dashboard re-renders the affected player card
```

### 3.2 Alert flow

```text
State engine detects off_air_likely or worse
  -> Alerting checks whether an alert already exists for this incident
  -> If not, send Telegram message and email
  -> Write alert_sent=1 to the matching events row
  -> When state recovers, send RECOVERED message
```

### 3.3 Thumbnail flow (players with UDP enabled)

```text
Agent uses ffmpeg to capture JPEG from the enabled player's stream input
  -> PIL compresses to <=50KB
  -> POST /api/thumbnail with Bearer token + player_id
  -> Hub stores BLOB in player_state.thumbnail_data
  -> Hub emits Socket.io thumbnail_update {playerId, dataUrl, capturedAt}
  -> Dashboard thumbnail component updates
  -> Max 1 update per 10s per player
```

### 3.4 Heartbeat timeout flow

```text
Hub background job runs every 5s
  -> For each player: compute age = now - last_heartbeat_at
  -> age > 45s: set connectivity_health = stale
  -> age > 90s: set connectivity_health = offline
  -> If last known broadcast_health was healthy, set broadcast_health = unknown
  -> Trigger NETWORK ISSUE alert
```

---

## 4. Identity and Security

### 4.1 Node and player identity

- Each PC has a unique `node_id` such as `ny-main-pc`
- Each player has a unique `player_id`
- Each node has one Bearer token
- Hub maintains a map: `node_id -> [allowed_player_ids]`
- Source IP is never used for identity
- All heartbeats include `nodeId` and `playerId`

### 4.2 Transport security

- All agent -> hub traffic is HTTPS
- Dashboard is served over HTTPS
- Cloudflare is configured for Full (strict) SSL mode
- No HTTP is allowed for normal operation

### 4.3 Credentials storage

```text
.env.local (gitignored, hub machine only, preferred; .env is also supported):
  VPS_ROOT_PASSWORD
  CF_PASSWORD
  TELEGRAM_BOT_TOKEN
  SMTP_PASS
  AGENT_TOKENS (comma-separated node_id:token pairs)

config.yaml (each playout PC, never committed):
  node_id: <unique node id>
  agent_token: <unique per node>
  hub_url: https://pulse.clarixtech.com
  players:
    - player_id: <player id>
      udp_inputs:
        - udp_input_id: <unique udp input id>
          enabled: true|false
          stream_url: udp://...
```

---

## 5. Monitoring Protocol Detail

### 5.1 Log token reference

| Software | Log path | Token | Meaning |
|---|---|---|---|
| Insta | `Insta log\<date>.txt` | "Paused" | Playback paused |
| Insta | `Insta log\<date>.txt` | "Fully Played" | Track completed |
| Admax | `logs\logs\Playout\<date>.txt` | `stopxxx2` | Playback stopped/paused |
| Admax | `logs\logs\Playout\<date>.txt` | "Application Exited by client!" | App shutdown |
| Admax | `logs\logs\Playout\<date>.txt` | re-init pattern | App restarting |

### 5.2 Stall detection thresholds

| Indicator | Software | Warning | Critical |
|---|---|---|---|
| `filebar.FilePosition` delta | Insta | 0 for 30s | 0 for 60s |
| `Settings.ini Frame` delta | Admax | 0 for 30s | 0 for 60s |

### 5.3 UDP probe (per player, optional)

| Check | Tool | Method |
|---|---|---|
| Stream present | `ffprobe` | `-show_entries format=duration`, 5s timeout |
| Freeze | `ffmpeg` | `-vf freezedetect=noise=0.001:duration=2` |
| Black | `ffmpeg` | `-vf blackdetect=d=2:pix_th=0.1` |
| Audio silence | `ffmpeg` | `-af silencedetect=noise=-50dB:d=5` |
| Thumbnail | `ffmpeg` | `-frames:v 1 -q:v 5`, PIL compress to <=50KB |

A node may carry 2-5 UDP inputs across one or more players. Each enabled input is evaluated as part
of that player's UDP matrix, and each player remains identified by `player_id`.

---

## 6. Deployment Architecture

```text
RackNerd VPS (192.3.76.144)
  -> Caddy (reverse proxy + TLS)
     -> /           serves /var/www/clarix-pulse/packages/dashboard/dist
     -> /api/*      proxies to localhost:3001
     -> /socket.io/* proxies to localhost:3001
  -> PM2
     -> clarix-hub runs node packages/hub/dist/index.js
  -> SQLite
     -> packages/hub/data/clarix.db

Cloudflare
  -> pulse.clarixtech.com A record points to 192.3.76.144, proxied with Full strict SSL
```

---

## 7. Revision History

| Date | Version | Change |
|---|---|---|
| 2026-03-26 | 1.0.0 | Initial architecture document |
