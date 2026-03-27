# Pulse - Agent Installation Guide

**Version**: 1.1.0  
**Date**: 2026-03-27

---

## Overview

Each Windows playout node should receive one prepared node bundle. The bundle can contain:

- `clarix-agent.exe`
- `install.bat`
- `configure.bat`
- `uninstall.bat`
- `config.yaml`
- `config.example.yaml`
- `nssm.exe`
- `ffmpeg.exe`
- `ffprobe.exe`

The intended operator experience is one-click installation with no separate Python, NSSM, ffmpeg, or ffprobe install.
The operator action is to run `install.bat` as Administrator. `clarix-agent.exe` is bundled because the installer uses it to register and run the Windows service.

---

## Pre-Requisites

- Windows 10 or later (x64)
- Administrator access for install and uninstall
- Network reachability to the configured `hub_url`
- A valid `node_id`, `agent_token`, and player config for the target node

Internet is only required when the hub is remote or when alerting must leave the local network.

---

## Deployment Steps

### 1. Build the agent bundle

On the admin workstation:

```powershell
pyinstaller --distpath packages/agent/dist --workpath packages/agent/build packages/agent/clarix-agent.spec
powershell -ExecutionPolicy Bypass -File packages/agent/build-node-bundle.ps1
```

To inject a specific config:

```powershell
powershell -ExecutionPolicy Bypass -File packages/agent/build-node-bundle.ps1 `
  -BundleName site-a-node-1 `
  -ConfigPath C:\path\to\config.yaml
```

For consistent multi-node rollouts, rebuild all bundles from the same workspace baseline:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\rebuild-node-bundles.ps1 -PruneReleaseRoot
powershell -ExecutionPolicy Bypass -File scripts\verify-bundle-parity.ps1
```

Or:

```powershell
npm run agent:refresh-bundles
```

---

## 2. Copy the bundle to the node

Copy the bundle folder or zip to the target Windows host.

Suggested temporary destination:

```text
C:\pulse-node-bundle\
```

---

## 3. Run install.bat as Administrator

Right-click `install.bat` and choose **Run as administrator**.

Do not separately launch `clarix-agent.exe` during a normal node install.

The installer will:

1. copy files into `%ProgramData%\ClarixPulse\Agent`
2. preserve or seed `config.yaml`
3. stage service and UDP helper binaries
4. validate the config
5. install `ClarixPulseAgent`
6. set the service to auto-start
7. start it immediately

---

## 4. Configure the node

The installed config lives at:

```text
%ProgramData%\ClarixPulse\Agent\config.yaml
```

You can update it later with:

```text
%ProgramData%\ClarixPulse\Agent\configure.bat
```

### Generic Example Config

```yaml
node_id: site-a-node-1
node_name: SITE-A-NODE-1
site_id: site-a
hub_url: https://monitor.example.com
agent_token: REPLACE_ME
poll_interval_seconds: 5

players:
  - player_id: site-a-insta-1
    playout_type: insta
    paths:
      shared_log_dir: C:\Program Files\Indytek\Insta log
      instance_root: C:\Program Files\Indytek\Insta Playout\Settings
    udp_inputs:
      - udp_input_id: site-a-insta-1-udp-1
        enabled: false
        stream_url: ""
        thumbnail_interval_s: 10

  - player_id: site-a-admax-1
    playout_type: admax
    paths:
      admax_root_candidates:
        - C:\Program Files (x86)\Unimedia\Admax One*\admax
        - C:\Program Files\Unimedia\Admax One*\admax
    udp_inputs:
      - udp_input_id: site-a-admax-1-udp-1
        enabled: true
        stream_url: udp://239.1.1.1:5000
        thumbnail_interval_s: 10
```

### UDP Notes

- UDP is configured per player
- each player can define up to 5 UDP inputs
- `configure.bat` validates enabled UDP inputs before restart
- the dashboard can also edit UDP inputs when `CONFIG_WRITE_KEY` is configured on the hub

Accepted UDP forms include:

- `udp://239.1.1.1:5000`
- `udp://@239.1.1.1:5000`
- `udp@://239.1.1.1:5000`

---

## 5. Verify

```bat
sc query ClarixPulseAgent
type "%ProgramData%\ClarixPulse\Agent\clarix-agent.log"
```

Typical startup output:

```text
2026-03-27 12:00:00 [INFO] Pulse Agent starting - node_id=site-a-node-1, hub=https://monitor.example.com
2026-03-27 12:00:00 [INFO] Monitoring 2 player(s): ['site-a-insta-1', 'site-a-admax-1']
```

---

## 6. Common Deployment Patterns

### Single-player node

- one Windows host
- one `player_id`
- optional UDP

### Multi-player node

- one Windows host
- two or more `player_id` entries
- mixed software types allowed

### Mixed-site rollout

- rebuild all bundles from one source tree
- keep installer/runtime assets identical
- vary only `config.yaml` and bundle naming

---

## 7. Local LAN Mode

`hub_url` does not need to be public.

Examples:

- `https://monitor.example.com`
- `http://192.168.1.10:3001`

This allows fully local monitoring when the hub is on the same network.

---

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Service will not start | Review `clarix-agent.log` |
| Heartbeat rejected (401) | Wrong `agent_token` |
| Heartbeat rejected (403) | Wrong `node_id` / token mapping |
| Player not found (404) | `player_id` not in hub registry |
| Dashboard stays gray | Hub unreachable or node not commissioned |
| UDP probe not working | Verify stream URL and presence of `ffmpeg.exe` / `ffprobe.exe` |
| Config changes not showing | Re-run `configure.bat` or wait for heartbeat-based sync |

---

## 9. Updating and Removing

### Update

1. build a fresh node bundle
2. run the new `install.bat` as Administrator
3. keep the existing `config.yaml` unless intentionally replacing it

### Uninstall

1. run `%ProgramData%\ClarixPulse\Agent\uninstall.bat` as Administrator
2. confirm whether installed files should also be removed
