# UI Premium Upgrade Post-Deploy Validation

Date: `2026-04-06`
Branch: `ui-premium-upgrade`
Live revision: `ef5d3660e3e9abbd1638d775db8fa694641fdfdc`
Live archive: `clarix-pulse-ef5d366.tar.gz`

## Deployment Result

- VPS redeployed successfully with the upgraded UI.
- `/api/health` returned `ok: true` after cutover.
- `/api/version` reported revision `ef5d3660e3e9abbd1638d775db8fa694641fdfdc`.
- Public and authenticated browser validation both passed against the live deployment.

## Live Validation Summary

- Public pages checked:
  - login
  - register
  - forgot password
  - mobile login responsiveness
- Authenticated pages checked:
  - dashboard
  - account
  - admin
  - logout
- Console validation:
  - no unexpected console warnings or errors remained after the alarm vibration fix

## Screenshot Inventory

Live screenshots captured from the deployed VPS:

- `artifacts/ui-after/2026-04-06/live-dashboard.png`
- `artifacts/ui-after/2026-04-06/live-account.png`
- `artifacts/ui-after/2026-04-06/live-admin.png`

Baseline references for comparison:

- `artifacts/ui-baseline/2026-04-06/mock-dashboard.png`
- `artifacts/ui-baseline/2026-04-06/mock-account.png`
- `artifacts/ui-baseline/2026-04-06/public-login.png`
- `artifacts/ui-baseline/2026-04-06/public-register.png`

## Notes

- The repo default branch remains `master`; no `main` branch is present on origin.
- An alarm vibration regression appeared during live dashboard validation and was fixed before redeploy by deferring vibration until the operator has interacted with the page.
