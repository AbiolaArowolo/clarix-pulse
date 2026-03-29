# Clarix Pulse - Quick Start

**Document Date**: `2026-03-29 -04:00`

## Purpose

This is the shortest safe path for getting one new node online.

## Add One Node In 12 Steps

1. Sign into the Clarix Pulse workspace.
2. Open `Onboarding`.
3. Click `Download installer` or `Create secure link`.
4. Move the bundle to the Windows node and unzip it.
5. Run `discover-node.ps1` on the Windows node.
6. Return to the dashboard and open `Remote Setup`.
7. Click `Upload discovery report`.
8. Review the node and player details.
9. Click `Provision node and download config`.
10. On the Windows node, run `configure.bat`.
11. Import the downloaded `config.yaml`, or paste the secure config link and click `Pull from link`.
12. Click `Save Local Settings`, then run `install.bat`.

## Fast Verification

- Confirm the node appears under the correct site in the dashboard.
- Confirm the last heartbeat is updating.
- Confirm the player status badges look correct.

## The Three Most Important Buttons

- `Provision node and download config`: creates the final tenant-scoped node config.
- `Pull from link`: loads the secure config URL directly into the node local UI.
- `Save Local Settings`: writes the real local config used by the Windows service.

## If Another Person Will Finish The Install

After provisioning:

1. In `Last Provision`, click `Create install handoff page`.
2. Copy the handoff link.
3. Send it to the field operator.

That page gives them:

- the installer download
- the node config download
- the secure config link

## Common Mistakes

- Forgetting to run `Save Local Settings`.
- Using the enrollment key when a provisioned config is already available.
- Leaving a player in `Maintenance on` after testing.

## Related Docs

- full manual: [USER_MANUAL.md](/D:/monitoring/docs/USER_MANUAL.md)
- hub manual: [HUB_MANUAL.md](/D:/monitoring/docs/HUB_MANUAL.md)
- node manual: [NODE_MANUAL.md](/D:/monitoring/docs/NODE_MANUAL.md)
