# Pulse

Multi-site broadcast monitoring for playout operations across regions, channels, and customers.

---

## Overview

Pulse is a self-hosted monitoring platform for broadcast and playout environments. It detects off-air events, distinguishes runtime failure from connectivity loss, and gives operators a live dashboard with alerting and optional UDP stream confirmation.

The system is designed to scale across multiple businesses, multiple sites, and multiple node layouts. Customer-specific node names, tokens, domains, and stream URLs belong in local configuration and deployment assets, not in the product model itself.

```text
[Playout Nodes]  -->  [Local Agent]  -->  [Hub API + State Engine]  -->  [Web Dashboard / PWA]
   Site A                  Windows              Node.js + SQLite              Browser / Mobile
   Site B                  Service              Alerts + Socket updates        Live operations view
   Site C
```

---

## Core Capabilities

- Live dashboard with health cards per player and per site
- Three separate health domains: broadcast, runtime, and connectivity
- Deep monitoring for supported playout software such as Insta and Admax
- Optional UDP stream probing with `ffprobe` and `ffmpeg`
- One-click node installation with bundled runtime dependencies
- Managed per-node configuration bundles built from a shared baseline
- Hub-managed UDP stream settings that sync back down to the node
- Alerting through Telegram and email with persisted state and dedup
- Mobile-friendly PWA interface for on-call monitoring

---

## Health Model

Pulse keeps three health domains separate instead of collapsing everything into one status.

| Domain | Values |
|--------|--------|
| `broadcast_health` | `healthy`, `degraded`, `off_air_likely`, `off_air_confirmed`, `unknown` |
| `runtime_health` | `healthy`, `paused`, `restarting`, `stalled`, `stopped`, `content_error`, `unknown` |
| `connectivity_health` | `online`, `stale`, `offline` |

### Dashboard Color Rules

| Color | Meaning |
|------|---------|
| Green | Broadcast and runtime are healthy |
| Yellow | Degraded runtime or degraded broadcast, but not confirmed off-air |
| Red | Off-air likely or confirmed |
| Orange | Heartbeats are stale, last known state is still shown |
| Gray | Node is offline or not yet commissioned |

### Runtime Escalation Rules

When UDP confirmation is not available:

- `paused` shows immediately and escalates to red after about 60 seconds of continuous pause
- `stopped` and `stalled` escalate to red after about 45 seconds
- a healthy runtime heartbeat clears the alarm automatically

---

## Node and Player Model

- `node_id` identifies a physical playout PC or server
- `player_id` identifies one playout source running on that node
- one node can host multiple players
- each player can have zero to five UDP inputs
- UDP monitoring is optional and can be enabled per player

This makes the same platform usable for:

- single-site operations with one player
- regional deployments with several playout nodes
- multi-customer service providers managing many tenants

### Example Topology

| Node ID | Player IDs | Software | UDP |
|--------|------------|----------|-----|
| `site-a-node-1` | `site-a-insta-1`, `site-a-insta-2` | Insta | optional |
| `site-a-node-2` | `site-a-admax-1` | Admax | optional |
| `site-b-node-1` | `site-b-admax-1`, `site-b-admax-2` | Admax | enabled on selected players |
| `site-c-node-1` | `site-c-insta-1` | Insta | optional |

---

## Architecture

### Hub

- Node.js + Express API
- Socket-driven live updates
- SQLite-backed state store
- Alert evaluation and delivery
- Optional central config editing for UDP inputs

### Agent

- Python-based Windows agent packaged as a standalone `.exe`
- Runs as a Windows service
- Polls local process, log, file, connectivity, and optional UDP signals
- Sends raw observations to the hub

### Dashboard

- React + Vite frontend
- Real-time updates over Socket.IO with polling fallback
- PWA install support for desktop and mobile

---

## Project Structure

```text
clarix-pulse/
|-- packages/
|   |-- hub/                    # Hub API and state engine
|   |-- dashboard/              # Web UI / PWA
|   `-- agent/                  # Windows agent and bundle tooling
|-- configs/                    # Deployment-specific node configs
|-- docs/                       # Product, architecture, and deployment docs
|-- scripts/                    # Rebuild, verification, and deployment helpers
`-- .env.example                # Environment template
```

---

## Hub API

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| `POST` | `/api/heartbeat` | Bearer token | Node reports raw observations |
| `POST` | `/api/thumbnail` | Bearer token | Node uploads UDP thumbnail preview |
| `GET` | `/api/status` | none | Dashboard snapshot |
| `GET` | `/api/health` | none | Hub liveness |
| `GET` | `/api/config/player/:playerId` | `x-config-write-key` | Read editable UDP config |
| `POST` | `/api/config/player/:playerId` | `x-config-write-key` | Save editable UDP config |
| `WS` | `/socket.io` | none | Real-time dashboard updates |

### Example Heartbeat

```json
{
  "nodeId": "site-a-node-2",
  "playerId": "site-a-admax-1",
  "timestamp": "2026-03-27T12:00:00Z",
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

The hub is the only place that computes health. Agents send observations, not final status labels.

---

## One-Click Node Installation

Each node bundle is built as a self-contained install package with:

- `clarix-agent.exe`
- `install.bat`
- `configure.bat`
- `uninstall.bat`
- `config.yaml`
- `config.example.yaml`
- `nssm.exe`
- `ffmpeg.exe`
- `ffprobe.exe`

`clarix-agent.exe` is included as part of the bundle, but the operator install action is to run `install.bat`. The batch installer uses the EXE automatically.

### Install Flow

1. Build or select the correct node bundle.
2. Copy the bundle to the target node.
3. Run `install.bat` as Administrator.

That is the only install step for the node. No separate Python, NSSM, ffmpeg, ffprobe, or manual `clarix-agent.exe` launch is required.

### After Install

- the agent service is installed and started
- the bundled `config.yaml` is used for that node
- later UDP stream changes can be made from the dashboard or with `configure.bat`
- no rebuild is needed just to change stream URLs

---

## Bundle Management

Use the shared bundle tooling to keep every node package aligned from the same software baseline.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\rebuild-node-bundles.ps1 -PruneReleaseRoot
powershell -ExecutionPolicy Bypass -File scripts\verify-bundle-parity.ps1
```

Or:

```powershell
npm run agent:refresh-bundles
```

The goal is:

- same installer/runtime shape across all nodes
- only node-specific `config.yaml` differences per deployment
- easier rollout to many customers and regions without drift

---

## Deployment

### Hub

```bash
git clone <your-repo-url> /var/www/clarix-pulse
cd /var/www/clarix-pulse
npm install
npm run build --workspace=packages/hub
npm run build --workspace=packages/dashboard
```

Use your own domain, for example:

```caddy
monitor.example.com {
    reverse_proxy /api/* localhost:3001
    reverse_proxy /socket.io/* localhost:3001 {
        header_up Connection {http.upgrade}
        header_up Upgrade {http.upgrade}
    }
    root * /var/www/clarix-pulse/packages/dashboard/dist
    file_server
}
```

### Agent Bundles

Build deployment-ready bundles from the checked-in config set:

```powershell
powershell -ExecutionPolicy Bypass -File packages/agent/build-node-bundle.ps1
```

Reference configs under `configs/` should be treated as deployment-specific assets. Replace node IDs, tokens, hub URLs, and stream URLs for each business or tenant.

---

## Environment Variables

```env
HUB_PORT=3001

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=alerts@yourdomain.com
SMTP_TO=ops@yourcompany.com

AGENT_TOKENS=site-a-node-1:token1,site-a-node-2:token2,site-b-node-1:token3

CONFIG_WRITE_KEY=replace-with-a-random-secret
```

`CONFIG_WRITE_KEY` protects dashboard-side UDP config editing. It is not a stream URL.

Alert recipients can also be managed from the dashboard or mobile PWA once `CONFIG_WRITE_KEY` is set. The hub stores up to 3 email recipients, 3 Telegram chat IDs, and 3 phone numbers without exposing SMTP or bot secrets in the browser.

---

## Scalability Notes

Pulse is intended to support:

- one customer with one site
- one customer with many sites
- one service provider supporting many customers
- different software mixes across different regions

To keep it reusable:

- keep customer names out of the product-facing README and UI shell
- keep deployment-specific details in config files, env files, and private operations docs
- rebuild all node bundles from a shared baseline

---

## Documentation

See `docs/` for deeper implementation and deployment material:

- `docs/ARCHITECTURE.md`
- `docs/TECH_STACK.md`
- `docs/DEPLOYMENT.md`
- `docs/AGENT_INSTALL.md`
- `docs/MONITORING_SPEC.md`
- `docs/DECISIONS.md`

---

## PWA / Mobile

The dashboard is installable as a PWA for phones, tablets, and desktops. This makes it suitable for remote operations teams, on-call engineering, and distributed monitoring workflows.
