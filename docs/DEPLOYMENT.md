# Pulse - Hub And VPS Deployment Guide

**Document Date**: 2026-03-27

## Purpose

This guide covers the current production deployment model for the Pulse hub and dashboard.

It reflects the release state after the March 27, 2026 hardening pass:

- external state DB path adopted through `PULSE_DB_PATH`
- dashboard deployed behind Caddy
- PM2-managed hub process
- node-local configuration as the source of truth
- static commissioned node/player registry still in place

---

## Current Production Facts

### Hub Runtime

- Node.js + TypeScript
- PM2 process: `clarix-hub`
- reverse proxy: Caddy
- current state store: SQLite via `@libsql/client`

### Current Constraints

- nodes are authenticated with `AGENT_TOKENS`
- allowed player ownership is still enforced through the static hub registry in [packages/hub/src/config/instances.ts](/D:/monitoring/packages/hub/src/config/instances.ts)
- dashboard mirrors node config but does not currently own machine-local editing

---

## Required Environment Variables

The current environment template is [/.env.example](/D:/monitoring/.env.example).

Important fields:

```env
HUB_PORT=3001
PULSE_DB_PATH=/var/lib/clarix-pulse/clarix.db
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=alerts@yourdomain.com
SMTP_TO=ops@yourdomain.com
AGENT_TOKENS=node-a:token-a,node-b:token-b
CONFIG_WRITE_KEY=
```

### Database Path

Use an external persistent DB path:

```env
PULSE_DB_PATH=/var/lib/clarix-pulse/clarix.db
```

Do not rely on the in-app `packages/hub/data` path for production persistence.

---

## Recommended Server Layout

```text
/var/www/clarix-pulse                  # application checkout
/var/lib/clarix-pulse/clarix.db        # external state database
/root/.pm2                             # PM2 runtime state
```

---

## Initial Build

```bash
cd /var/www
git clone <repo-url> clarix-pulse
cd clarix-pulse

cp .env.example .env.local
nano .env.local

npm install
npm run build --workspace=packages/hub
npm run build --workspace=packages/dashboard
```

---

## Reverse Proxy Example

```caddy
pulse.example.com {
    reverse_proxy /api/* localhost:3001
    reverse_proxy /socket.io/* localhost:3001 {
        header_up Connection {http.upgrade}
        header_up Upgrade {http.upgrade}
    }
    root * /var/www/clarix-pulse/packages/dashboard/dist
    file_server
}
```

Then:

```bash
systemctl reload caddy
systemctl enable caddy
```

---

## Starting The Hub

```bash
cd /var/www/clarix-pulse
pm2 start packages/hub/dist/index.js --name clarix-hub --update-env
pm2 save
```

Checks:

```bash
pm2 status
pm2 logs clarix-hub --lines 100
curl -s http://localhost:3001/api/health
```

---

## Standard Update Flow

```bash
cd /var/www/clarix-pulse
git pull
npm install
npm run build --workspace=packages/hub
npm run build --workspace=packages/dashboard
pm2 restart clarix-hub --update-env
systemctl reload caddy
```

If using the repo helper:

- [scripts/vps_clean_redeploy.py](/D:/monitoring/scripts/vps_clean_redeploy.py)

That script preserves `.env` / `.env.local` and avoids dragging the bundled app-tree DB back into the fresh deploy.

---

## Verification Checklist

### Basic Hub Checks

```bash
curl -s http://localhost:3001/api/health
pm2 status --no-color
```

### Public Checks

```bash
curl -s https://pulse.clarixtech.com/api/health
```

### Logs

```bash
pm2 logs clarix-hub --lines 100 --nostream
```

Look for:

- `[hub] Pulse hub running on port 3001`
- `[hub] State DB path: /var/lib/clarix-pulse/clarix.db`

---

## Backups And Repair

### Backup

Back up the external DB file, not the old app-tree path:

```bash
cp /var/lib/clarix-pulse/clarix.db /var/lib/clarix-pulse/clarix.db.bak
```

### Repair / Reset Helper

Current helper:

- [scripts/vps_repair_state_db.py](/D:/monitoring/scripts/vps_repair_state_db.py)

Important behavior:

- it stops the hub
- moves the current DB aside with a timestamped suffix
- starts the hub against a fresh DB

This is a recovery / reset action, not a full logical repair. Persisted hub state such as alert settings, maintenance flags, mirrored config, and thumbnails will need to repopulate.

---

## Known Production Risks

As of March 27, 2026:

- the VPS still shows `SQLITE_CORRUPT` in live hub logs
- Telegram alert delivery has at least one invalid configured target
- thumbnail blobs are still stored inline in the hub DB
- onboarding new nodes still requires static registry and token updates on the hub

These are operationally important and should be tracked in the next engineering phase.

---

## Recommended Next Architecture Step

For the next major phase:

1. move hub persistence to PostgreSQL
2. replace static registry with DB-backed nodes / players / tokens
3. add dynamic enrollment for new nodes
4. keep local node config authoritative for machine-local paths and UDP inputs

For the full timestamped release record, see [docs/RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
