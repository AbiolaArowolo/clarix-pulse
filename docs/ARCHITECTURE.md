# Clarix Pulse - Architecture

**Document Date**: `2026-03-29 -04:00`

## System Model

Clarix Pulse now has three major layers:

1. Windows node runtime
2. tenant-aware hub API
3. public/authenticated web app

```text
Windows node
  -> local UI + config.yaml
  -> ClarixPulseAgent service
  -> hub API
  -> PostgreSQL
  -> tenant-scoped dashboard
```

---

## Ownership Model

### Local node remains authoritative for machine-specific settings

The node owns:

- `node_id`
- `node_name`
- `site_id`
- `hub_url`
- local player list
- playout profile
- paths
- process selectors
- log selectors
- UDP inputs

Primary local editing surface:

- `http://127.0.0.1:3210/`

Current node-side import helpers:

- discovery report upload
- provisioned `config.yaml` upload
- direct `config.yaml` pull from a direct HTTPS URL

### Hub remains authoritative for central operational state

The hub owns:

- tenant, user, and session records
- tenant access status and access-key expiry
- nodes, players, and agent tokens
- monitoring enabled / disabled
- maintenance mode
- tenant alert settings
- instance state and events
- mirrored node config

### Dashboard role

The dashboard now does three things:

- public landing and account access
- authenticated tenant operations
- remote provisioning and read-only node-config visibility

---

## Authentication And Tenancy

The browser side is no longer global:

- `/` is the landing page
- `/login` is the login page
- `/register` is the registration page
- `/app` and its subpages require a valid session

The hub now stores:

- `tenants`
- `users`
- `sessions`
- `password_reset_tokens`
- `admin_audit_events`
- tenant access state and 365-day access keys
- tenant-scoped alert settings

Realtime state is tenant-scoped:

- `/api/status` requires a valid session
- config routes for dashboard use require a valid session
- Socket.IO authenticates with the browser session cookie
- each socket joins a tenant room
- status and thumbnail updates emit only to that tenant room

Important product rule:

- the registration email seeds the default alert email for that tenant
- that alert email can later be changed from the dashboard
- new accounts stay disabled until a platform admin enables them
- users can request a password reset from `/forgot-password`
- platform admins can issue a password reset or open a tenant workspace from `/app/admin`
- support-mode workspace access is implemented as an impersonated session with a saved admin return session cookie
- signed-in browser downloads use `/api/downloads`
- node-side direct pulls use secure expiring links minted from the signed-in dashboard

---

## Node Registration Model

Clarix Pulse supports two node bootstrap patterns:

### Preferred path

1. run discovery on the Windows node
2. upload the discovery report in the signed-in dashboard
3. provision the node from that tenant dashboard
4. import the downloaded `config.yaml` into the local UI

### Fallback path

- local self-enrollment with the tenant's enrollment key

`POST /api/config/enroll` is still supported, but it now resolves the tenant by the submitted enrollment key instead of using one shared global key.

---

## Persistence Model

Hub persistence is PostgreSQL in [db.ts](/D:/monitoring/packages/hub/src/store/db.ts).

Main tables:

- `tenants`
- `users`
- `sessions`
- `password_reset_tokens`
- `admin_audit_events`
- `sites`
- `nodes`
- `players`
- `agent_tokens`
- `instance_state`
- `events`
- `tenant_alert_settings`
- `instance_controls`
- `node_config_mirror`

Thumbnail bytes remain file-cached outside the main state table in [thumbnails.ts](/D:/monitoring/packages/hub/src/store/thumbnails.ts).

Deployed revision metadata is exposed from [buildInfo.ts](/D:/monitoring/packages/hub/src/buildInfo.ts) through `/api/health` and `/api/version`.

---

## Bundle Model

The product-facing installer baseline is now:

- `clarix-pulse-v1.9`

Prepared site-specific release bundles were removed from the supported path.

That means rollout now assumes:

- one default software bundle
- tenant-specific config generated at provisioning time

---

## Key Files

- hub auth/session state: [auth.ts](/D:/monitoring/packages/hub/src/store/auth.ts)
- hub request/session helpers: [serverAuth.ts](/D:/monitoring/packages/hub/src/serverAuth.ts)
- hub DB bootstrapping: [db.ts](/D:/monitoring/packages/hub/src/store/db.ts)
- tenant-aware registry: [registry.ts](/D:/monitoring/packages/hub/src/store/registry.ts)
- config routes: [config.ts](/D:/monitoring/packages/hub/src/routes/config.ts)
- status route: [status.ts](/D:/monitoring/packages/hub/src/routes/status.ts)
- heartbeat route: [heartbeat.ts](/D:/monitoring/packages/hub/src/routes/heartbeat.ts)
- auth route: [auth.ts](/D:/monitoring/packages/hub/src/routes/auth.ts)
- admin route: [admin.ts](/D:/monitoring/packages/hub/src/routes/admin.ts)
- downloads route: [downloads.ts](/D:/monitoring/packages/hub/src/routes/downloads.ts)
- dashboard shell: [App.tsx](/D:/monitoring/packages/dashboard/src/App.tsx)
- dashboard auth provider: [AuthProvider.tsx](/D:/monitoring/packages/dashboard/src/features/auth/AuthProvider.tsx)
- agent runtime and local UI: [agent.py](/D:/monitoring/packages/agent/agent.py)
