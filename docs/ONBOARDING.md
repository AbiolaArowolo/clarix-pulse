# Clarix Pulse - Quick Onboarding

**Document Date**: `2026-03-29 -04:00`

## Brief Step-By-Step Guide

### For a new customer

1. Open [pulse.clarixtech.com](https://pulse.clarixtech.com/).
2. Register the company with email and password.
3. Sign in to the new tenant dashboard.
4. Note that the registration email is now the default off-air alert recipient.
5. Open the dashboard's `Onboarding` page.

### For a new Windows node

1. Download or copy [clarix-pulse-v1.9.zip](/D:/monitoring/packages/agent/release/clarix-pulse-v1.9.zip) to the PC.
2. Start the playout application if possible.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\discover-node.ps1
```

4. In the dashboard, open `Remote Setup` and upload the discovery report.
5. Review the node and player details.
6. Click `Provision node and download config`.
7. Open the local UI on the node at `http://127.0.0.1:3210/`.
8. Import the downloaded `config.yaml`.
9. Click `Save Local Settings`.
10. Run `install.bat`.

### After install

1. Confirm the service is running:

```bat
sc query ClarixPulseAgent
```

2. Confirm the node appears in the signed-in tenant dashboard.
3. Confirm alert contacts belong to that tenant.

## Notes

- new dashboards start empty by default
- nodes do not appear until the local setup mirrors into the tenant hub
- the provisioned `config.yaml` flow is preferred over enrollment-key setup
- the enrollment key still exists as a fallback on the account/onboarding screens
