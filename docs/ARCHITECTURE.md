# Clarix Pulse — Architecture Document

**Version**: 1.0.0
**Date**: 2026-03-26
**Status**: Baseline — approved for implementation

---

## 1. System Overview

Clarix Pulse is a three-tier broadcast monitoring system:

```
┌─────────────────────────────────────────────────────────┐
│                   PLAYOUT SITES (4 PCs)                 │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  NY Main PC  │  │ NY Backup PC │  │ NJ Optimum   │  │
│  │  (3 inst.)   │  │  (2 inst.)   │  │  (1 inst.)   │  │
│  │  Agent v1    │  │  Agent v1    │  │  Agent v1    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │ + UDP probe      │          │
│  ┌──────────────┐         │                 │          │
│  │  FL Digicel  │         │                 │          │
│  │  (1 inst.)   │         │                 │          │
│  │  Agent v1    │         │                 │          │
│  └──────┬───────┘         │                 │          │
│         │ + UDP probe      │                 │          │
└─────────┼─────────────────┼─────────────────┼──────────┘
          │  OUTBOUND HTTPS (agent → hub)      │
          │  All traffic initiates from agent  │
          │  NAT/shared IP safe                │
          ▼                                    ▼
┌─────────────────────────────────────────────────────────┐
│              CLARIX PULSE HUB (VPS)                     │
│              pulse.clarixtech.com                       │
│              192.3.76.144                               │
│                                                         │
│  Cloudflare (DNS proxy, Full strict SSL)                │
│  Caddy (TLS termination, reverse proxy)                 │
│  Node.js + Express (REST API)                           │
│  Socket.io (WebSocket push to dashboard)                │
│  State Engine (3-domain health computation)             │
│  SQLite (instance_state + events tables)                │
│  Alerting (Telegram Bot + Nodemailer SMTP)              │
└─────────────────────────┬───────────────────────────────┘
                          │ Socket.io (WebSocket)
                          ▼
┌─────────────────────────────────────────────────────────┐
│              CLARIX PULSE DASHBOARD                     │
│        https://pulse.clarixtech.com/                    │
│                                                         │
│  Vite + React 18 + TypeScript + TailwindCSS             │
│  Served as static files from Caddy                      │
│  Real-time updates via Socket.io-client                 │
│  Web Audio API alarm on OFF AIR                         │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Component Responsibilities

### 2.1 Local Agent (`clarix-agent.exe`)

- Runs as Windows Service (NSSM) — auto-starts on PC boot
- Reads from local filesystem and process list only
- Never accepts inbound connections
- Polls every 10 seconds, sends one heartbeat POST per playout instance
- Optionally runs ffprobe/ffmpeg for UDP stream confidence (agent-side only)
- Sends raw observations — does NOT compute health state

**What the agent does NOT do**:
- Does not contact encoders from the hub
- Does not accept any inbound connection
- Does not compute broadcast_health, runtime_health, or connectivity_health

### 2.2 Hub (Node.js + Express + Socket.io)

- Validates agent Bearer tokens (one per PC)
- Receives raw observations → runs state engine → updates SQLite → pushes via Socket.io
- State engine is the sole authority for all health states
- Runs alerting (Telegram + email) with SQLite-backed dedup
- Serves `GET /api/status` for dashboard initial load
- Never contacts encoder IPs or runs ffprobe/ffmpeg

### 2.3 Dashboard (React SPA)

- Served as static files by Caddy
- Connects to hub via Socket.io on load
- Derives card colour/alarm from all three health domains
- Plays Web Audio API alarm when any instance hits red
- Shows thumbnail snapshot for UDP-enabled instances
- No server-side rendering — pure client-side SPA

### 2.4 SQLite Database

Single file: `hub/data/clarix.db`

Tables:
```sql
-- Current state per instance
CREATE TABLE instance_state (
    instance_id TEXT PRIMARY KEY,
    agent_id TEXT,
    broadcast_health TEXT,
    runtime_health TEXT,
    connectivity_health TEXT,
    last_heartbeat_at TEXT,   -- ISO 8601
    last_observations TEXT,   -- JSON blob
    thumbnail_data BLOB,      -- latest JPEG, nullable
    thumbnail_at TEXT,
    updated_at TEXT
);

-- Append-only event log (state transitions)
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT,
    event_type TEXT,          -- heartbeat | state_change | alert_sent | alert_recovered
    from_state TEXT,          -- JSON: {broadcast, runtime, connectivity}
    to_state TEXT,            -- JSON
    observations TEXT,        -- JSON snapshot at time of event
    alert_sent INTEGER,       -- 0 or 1
    created_at TEXT           -- ISO 8601
);
```

---

## 3. Data Flow

### 3.1 Normal heartbeat flow (every 10s per instance)

```
Agent polls local files/processes
  → builds observations object
  → POST /api/heartbeat with Bearer token
  → Hub validates token → maps agentId to allowed instances
  → Hub passes observations to State Engine
  → State Engine computes broadcast_health, runtime_health, connectivity_health
  → Hub writes new state to SQLite instance_state
  → Hub appends to SQLite events (if state changed)
  → Hub emits Socket.io 'state_update' to all connected dashboards
  → Dashboard receives update → re-renders affected InstanceCard
```

### 3.2 Alert flow (on state change to critical/warning)

```
State Engine detects off_air_likely or worse
  → Alerting service checks events table: was an alert already sent for this incident?
  → If no: send Telegram message + send email
  → Write alert_sent=1 to events row
  → When state recovers: send RECOVERED message
```

### 3.3 Thumbnail flow (UDP sites only)

```
Agent (NY Backup / Digicel): ffmpeg captures JPEG from local encoder stream
  → PIL compresses to ≤50KB
  → POST /api/thumbnail with Bearer token + instance_id
  → Hub stores BLOB in instance_state.thumbnail_data
  → Hub emits Socket.io 'thumbnail_update' {instanceId, dataUrl, capturedAt}
  → Dashboard StreamThumbnail component updates
  → Max 1 update per 10s per instance
```

### 3.4 Heartbeat timeout flow

```
Hub: background job runs every 5s
  → For each instance: compute age = now - last_heartbeat_at
  → age > 45s: set connectivity_health = stale, emit Socket.io update
  → age > 90s: set connectivity_health = offline, emit Socket.io update
    → if last known broadcast_health was healthy: set broadcast_health = unknown
    → trigger NETWORK ISSUE alert
```

---

## 4. Identity and Security

### 4.1 Agent identity

- Each PC has a unique `agent_id` (e.g., `ny-main-pc`)
- Each PC has one Bearer token (stored in `.env.local` on hub, `config.yaml` on agent)
- Hub maintains a map: `agentId → [allowedInstanceIds]`
- Source IP is never used for identity — safe under NAT and shared public IPs
- All heartbeats include `agentId` + `instanceId`; hub rejects unknown combinations

### 4.2 Transport security

- All agent → hub traffic is HTTPS (Caddy TLS + Cloudflare proxy)
- Dashboard: HTTPS served by Caddy
- Cloudflare: Full (strict) SSL mode — end-to-end encryption
- No HTTP allowed — Caddy redirects to HTTPS

### 4.3 Credentials storage

```
.env.local (gitignored, hub machine only):
  VPS_ROOT_PASSWORD
  CF_PASSWORD
  TELEGRAM_BOT_TOKEN
  SMTP_PASS
  AGENT_TOKENS (comma-separated agent_id:token pairs)

config.yaml (each playout PC, never committed):
  agent_token: <unique per PC>
  hub_url: https://pulse.clarixtech.com
  udp stream URLs (private LAN IPs, not routable from hub)
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

### 5.3 UDP probe (NY Backup, Digicel only)

| Check | Tool | Method |
|---|---|---|
| Stream present | `ffprobe` | `-show_entries format=duration`, 5s timeout |
| Freeze | `ffmpeg` | `-vf freezedetect=noise=0.001:duration=2` |
| Black | `ffmpeg` | `-vf blackdetect=d=2:pix_th=0.1` |
| Audio silence | `ffmpeg` | `-af silencedetect=noise=-50dB:d=5` |
| Thumbnail | `ffmpeg` | `-frames:v 1 -q:v 5`, PIL compress to ≤50KB |

---

## 6. Deployment Architecture

```
RackNerd VPS (192.3.76.144)
├── Caddy (reverse proxy + TLS)
│   ├── /           → serves /var/www/clarix-pulse/dashboard/dist
│   ├── /api/*      → proxy to localhost:3001
│   └── /socket.io/* → proxy to localhost:3001 (WebSocket upgrade)
├── PM2
│   └── clarix-hub  → node packages/hub/dist/index.js
└── SQLite
    └── packages/hub/data/clarix.db

Cloudflare
└── pulse.clarixtech.com A → 192.3.76.144 (proxied, Full strict SSL)
```

---

## 7. Revision History

| Date | Version | Change |
|---|---|---|
| 2026-03-26 | 1.0.0 | Initial architecture document |
