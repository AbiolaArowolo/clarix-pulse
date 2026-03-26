# Pulse

Real-time broadcast monitoring for NOIRE TV playout infrastructure across 4 nodes and 7 playout players.

---

## Overview

Pulse is a self-hosted monitoring system that detects off-air events, distinguishes playout software failure from network loss, and alerts operators via Telegram and email - all within seconds.

It replaces manual checking across multiple playout nodes running Insta Playout and Admax software, where each node may carry multiple players and optional UDP inputs.

```
[Playout Nodes] ──  Python Agent  ──►  [Hub: VPS Node.js + SQLite]
  NY Main                                      │ Socket.io
  NY Backup       POST /api/heartbeat          ▼
  NJ Optimum      POST /api/thumbnail    [React Dashboard]
  FL Digicel                              pulse.clarixtech.com
```

---

## Features

- **Live dashboard** - colour-coded health cards per player, grouped by node
- **Three independent health domains** — broadcast, runtime, and connectivity tracked separately
- **Deep log monitoring** - validated primary signal for both Insta Playout and Admax
- **UDP stream probing** - optional agent-side ffprobe/ffmpeg per player, with multiple UDP inputs allowed on one node
- **Thumbnail snapshots** - live frame preview per UDP-enabled player on the dashboard
- **Alerts** — Telegram Bot + email (SMTP) with SQLite-backed dedup (no duplicate alerts on hub restart)
- **Recovery alerts** — notifies when a previously off-air player returns to healthy
- **Heartbeat timeouts** — stale after 45s (orange), offline after 90s (gray)
- **One-click node bundle** - build a single node package with install/configure scripts, NSSM, and optional UDP tools so operators only click `install.bat`

---

## Architecture

### Health Domains

Three domains are always tracked separately — never merged into a single status:

| Domain | Values |
|--------|--------|
| `broadcast_health` | `healthy` · `degraded` · `off_air_likely` · `off_air_confirmed` · `unknown` |
| `runtime_health` | `healthy` · `paused` · `restarting` · `stalled` · `stopped` · `content_error` · `unknown` |
| `connectivity_health` | `online` · `stale` · `offline` |

### Dashboard Colour Logic

| Colour | Condition |
|--------|-----------|
| 🟢 Green | `broadcast=healthy` + `runtime=healthy` |
| 🟡 Yellow | `broadcast=degraded` OR `runtime` in `{paused, restarting, stalled, content_error}` |
| 🔴 Red | `broadcast` in `{off_air_likely, off_air_confirmed}` OR `runtime=stopped` |
| 🟠 Orange | `connectivity=stale` — heartbeat delayed, last known state shown |
| ⚫ Gray | `connectivity=offline` — heartbeat lost, state unknown |

### Identity Model

Each node authenticates by `node_id` + pre-shared Bearer token - never by IP address. Each player is identified by `player_id` inside the heartbeat payload. All traffic is outbound HTTPS from agent to hub. No port forwarding required on any site.

`hub_url` can point to a local LAN hub or a remote internet-facing hub. The node can keep running local checks without internet; internet is only needed when the hub is remote or when Telegram/email alerts must leave the LAN.

### Node and Player Model

- `node_id` identifies the physical Windows PC
- `player_id` identifies each playout player running on that node
- A node can carry 2-5 UDP inputs across one or more players
- UDP monitoring is optional per player and can be switched on or off independently

---

## Monitored Nodes and Players

| Node ID | Player ID(s) | Software | UDP |
|---------|--------------|----------|-----|
| `ny-main-pc` | `ny-main-insta-1`, `ny-main-insta-2`, `ny-main-admax-1` | Insta Playout + Admax | optional |
| `ny-backup-pc` | `ny-backup-admax-1`, `ny-backup-admax-2` | Admax | enabled on both players |
| `nj-optimum-pc` | `nj-optimum-insta-1` | Insta Playout | optional |
| `digicel-pc` | `digicel-admax-1` | Admax | enabled |

Each node may carry 2-5 UDP inputs where the site layout requires it. Inputs can be grouped under one player or spread across several players, and the player identifier remains the routing key for monitoring, alerting, and dashboard rendering.

---

## Project Structure

```
clarix-pulse/
├── packages/
│   ├── hub/                    # Node.js + Express + Socket.io hub
│   │   └── src/
│   │       ├── config/         # Node registry + node/player mapping
│   │       ├── routes/         # heartbeat, thumbnail, status endpoints
│   │       ├── services/       # state engine, alerting
│   │       └── store/          # SQLite (libsql) + in-memory cache
│   ├── dashboard/              # Vite + React + TypeScript + Tailwind
│   │   └── src/
│   │       ├── components/     # AlarmBanner, SiteGroup, InstanceCard, StatusBadge
│   │       └── hooks/          # useMonitoring, useAlarm
│   └── agent/                  # Python 3 → PyInstaller .exe
│       ├── agent.py            # Main loop
│       ├── monitors/           # process, log, file, connectivity, udp_probe
│       ├── config.example.yaml # Per-PC config template
│       └── install.bat         # NSSM Windows service installer
├── configs/                    # Site-specific agent configs
├── docs/                       # Full documentation
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── TECH_STACK.md
│   ├── DECISIONS.md            # Architecture Decision Records
│   ├── DEPLOYMENT.md
│   ├── AGENT_INSTALL.md
│   └── MONITORING_SPEC.md
└── .env.example                # Environment variable template
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Hub runtime | Node.js 20, TypeScript, Express, Socket.io |
| Database | SQLite via `@libsql/client` (WASM — zero native deps) |
| Dashboard | Vite, React 18, TypeScript, TailwindCSS |
| Agent | Python 3.11, PyInstaller standalone `.exe` |
| Stream probing | ffprobe + ffmpeg (must be staged with UDP-enabled agent bundles) |
| Alerts | Telegram Bot API + Nodemailer SMTP |
| Reverse proxy | Caddy (auto TLS) |
| Process manager | PM2 |
| Hosting | RackNerd VPS, Ubuntu 24.04 |
| DNS / CDN | Cloudflare (proxied, Full strict SSL) |

---

## Hub API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/heartbeat` | Bearer token | Agent reports observations |
| `POST` | `/api/thumbnail` | Bearer token | Agent uploads frame snapshot |
| `GET` | `/api/status` | — | All player states (dashboard load) |
| `GET` | `/api/health` | — | Hub liveness check |
| WS | `/socket.io` | — | Real-time state updates |

### Heartbeat Payload

```json
{
  "nodeId": "ny-backup-pc",
  "playerId": "ny-backup-admax-1",
  "timestamp": "2026-03-26T10:00:00Z",
  "observations": {
    "playout_process_up": 1,
    "playout_window_up": 1,
    "frame_delta_30s": 18,
    "log_last_token": null,
    "restart_events_15m": 0,
    "output_signal_present": 1,
    "output_freeze_seconds": 0,
    "output_black_ratio": 0.01,
    "output_audio_silence_seconds": 0,
    "internet_up": 1,
    "gateway_up": 1
  }
}
```

The agent sends **raw observations only**. The hub is the sole state engine - it derives all three health domains.

---

## Agent Monitoring Protocol

Every node agent runs these monitors on each poll cycle (default: 10s):

1. **Process monitor** — checks playout process and window presence via `psutil` + `pywin32`
2. **Log monitor** — tails new lines since last poll; detects Admax `stopxxx2`, `app_exited`, `reinit` tokens and Insta `Paused`, `Fully Played` tokens
3. **File monitor** — tracks `FilePosition`/`Frame` delta for stall detection; monitors FNF and playlist scan logs for content errors
4. **Connectivity monitor** — pings default gateway (local reachability) and `1.1.1.1` / `8.8.8.8` (internet reachability) independently
5. **UDP probe** *(players with UDP enabled)* - ffprobe stream presence check; ffmpeg freeze/black/silence detection; thumbnail capture compressed to <=50KB; when multiple inputs are enabled for one player, the agent evaluates them as a matrix and selects the best active source

---

## Deployment

### Hub (VPS)

```bash
# Clone
git clone https://github.com/AbiolaArowolo/clarix-pulse.git /var/www/clarix-pulse
cd /var/www/clarix-pulse

# Install + build
npm install
cd packages/hub && npm run build

# Install dashboard deps + build
cd ../dashboard && npm install && npm run build

# Configure environment
cp .env.example .env.local
nano .env.local   # fill in tokens and SMTP credentials
# Optional: place shared defaults in .env; .env.local overrides .env

# Start with PM2
pm2 start packages/hub/dist/index.js --name clarix-hub
pm2 save && pm2 startup
```

### Caddyfile

```caddy
pulse.clarixtech.com {
    reverse_proxy /api/* localhost:3001
    reverse_proxy /socket.io/* localhost:3001 {
        header_up Connection {http.upgrade}
        header_up Upgrade {http.upgrade}
    }
    root * /var/www/clarix-pulse/packages/dashboard/dist
    file_server
}
```

### Agent (Playout Node)

1. Build the one-click node bundle on the admin workstation:
   ```
   powershell -ExecutionPolicy Bypass -File packages/agent/build-node-bundle.ps1
   ```

   ```
   clarix-node-bundle/
   ├── clarix-agent.exe
   ├── ffmpeg.exe          (include in the bundle when UDP may be enabled)
   ├── ffprobe.exe         (include in the bundle when UDP may be enabled)
   ├── nssm.exe            (include in the bundle)
   ├── config.yaml         ← created or injected per node
   ├── config.example.yaml
   ├── install.bat
   ├── configure.bat
   └── uninstall.bat
   ```

2. Copy the generated bundle to the target PC and double-click `install.bat` as Administrator.

3. On first install, the script opens `config.yaml` so the node can be customized. Later changes can be made with `configure.bat`, which lets you enable or disable UDP per player and restart the service.

`packages/agent/dist/` contains the built `clarix-agent.exe`, and `packages/agent/build-node-bundle.ps1` can package it into a one-click node bundle together with `install.bat`, `configure.bat`, `uninstall.bat`, `nssm.exe`, and any optional UDP tools staged in `packages/agent/vendor/`.

See [docs/AGENT_INSTALL.md](docs/AGENT_INSTALL.md) for full per-site instructions.

---

## Environment Variables

```env
HUB_PORT=3001

# Telegram alerts
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Email alerts (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=alerts@clarixtech.com
SMTP_TO=support@clarixtech.com

# One token per node - maps node identity to allowed players
AGENT_TOKENS=ny-main-pc:token1,ny-backup-pc:token2,nj-optimum-pc:token3,digicel-pc:token4
```

Copy `.env.example` to `.env.local` for local secrets. The hub loads `.env` first and then `.env.local`, so `.env.local` can override shared defaults. Never commit either file — both are gitignored.

---

## Local Development

```bash
# Install all workspace dependencies
npm install

# Run hub (localhost:3001)
cd packages/hub && npm run dev

# Run dashboard (localhost:5173)
cd packages/dashboard && npm run dev

# Simulate a heartbeat
curl -X POST http://localhost:3001/api/heartbeat \
  -H "Authorization: Bearer token1" \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "ny-main-pc",
    "playerId": "ny-main-insta-1",
    "timestamp": "2026-03-26T10:00:00Z",
    "observations": {
      "playout_process_up": 1,
      "playout_window_up": 1,
      "frame_delta_30s": 10,
      "internet_up": 1,
      "gateway_up": 1
    }
  }'

# Simulate off-air
# Set playout_process_up: 0 -> dashboard goes red within 15s
```

---

## Documentation

Full documentation is in the [`docs/`](docs/) directory:

| File | Description |
|------|-------------|
| [PRD.md](docs/PRD.md) | Product requirements, goals, success metrics |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flows, component responsibilities |
| [TECH_STACK.md](docs/TECH_STACK.md) | Technology choices with rationale |
| [DECISIONS.md](docs/DECISIONS.md) | Architecture Decision Records (ADRs) |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | VPS + Cloudflare + Caddy setup guide |
| [AGENT_INSTALL.md](docs/AGENT_INSTALL.md) | Per-PC agent deployment instructions |
| [MONITORING_SPEC.md](docs/MONITORING_SPEC.md) | Full state decision matrix for all 7 players |

---

## Live Dashboard

**[pulse.clarixtech.com](https://pulse.clarixtech.com)**

## Mobile / PWA Install

The dashboard is mobile-responsive and installable as a PWA. Use `Install app` or `Add to Home Screen`
so operators can launch Pulse like a native app on phones and tablets. The dashboard also keeps a
persistent install bar with a QR code so a phone on the same LAN can open the current dashboard URL
quickly. If the dashboard is opened as `localhost`, switch to the PC's LAN IP before scanning so the
phone can reach it.

When UDP confirmation is not available, Pulse shows `paused` / `stopped` immediately but waits about
45 seconds before escalating that continuous runtime condition to a red OFF AIR alarm. The red alarm
clears automatically on the next healthy heartbeat after playback resumes.
