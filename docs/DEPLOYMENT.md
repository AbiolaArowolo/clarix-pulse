# Clarix Pulse - Deployment Guide

**Document Date**: `2026-03-29 -04:00`

## Purpose

This guide describes the current production deployment shape for Clarix Pulse after the tenant-auth dashboard rollout.

Current product shape:

- public landing page at `/`
- registration and login inside the same React app
- authenticated monitoring app under `/app`
- tenant-scoped API and Socket.IO data
- direct-download node artifacts under `/downloads`

---

## Production Components

### Hub

- Node.js + TypeScript
- Express + Socket.IO
- PostgreSQL

### Dashboard

- Vite build
- public landing, register, login, and authenticated app shell in one SPA

### Agent nodes

- Windows service
- local UI at `127.0.0.1:3210`
- discovery script
- tenant-scoped enrollment fallback
- provisioned `config.yaml` import path

---

## Required Environment Variables

Use [/.env.example](/D:/monitoring/.env.example) as the starting template.

Minimum hub configuration:

```env
HUB_PORT=3001
PULSE_DATABASE_URL=postgres://pulse_user:REPLACE_ME@127.0.0.1:5432/clarix_pulse
PULSE_COOKIE_SECURE=true
PULSE_THUMBNAIL_DIR=/var/lib/clarix-pulse/thumbnails
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=alerts@example.com
SMTP_TO=ops@example.com
TELEGRAM_BOT_TOKEN=
AGENT_TOKENS=
# Optional only if you want legacy bootstrap data carried into a legacy tenant:
# PULSE_ENABLE_LEGACY_BOOTSTRAP=true
```

Notes:

- `PULSE_DATABASE_URL` is required
- `PULSE_COOKIE_SECURE=true` is recommended behind HTTPS
- `SMTP_TO` seeds the legacy tenant only; new tenant defaults now come from registration email
- `AGENT_TOKENS` is still useful for migration or seeding known legacy nodes

---

## Recommended Linux Layout

```text
/var/www/clarix-pulse                  # repo checkout
/var/lib/clarix-pulse/thumbnails       # thumbnail cache
/var/www/clarix-pulse-downloads        # hosted node bundle/config files
/etc/clarix-pulse/.env.local           # env file or symlink target
```

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

Start the hub:

```bash
pm2 start packages/hub/dist/index.js --name clarix-hub --update-env
pm2 save
```

---

## Reverse Proxy Example

Use one origin so the dashboard, auth session cookie, API, and sockets all live together.

```caddy
pulse.clarixtech.com {
    root * /var/www/clarix-pulse/packages/dashboard/dist
    try_files {path} /index.html
    file_server

    handle_path /downloads/* {
        root * /var/www/clarix-pulse-downloads
        file_server
    }

    reverse_proxy /api/* localhost:3001
    reverse_proxy /socket.io/* localhost:3001 {
        header_up Connection {http.upgrade}
        header_up Upgrade {http.upgrade}
    }
}
```

This supports:

- `/` landing page
- `/login`
- `/register`
- `/app`
- `/app/onboarding`
- `/app/account`
- `/downloads/...`

Because the app is a single SPA, `try_files {path} /index.html` is required for deep links and refreshes.

---

## Authentication And Tenancy

The current hub is tenant-aware:

- `users`, `sessions`, and `tenants` are stored in PostgreSQL
- every browser session is tied to one tenant
- `/api/status` is session-protected
- dashboard config routes are session-protected
- Socket.IO joins a tenant room and only emits that tenant's state
- alert settings are tenant-scoped
- the registration email seeds that tenant's default off-air alert email

Agent traffic remains bearer-token based:

- `POST /api/heartbeat`
- `POST /api/thumbnail`
- `GET /api/config/node`

Local self-enrollment fallback remains available through:

- `POST /api/config/enroll`

That endpoint now resolves the tenant by the submitted enrollment key instead of using one global shared hub key.

---

## Hosted Node Artifacts

Recommended direct URLs:

```text
https://pulse.clarixtech.com/downloads/clarix-pulse/latest/clarix-pulse-v1.9.zip
https://pulse.clarixtech.com/downloads/nodes/<node-id>/config.yaml
```

Use direct URLs only:

- `install-from-url.ps1` uses a direct `http(s)` GET
- the local UI `Pull from link` feature also uses a direct `http(s)` GET

So do not use:

- login pages
- custom-header-only download flows
- interactive browser gates

Use:

- direct HTTPS files
- signed query-string URLs
- presigned URLs from S3/R2

Exact layout guide:

- [VPS_ARTIFACT_LAYOUT.md](/D:/monitoring/docs/VPS_ARTIFACT_LAYOUT.md)

---

## Validation Checklist

### Hub

```bash
curl -s http://localhost:3001/api/health
pm2 status --no-color
pm2 logs clarix-hub --lines 100 --nostream
```

### Dashboard

1. Open the public landing page.
2. Register a new test tenant.
3. Confirm the registration email appears as the default alert email in the account/onboarding flow.
4. Confirm `/app` redirects to login when signed out.
5. Confirm a new tenant dashboard starts with no nodes.

### Tenant isolation

1. Sign in as tenant A.
2. Confirm only tenant A nodes appear.
3. Sign out and sign in as tenant B.
4. Confirm tenant A nodes are not visible.

### Node flow

1. Upload a discovery report in the dashboard.
2. Provision a node.
3. Import the generated `config.yaml` into the local UI.
4. Confirm heartbeats appear only in the correct tenant.

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

If you refresh bundle artifacts for rollout:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\rebuild-node-bundles.ps1 -PruneReleaseRoot
powershell -ExecutionPolicy Bypass -File scripts\verify-bundle-parity.ps1
```

---

## Related Docs

- architecture: [ARCHITECTURE.md](/D:/monitoring/docs/ARCHITECTURE.md)
- onboarding: [ONBOARDING.md](/D:/monitoring/docs/ONBOARDING.md)
- agent install: [AGENT_INSTALL.md](/D:/monitoring/docs/AGENT_INSTALL.md)
- VPS downloads: [VPS_ARTIFACT_LAYOUT.md](/D:/monitoring/docs/VPS_ARTIFACT_LAYOUT.md)
