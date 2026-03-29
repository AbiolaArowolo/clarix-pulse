# Clarix Pulse - Agent Installation Guide

**Document Date**: `2026-03-29 -04:00`  
**Current Bundle Baseline**: `v1.9`

## Purpose

This is the current Windows node install guide for Clarix Pulse.

The supported product path is now:

1. create or sign into a Clarix Pulse account
2. open that tenant's dashboard
3. run discovery on the Windows node
4. provision the node from the dashboard
5. import the provisioned `config.yaml` into the local UI
6. install the Windows service

Prepared site-specific bundles are no longer part of the supported product path.

---

## Supported Artifact

Use:

- [clarix-pulse-v1.9.zip](/D:/monitoring/packages/agent/release/clarix-pulse-v1.9.zip)

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

Every shipped bundle contains:

- `clarix-agent.exe`
- `install.bat`
- `configure.bat`
- `uninstall.bat`
- `discover-node.ps1`
- `install-from-url.ps1`
- `config.yaml`
- `config.example.yaml`
- `nssm.exe`
- `ffmpeg.exe`
- `ffprobe.exe`

---

## What Each File Does

- `clarix-agent.exe`: the Windows monitoring runtime
- `install.bat`: final install/update flow for the node
- `configure.bat`: reopens the local setup UI without reinstalling
- `discover-node.ps1`: PowerShell scanner that inspects the PC and writes a discovery report
- `pulse-node-discovery-report.json`: discovery output used for auto-fill
- `config.yaml`: the final node configuration file
- `install-from-url.ps1`: downloads the Clarix Pulse bundle zip from a direct HTTPS link

Important:

- `discover-node.ps1` is a PowerShell script, not a clickable app like `.exe`
- it usually runs with:

```powershell
powershell -ExecutionPolicy Bypass -File .\discover-node.ps1
```

---

## Current Onboarding Model

Clarix Pulse is now account-based and tenant-isolated:

- the public site opens to a landing page
- each customer registers with email and password
- the registration email becomes the default off-air alert email for that tenant
- new dashboards start empty by default
- nodes only appear after local setup mirrors into that tenant's hub

That means node install should start from the signed-in dashboard, not from a shared global hub.

---

## Recommended Install Flow

### 1. Create or sign into the tenant dashboard

Open:

- [pulse.clarixtech.com](https://pulse.clarixtech.com/)

Register the company or sign in.

Use the dashboard's onboarding page first if this is the first node for that customer.

### 2. Get the bundle onto the Windows node

Copy the zip manually, or pull it from a direct HTTPS link:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-from-url.ps1 -BundleUrl "https://pulse.clarixtech.com/downloads/clarix-pulse/latest/clarix-pulse-v1.9.zip"
```

Suggested working folder:

```text
C:\clarix-pulse\
```

### 3. Start the playout application if possible

Discovery is more accurate when the player is already running.

### 4. Run discovery on the Windows node

Typical command:

```powershell
powershell -ExecutionPolicy Bypass -File .\discover-node.ps1
```

If you want to bias generic detection:

```powershell
powershell -ExecutionPolicy Bypass -File .\discover-node.ps1 -PlayoutHint generic_windows
```

That creates:

```text
.\pulse-node-discovery-report.json
```

The discovery report can include:

- inferred node ID and node name
- inferred site ID
- detected player candidates
- likely log locations
- nearby log folders relative to a running player executable
- existing `hub_url`, `agent_token`, or `enrollment_key` if Clarix Pulse was already installed on that PC
- timezone hints for operator context

### 5. Upload the discovery report in the dashboard

In the signed-in dashboard:

1. open the monitoring dashboard
2. find `Remote Setup`
3. upload the discovery report
4. review auto-filled node identity, player list, and paths
5. click `Provision node and download config`

Provisioning now:

- creates inventory in the current tenant
- mirrors the node config to the hub
- creates a fresh `agent_token`
- downloads a ready `config.yaml`

### 6. Import the provisioned config into the local UI

Open the local UI on the Windows node:

```text
http://127.0.0.1:3210/
```

Then either:

- upload the downloaded `config.yaml`
- or paste a direct hosted `config.yaml` URL and pull it

The local UI can also import the discovery report directly, but the provisioned `config.yaml` is the final source of truth for node identity and token.

### 7. Save local settings

In the local UI:

1. confirm `node_id`, `site_id`, `hub_url`, and players
2. confirm monitoring-enabled toggles per player
3. click `Save Local Settings`

### 8. Install the service

Run:

```bat
install.bat
```

Current installer shape:

1. local setup is gathered or validated first
2. Windows elevation is only requested for the final service-install phase
3. the `ClarixPulseAgent` service is installed
4. the service starts

---

## Enrollment Key Fallback

The preferred flow is:

- discovery report
- dashboard provisioning
- import provisioned `config.yaml`

If you still need local self-enrollment, each signed-in tenant has its own enrollment key on the account/onboarding screens.

The local UI can still enroll if:

- `agent_token` is blank
- `enrollment_key` is present
- the hub accepts that tenant's enrollment key

---

## Fresh Reinstall / Uninstall

To remove an existing Clarix Pulse install from a node:

```bat
echo y| "C:\ProgramData\ClarixPulse\Agent\clarix-agent.exe" --uninstall-service
```

Alternate path:

```bat
C:\ProgramData\ClarixPulse\Agent\uninstall.bat
```

That removes:

- the `ClarixPulseAgent` Windows service
- `C:\ProgramData\ClarixPulse`

Verification:

```bat
sc query ClarixPulseAgent
```

Expected result:

- Windows error `1060`

Also check:

```powershell
Test-Path 'C:\ProgramData\ClarixPulse'
```

Expected result:

- `False`

Manual fallback in an elevated shell:

```bat
sc stop ClarixPulseAgent
sc delete ClarixPulseAgent
taskkill /F /IM clarix-agent.exe
rmdir /s /q C:\ProgramData\ClarixPulse
```

---

## Verification

Check the service:

```bat
sc query ClarixPulseAgent
```

Check the installed log:

```bat
type "%ProgramData%\ClarixPulse\Agent\clarix-agent.log"
```

Expected startup shape:

```text
Pulse Agent starting - node_id=..., node_name=..., hub=...
Monitoring N player(s): [...]
```

In the dashboard, confirm:

1. the node appears only inside the correct customer account
2. the player list matches the local config
3. alert contacts belong to that tenant
4. monitoring toggles work without any shared write key

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Service does not start | `%ProgramData%\ClarixPulse\Agent\clarix-agent.log` |
| Enrollment fails | use the provisioned `config.yaml` path instead of relying on the key |
| `401 Unauthorized` from node traffic | stale or wrong `agent_token` |
| Dashboard still shows no nodes | confirm the node saved config locally and the service has heartbeat connectivity |
| Discovery report looks incomplete | rerun discovery while the playout app is actively running |
| Local UI cannot pull a URL | use a direct file URL or presigned URL, not a login page |

---

## Related Docs

- onboarding: [ONBOARDING.md](/D:/monitoring/docs/ONBOARDING.md)
- deployment: [DEPLOYMENT.md](/D:/monitoring/docs/DEPLOYMENT.md)
- VPS downloads: [VPS_ARTIFACT_LAYOUT.md](/D:/monitoring/docs/VPS_ARTIFACT_LAYOUT.md)
