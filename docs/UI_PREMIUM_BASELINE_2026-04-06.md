# UI Premium Upgrade Baseline

Date: `2026-04-06`
Branch: `ui-premium-upgrade`
Base branch used: `master` (repo primary branch; no `main` branch was present locally)

## Baseline Summary

- Created isolated branch `ui-premium-upgrade` from `master`.
- Existing automated validation passed before UI work:
  - `node --import tsx --test packages/hub/test/*.test.ts`
  - Result: `18/18` passing
  - `npm run build`
  - Result: hub build passed, dashboard TypeScript build passed, Vite/PWA build passed
- VPS/public deployment health was verified on `2026-04-06`:
  - `https://pulse.clarixtech.com/api/health` returned `ok: true`
  - `https://pulse.clarixtech.com/api/version` reported revision `7778ec80e23d20bc3ff51e8127924e648773cf68`
  - Build timestamp reported by the live app: `2026-04-06T21:47:58Z`
- Read-only VPS probe confirmed:
  - `clarix-hub` online under PM2
  - disk healthy
  - memory healthy
  - current installer bundle present

## Local Runtime Constraint

Full local authenticated flow testing is blocked in the current workspace because the hub cannot start without PostgreSQL.

- Local dashboard dev server starts on `http://localhost:5173`
- Local hub startup fails against `127.0.0.1:5432`
- This means public pages can be validated directly, but `/app` flows cannot be executed locally against a real backend until a local PostgreSQL-backed hub is available

To keep Step 1 documented instead of stalled:

- public pages were screenshotted from the live VPS deployment
- protected page baselines were screenshotted from a mocked local authenticated session
- operator flows were mapped from source so later validation has an explicit checklist

## Operator Flows

1. Login
2. Onboarding
3. Dashboard
4. Remote setup
5. Node provision
6. Discovery import
7. Alerts display and alert contact editing
8. PWA install
9. Node removal reflection in dashboard state
10. Account
11. Installer/download flows
12. Install handoff
13. Logout/login again

## Screenshot Inventory

Public pages captured from the live deployment:

- `artifacts/ui-baseline/2026-04-06/public-landing.png`
- `artifacts/ui-baseline/2026-04-06/public-login.png`
- `artifacts/ui-baseline/2026-04-06/public-register.png`
- `artifacts/ui-baseline/2026-04-06/public-forgot-password.png`
- `artifacts/ui-baseline/2026-04-06/public-reset-password.png`
- `artifacts/ui-baseline/2026-04-06/public-install-handoff.png`

Protected pages captured from a mocked local authenticated session:

- `artifacts/ui-baseline/2026-04-06/mock-dashboard.png`
- `artifacts/ui-baseline/2026-04-06/mock-remote-setup.png`
- `artifacts/ui-baseline/2026-04-06/mock-onboarding.png`
- `artifacts/ui-baseline/2026-04-06/mock-account.png`

## Notes For Later Steps

- Remote setup is part of `/app`, not a separate route.
- Downloads are split across onboarding, account, dashboard provisioning, and install handoff.
- Live dashboard state depends on both `/api/status` and Socket.IO.
- Public HTTPS is healthy, but the VPS currently has a `caddy` reload hygiene issue related to `/var/log/caddy/access.log` permissions. Traffic is still serving successfully.
