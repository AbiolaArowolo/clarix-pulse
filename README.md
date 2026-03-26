# Clarix Pulse

Real-time broadcast monitoring for NOIRE TV playout infrastructure across 4 sites and 7 instances.

---

## Overview

Clarix Pulse is a self-hosted monitoring system that detects off-air events, distinguishes playout software failure from network loss, and alerts operators via Telegram and email — all within seconds.

It replaces manual checking across multiple playout PCs running Insta Playout and Admax software.

```
[Playout PCs]  ──  Python Agent  ──►  [Hub: VPS Node.js + SQLite]
  NY Main                                      │ Socket.io
  NY Backup       POST /api/heartbeat          ▼
  NJ Optimum      POST /api/thumbnail    [React Dashboard]
  FL Digicel                              pulse.clarixtech.com
```

---

## Features

- **Live dashboard** — colour-coded health cards per instance, grouped by site
- **Three independent health domains** — broadcast, runtime, and connectivity tracked separately
- **Deep log monitoring** — validated primary signal for both Insta Playout and Admax
- **UDP stream probing** — agent-side ffprobe/ffmpeg for sites with encoder LAN access
- **Thumbnail snapshots** — live frame preview per instance on the dashboard
- **Alerts** — Telegram Bot + email (SMTP) with SQLite-backed dedup (no duplicate alerts on hub restart)
- **Recovery alerts** — notifies when a previously off-air instance returns to healthy
- **Heartbeat timeouts** — stale after 45s (orange), offline after 90s (gray)
- **Single deployment package** — one `.exe` bundle per PC, only `config.yaml` differs

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

Agents authenticate by `agent_id` + pre-shared Bearer token — never by IP address. All traffic is outbound HTTPS from agent to hub. No port forwarding required on any site.

---

## Monitored Instances

| ID | Site | Software | UDP Probe |
|----|------|----------|-----------|
| `ny-main-insta-1` | NY Main | Insta Playout | — |
| `ny-main-insta-2` | NY Main | Insta Playout | — |
| `ny-main-admax-1` | NY Main | Admax | — |
| `ny-backup-admax-1` | NY Backup | Admax | enabled |
| `ny-backup-admax-2` | NY Backup | Admax | enabled |
| `nj-optimum-admax-1` | NJ Optimum | Admax | — |
| `digicel-admax-1` | FL Digicel | Admax | enabled |

---

## Project Structure

```
clarix-pulse/
├── packages/
│   ├── hub/                    # Node.js + Express + Socket.io hub
│   │   └── src/
│   │       ├── config/         # Instance registry + agent→instance mapping
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
| Stream probing | ffprobe + ffmpeg (bundled with agent) |
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
| `GET` | `/api/status` | — | All instance states (dashboard load) |
| `GET` | `/api/health` | — | Hub liveness check |
| WS | `/socket.io` | — | Real-time state updates |

### Heartbeat Payload

```json
{
  "agentId": "ny-backup-pc",
  "instanceId": "ny-backup-admax-1",
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

The agent sends **raw observations only**. The hub is the sole state engine — it derives all three health domains.

---

## Agent Monitoring Protocol

Every agent runs these monitors on each poll cycle (default: 10s):

1. **Process monitor** — checks playout process and window presence via `psutil` + `pywin32`
2. **Log monitor** — tails new lines since last poll; detects Admax `stopxxx2`, `app_exited`, `reinit` tokens and Insta `Paused`, `Fully Played` tokens
3. **File monitor** — tracks `FilePosition`/`Frame` delta for stall detection; monitors FNF and playlist scan logs for content errors
4. **Connectivity monitor** — pings default gateway (local reachability) and `1.1.1.1` / `8.8.8.8` (internet reachability) independently
5. **UDP probe** *(UDP-enabled instances only)* — ffprobe stream presence check; ffmpeg freeze/black/silence detection; thumbnail capture compressed to ≤50KB

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
cp .env.example .env
nano .env   # fill in tokens and SMTP credentials

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

### Agent (Playout PC)

1. Copy the deployment package to the PC:
   ```
   clarix-agent-v1.0/
   ├── clarix-agent.exe
   ├── ffmpeg.exe          (UDP-enabled sites only)
   ├── nssm.exe
   ├── config.yaml         ← edit this per PC
   └── install.bat
   ```

2. Edit `config.yaml` with the correct `agent_id`, `agent_token`, instance paths, and (if applicable) UDP stream URLs.

3. Double-click `install.bat` — registers `clarix-agent.exe` as a Windows service (auto-start on boot).

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
SMTP_TO=support@caspenmedia.com

# One token per PC — maps agent identity to allowed instances
AGENT_TOKENS=ny-main-pc:token1,ny-backup-pc:token2,nj-optimum-pc:token3,digicel-pc:token4
```

Copy `.env.example` to `.env` and fill in values. Never commit `.env` — it is gitignored.

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
    "agentId": "ny-main-pc",
    "instanceId": "ny-main-insta-1",
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
# Set playout_process_up: 0 → dashboard goes red within 15s
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
| [MONITORING_SPEC.md](docs/MONITORING_SPEC.md) | Full state decision matrix for all 7 instances |

---

## Live Dashboard

**[pulse.clarixtech.com](https://pulse.clarixtech.com)**
