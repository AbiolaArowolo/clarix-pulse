# Clarix Pulse - Deployment Guide

**Document Date**: `2026-03-29 -04:00`

## Purpose

This guide describes the current production deployment shape for Clarix Pulse after the account-access, admin-control, signed-download, and deploy-trust updates.

Current product shape:

- public landing page at `/`
- registration and login inside the same React app
- authenticated monitoring app under `/app`
- admin-controlled tenant activation
- admin password-reset and workspace-support controls
- 365-day access keys
- self-service password reset links
- browser downloads for signed-in users
- secure expiring installer/config links for node-side pulls
- explicit deployed revision metadata through `/api/health` and `/api/version`
- artifact deployment where the live server is not treated as a trusted git checkout

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
PULSE_ADMIN_EMAILS=you@example.com
PULSE_ACCESS_KEY_TTL_DAYS=365
PULSE_PASSWORD_RESET_TTL_MINUTES=60
PULSE_DOWNLOAD_BUNDLE_NAME=clarix-pulse-v1.9.zip
PULSE_DOWNLOAD_SIGNING_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
PULSE_DOWNLOAD_LINK_TTL_MINUTES=1440
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM_NAME=Clarix Pulse
SMTP_FROM=alerts@example.com
TELEGRAM_BOT_TOKEN=
AGENT_TOKENS=
```

Notes:

- `PULSE_DATABASE_URL` is required
- `PULSE_COOKIE_SECURE=true` is recommended behind HTTPS
- `PULSE_ADMIN_EMAILS` defines who can use the `/app/admin` backend controls
- `PULSE_ACCESS_KEY_TTL_DAYS` controls new tenant key validity
- `PULSE_PASSWORD_RESET_TTL_MINUTES` controls how long reset links remain valid
- `PULSE_DOWNLOAD_SIGNING_SECRET` is required if you want secure installer/config links for node-side pulls
- `PULSE_DOWNLOAD_LINK_TTL_MINUTES` controls how long signed node-side download links remain valid
- `PULSE_DOWNLOAD_BUNDLE_PATH` is optional if you want the bundle served from a custom path
- `SMTP_*` must be configured if you want access keys and self-service password reset links emailed
- `SMTP_FROM_NAME` is optional branding for outbound account emails
- if SMTP is not configured, the UI falls back to showing the generated access key once during registration or renewal, and platform admins can copy one-time password reset links from `/app/admin`

---

## Recommended Linux Layout

```text
/var/www/clarix-pulse                  # live deployed application files
/var/lib/clarix-pulse/thumbnails       # thumbnail cache
/etc/clarix-pulse/.env.local           # env file or symlink target
```

The live application directory is artifact-deployed and is not the trusted source of revision truth.

The trusted runtime source is:

- `DEPLOYED_REVISION.json` in the live app directory
- `/api/version`
- `/api/health`

Those now report:

- `revision`
- `builtAt`
- `archiveName`
- `archiveSha256`
- `sourceDirty`

---

## Initial Deployment

### 1. Build and deploy from the repo

Use the deployment helper from the workspace:

```powershell
python scripts\vps_clean_redeploy.py --archive D:\monitoring\deploy\clarix-pulse-<sha>.tar.gz
```

That process now:

1. uploads the release archive and deployment metadata
2. verifies the remote archive SHA-256 before extraction
3. restores remote `.env` and `.env.local` into a staging directory
4. runs `npm ci` in staging
5. builds hub and dashboard in staging
6. cuts over only after the staged build is ready
7. verifies `/api/version` reports the expected deployed metadata
8. rolls back to the previous release if cutover verification fails

### 2. Start or restart the hub

The deploy script already does this, but the manual equivalent is:

```bash
pm2 start packages/hub/dist/index.js --name clarix-hub --update-env
pm2 save
systemctl reload caddy
```

---

## Reverse Proxy Example

Use one origin so the dashboard, auth session cookie, API, and sockets all live together.

```caddy
pulse.clarixtech.com {
    root * /var/www/clarix-pulse/packages/dashboard/dist
    try_files {path} /index.html
    file_server

    reverse_proxy /api/* localhost:3001
    reverse_proxy /socket.io/* localhost:3001 {
        header_up Connection {http.upgrade}
        header_up Upgrade {http.upgrade}
    }
}
```

This supports:

- `/`
- `/login`
- `/register`
- `/forgot-password`
- `/reset-password`
- `/app`
- `/app/onboarding`
- `/app/account`
- `/app/admin`
- `/api/downloads/...`

Because the app is a single SPA, `try_files {path} /index.html` is required for deep links and refreshes.

---

## Authentication And Access

The current hub is workspace-aware:

- `users`, `sessions`, and `tenants` are stored in PostgreSQL
- `password_reset_tokens` stores one-time hashed reset links with expiry
- `admin_audit_events` stores admin support actions for visibility and traceability
- every browser session is tied to one tenant
- new tenant registrations are disabled by default
- a 365-day access key is generated at registration
- sign-in requires email, password, and access key
- platform admins can enable or disable tenants and renew keys
- platform admins can issue password reset links and open a tenant workspace in support mode
- support mode is implemented as an impersonated customer session plus a saved admin return cookie
- users can request their own password reset link from `/forgot-password`
- `/api/status` and dashboard config routes are session-protected
- browser downloads require a signed-in session
- node-side direct pulls use secure expiring signed URLs minted by a signed-in user
- Socket.IO joins a tenant room and only emits that tenant's state
- alert settings are tenant-scoped
- the registration email seeds that tenant's default alert email

Agent traffic remains bearer-token based:

- `POST /api/heartbeat`
- `POST /api/thumbnail`
- `GET /api/config/node`

Local self-enrollment fallback remains available through:

- `POST /api/config/enroll`

That endpoint resolves the tenant by the submitted enrollment key and only works for enabled tenants.

---

## Installer And Config Downloads

Browser download routes:

```text
/api/downloads/bundle/windows/latest
/api/downloads/nodes/<node-id>/config.yaml
```

Signed-link generator routes:

```text
/api/downloads/bundle/windows/link
/api/downloads/nodes/<node-id>/config-link
```

Download behavior:

- browser users download through the session-authenticated routes
- node scripts and the local UI use the secure expiring URLs generated by the signed-link endpoints
- unsigned users cannot fetch the installer
- disabled tenants cannot sign in and should not be able to mint new links

---

## Validation Checklist

### Hub

```bash
curl -s http://localhost:3001/api/health
curl -s http://localhost:3001/api/version
pm2 status --no-color
pm2 logs clarix-hub --lines 100 --nostream
```

### Dashboard

1. Open the public landing page.
2. Register a new test tenant.
3. Confirm the access key is emailed, or confirm the fallback key is shown if SMTP is intentionally disabled.
4. Confirm the new account is blocked until enabled by a platform admin.
5. Confirm login requires email, password, and access key.
6. Confirm `/app` redirects to login when signed out.
7. Confirm a new enabled tenant dashboard starts with no nodes.
8. Confirm `Forgot password` sends a reset email when SMTP is configured.
9. Confirm `/app/admin` can issue a reset link and open a tenant workspace.
10. Confirm the support banner appears while impersonating and disappears after returning to admin.
11. Confirm the action appears in the admin activity feed.

### Downloads

1. Confirm the signed-in browser can download the installer.
2. Generate a secure installer link and confirm it works from a plain browser session or scripted GET.
3. Provision a node and confirm the secure config link works in the local UI `Pull from link` flow.

### Tenant isolation

1. Sign in as tenant A.
2. Confirm only tenant A nodes appear.
3. Sign out and sign in as tenant B.
4. Confirm tenant A nodes are not visible.

### Node flow

1. Download the installer from the signed-in app or create a secure installer link.
2. Upload a discovery report in the dashboard.
3. Provision a node.
4. Import the generated `config.yaml` into the local UI or paste the secure config link.
5. Confirm heartbeats appear only in the correct tenant.

---

## Related Docs

- architecture: [ARCHITECTURE.md](/D:/monitoring/docs/ARCHITECTURE.md)
- onboarding: [ONBOARDING.md](/D:/monitoring/docs/ONBOARDING.md)
- install guide: [AGENT_INSTALL.md](/D:/monitoring/docs/AGENT_INSTALL.md)
- artifact layout: [VPS_ARTIFACT_LAYOUT.md](/D:/monitoring/docs/VPS_ARTIFACT_LAYOUT.md)
