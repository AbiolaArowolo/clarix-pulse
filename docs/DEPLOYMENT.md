# Pulse - Deployment Guide

**Document Date**: `2026-03-27 20:43:51 -04:00`

## Purpose

This guide covers the deployment model for the new Postgres-based hub and the `v1.6` agent bundle set.

Important scope note:

- this document describes the required production deployment shape
- the codebase was rebuilt and verified in this refactor pass
- a live Postgres server was not provisioned on this workstation during the same turn because neither `docker` nor `psql` was installed locally

---

## Production Components

### Hub

- Node.js + TypeScript
- PM2 process
- Express + Socket.IO
- PostgreSQL required

### Dashboard

- static Vite build
- served behind Caddy or equivalent reverse proxy

### Agent nodes

- Windows service
- persistent local UI at `127.0.0.1:3210`
- self-enrollment supported when `PULSE_ENROLLMENT_KEY` is configured on the hub

---

## Required Environment Variables

Use [/.env.example](/D:/monitoring/.env.example) as the source template.

Minimum hub configuration:

```env
HUB_PORT=3001
PULSE_DATABASE_URL=postgres://pulse_user:REPLACE_ME@127.0.0.1:5432/clarix_pulse
PULSE_ENROLLMENT_KEY=REPLACE_ME
PULSE_THUMBNAIL_DIR=/var/lib/clarix-pulse/thumbnails
TELEGRAM_BOT_TOKEN=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=alerts@example.com
SMTP_TO=ops@example.com
AGENT_TOKENS=node-a:token-a,node-b:token-b
```

Notes:

- `PULSE_DATABASE_URL` is now the main persistence setting
- `AGENT_TOKENS` remains useful for seeding known nodes during migration
- `PULSE_ENROLLMENT_KEY` is required for the generic self-registration flow

---

## Recommended Linux Layout

```text
/var/www/clarix-pulse                  # repo checkout
/var/lib/clarix-pulse/thumbnails       # thumbnail cache
/etc/clarix-pulse/.env.local           # env file or symlink target
/var/lib/postgresql/...                # Postgres data (or managed DB)
```

If you use a managed PostgreSQL service, only the thumbnail directory remains local.

---

## PostgreSQL Setup

### Database objects

Create:

- database: `clarix_pulse`
- application user with normal DDL/DML rights on that database

Example connection string:

```text
postgres://pulse_user:strong_password@127.0.0.1:5432/clarix_pulse
```

If you use a managed provider:

- append `?sslmode=require` when required
- or set `PULSE_DATABASE_SSL=true`

The hub creates its own tables on first boot.

---

## Initial Deployment

```bash
cd /var/www
git clone <repo-url> clarix-pulse
cd clarix-pulse

cp .env.example .env.local
nano .env.local

npm install
npm run build
```

Then start the hub:

```bash
pm2 start packages/hub/dist/index.js --name clarix-hub --update-env
pm2 save
```

Checks:

```bash
pm2 status
pm2 logs clarix-hub --lines 100
curl -s http://localhost:3001/api/health
```

Expected startup shape:

- `[hub] Pulse hub running on port 3001`
- `[hub] PostgreSQL state initialised for ... tracked instances`
- `[hub] Database: postgres://...`
- `[hub] Thumbnail cache: /var/lib/clarix-pulse/thumbnails`

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

Reload:

```bash
systemctl reload caddy
```

---

## Standard Update Flow

```bash
cd /var/www/clarix-pulse
git pull
npm install
npm run build
pm2 restart clarix-hub --update-env
systemctl reload caddy
```

If bundle artifacts also need refreshing for operator rollout:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\rebuild-node-bundles.ps1 -PruneReleaseRoot
powershell -ExecutionPolicy Bypass -File scripts\verify-bundle-parity.ps1
```

---

## Migration Guidance From SQLite

This codebase no longer uses SQLite for the hub runtime.

Recommended production cutover order:

1. provision PostgreSQL
2. set `PULSE_DATABASE_URL`
3. keep `AGENT_TOKENS` populated for existing nodes during first startup
4. start the new hub so it bootstraps `sites`, `nodes`, `players`, and `agent_tokens`
5. enroll new generic nodes with `PULSE_ENROLLMENT_KEY`
6. decommission old SQLite repair scripts after the operational migration is complete

Important caveat:

- there is no in-turn live data migration executed in this refactor pass
- any existing SQLite state that still matters operationally must be migrated or recreated during deployment planning

---

## Validation Checklist

### Hub

```bash
curl -s http://localhost:3001/api/health
pm2 status --no-color
pm2 logs clarix-hub --lines 100 --nostream
```

### Dashboard

```bash
curl -s https://pulse.example.com/api/health
```

### Agent enrollment

Confirm a generic node can:

1. save local config with an enrollment key
2. receive a fresh agent token
3. heartbeat successfully
4. appear in the dashboard grouped under its site

---

## Current Notes

- no live Postgres server was provisioned on this workstation during the refactor pass
- the production VPS was later cut over to PostgreSQL on `2026-03-27` and is running hub commit `298f858`
- prepared per-node bundles still ship for convenience, even though the generic installer is now the intended main path

For the timestamped release and challenge log, see [RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
