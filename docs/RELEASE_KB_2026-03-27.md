# Clarix Pulse Release Knowledge Base - 2026-03-27

**Prepared**: `2026-03-29 -04:00`

## Scope

This KB now reflects the current product state after:

- tenant-aware auth and dashboard gating
- registration/login/account experience
- tenant-scoped status, sockets, and alert settings
- discovery-first onboarding
- removal of prepared site-specific release bundles
- clarification of the single `clarix-pulse` installer path

---

## Current Product Truth

- the public site opens to a landing page, not the monitoring board
- users register with email and password
- the registration email becomes the default off-air alert email for that tenant
- `/app` requires an authenticated session
- new tenants start with no nodes
- nodes appear only after their local setup mirrors into that tenant
- one default installer bundle is supported: `clarix-pulse-v1.9`

---

## Current Release Artifact

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

Supported bundle:

| Bundle | Zip Path | SHA256 |
|---|---|---|
| `clarix-pulse-v1.9` | [clarix-pulse-v1.9.zip](/D:/monitoring/packages/agent/release/clarix-pulse-v1.9.zip) | `4726F5CC889DE6A378DE35C46047BB00F7050E35474EEB77D38D807D44A32572` |

Common agent executable hash:

```text
clarix-agent.exe SHA256
6F98BFDB5E2C7A3AEA6E8550313A2D454045EFAF3E2F05F357C885D0C9787367
```

Manifest:

- [node-bundles.json](/D:/monitoring/configs/node-bundles.json)

---

## Key Code Areas Updated

### Hub

- auth/session store: [auth.ts](/D:/monitoring/packages/hub/src/store/auth.ts)
- request/session helpers: [serverAuth.ts](/D:/monitoring/packages/hub/src/serverAuth.ts)
- DB bootstrap: [db.ts](/D:/monitoring/packages/hub/src/store/db.ts)
- tenant-aware registry: [registry.ts](/D:/monitoring/packages/hub/src/store/registry.ts)
- auth routes: [auth.ts](/D:/monitoring/packages/hub/src/routes/auth.ts)
- config routes: [config.ts](/D:/monitoring/packages/hub/src/routes/config.ts)
- status route: [status.ts](/D:/monitoring/packages/hub/src/routes/status.ts)
- heartbeat route: [heartbeat.ts](/D:/monitoring/packages/hub/src/routes/heartbeat.ts)
- thumbnail route: [thumbnail.ts](/D:/monitoring/packages/hub/src/routes/thumbnail.ts)

### Dashboard

- app shell: [App.tsx](/D:/monitoring/packages/dashboard/src/App.tsx)
- auth provider: [AuthProvider.tsx](/D:/monitoring/packages/dashboard/src/features/auth/AuthProvider.tsx)
- landing page: [LandingPage.tsx](/D:/monitoring/packages/dashboard/src/pages/LandingPage.tsx)
- login page: [LoginPage.tsx](/D:/monitoring/packages/dashboard/src/pages/LoginPage.tsx)
- register page: [RegisterPage.tsx](/D:/monitoring/packages/dashboard/src/pages/RegisterPage.tsx)
- monitoring page: [MonitoringDashboardPage.tsx](/D:/monitoring/packages/dashboard/src/pages/MonitoringDashboardPage.tsx)

### Agent

- local UI and import flow: [agent.py](/D:/monitoring/packages/agent/agent.py)
- discovery script: [discover-node.ps1](/D:/monitoring/packages/agent/discover-node.ps1)
- URL bundle pull helper: [install-from-url.ps1](/D:/monitoring/packages/agent/install-from-url.ps1)

---

## Validation Completed

- `npm run build --workspace=packages/hub`
- `npm run build --workspace=packages/dashboard`
- `python -m py_compile packages/agent/agent.py packages/agent/playout_profiles.py`
- `powershell -ExecutionPolicy Bypass -File scripts\rebuild-node-bundles.ps1 -PruneReleaseRoot`
- `powershell -ExecutionPolicy Bypass -File scripts\verify-bundle-parity.ps1`

---

## Documentation Updated

- [AGENT_INSTALL.md](/D:/monitoring/docs/AGENT_INSTALL.md)
- [ONBOARDING.md](/D:/monitoring/docs/ONBOARDING.md)
- [DEPLOYMENT.md](/D:/monitoring/docs/DEPLOYMENT.md)
- [VPS_ARTIFACT_LAYOUT.md](/D:/monitoring/docs/VPS_ARTIFACT_LAYOUT.md)
- [ARCHITECTURE.md](/D:/monitoring/docs/ARCHITECTURE.md)
- [PRD.md](/D:/monitoring/docs/PRD.md)
- [DECISIONS.md](/D:/monitoring/docs/DECISIONS.md)
