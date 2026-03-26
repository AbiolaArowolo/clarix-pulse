# Pulse - Agent Installation Guide

**Version**: 1.1.0
**Date**: 2026-03-26

---

## Overview

Each playout node should receive one prepared node bundle.
The bundle can contain the agent, config templates, install/configure scripts, NSSM, and the UDP
tools so the operator only needs to copy one folder and click `install.bat`.

---

## Pre-requisites

- Windows 10 or later (x64)
- Administrator account for install/uninstall
- Network reachability to the configured `hub_url` (LAN or internet)
- Hub URL and the node's agent token

Internet is only required when the configured hub is remote or when Telegram/email alerts must leave
the local network.

---

## Deployment Steps

### 1. Build the node bundle

On the admin workstation, build the agent exe and then assemble the bundle:

```powershell
pyinstaller --distpath packages/agent/dist --workpath packages/agent/build packages/agent/clarix-agent.spec
powershell -ExecutionPolicy Bypass -File packages/agent/build-node-bundle.ps1
```

If you already have a node-specific config file, you can inject it into the bundle:

```powershell
powershell -ExecutionPolicy Bypass -File packages/agent/build-node-bundle.ps1 `
  -BundleName ny-main-node `
  -ConfigPath C:\path\to\config.yaml
```

The build script expects helper binaries in `packages/agent/vendor/`:

- `nssm.exe` is required
- `ffmpeg.exe` and `ffprobe.exe` should be bundled on every node so UDP can be switched on later

### 2. Copy the bundle to the node

Copy the generated bundle folder to the playout PC. Suggested destination:

```text
C:\clarix-node-bundle\
```

Example contents:

```text
C:\clarix-node-bundle\
|-- clarix-agent.exe
|-- install.bat
|-- configure.bat
|-- uninstall.bat
|-- config.example.yaml
|-- config.yaml
|-- nssm.exe
|-- ffmpeg.exe
|-- ffprobe.exe
`-- BUNDLE-INFO.txt
```

### 3. Run install.bat as Administrator

Right-click `install.bat` and choose **Run as administrator**.

The installer will:

1. Copy the bundle into `%ProgramData%\ClarixPulse\Agent`
2. Preserve `config.yaml` on reinstall, or create it from the example if missing
3. Open the config on first install so the node can be customized
4. Validate UDP tools if any UDP input is enabled
5. Register `clarix-agent.exe` as Windows service `ClarixPulseAgent`
6. Set it to auto-start on boot
7. Start it immediately
8. Configure log rotation

### 4. Configure the node

The config file lives at:

```text
%ProgramData%\ClarixPulse\Agent\config.yaml
```

You can edit it later by running:

```text
%ProgramData%\ClarixPulse\Agent\configure.bat
```

Use `udp_inputs` on each player to turn UDP monitoring on or off without reinstalling the node.
For Admax players, the agent can resolve the installed layout from version-agnostic root candidates,
so a move from `2.0` to `2.0.2` does not require a new config if the install stays under the usual
`Unimedia\Admax*\admax` structure.

For UDP URLs, Pulse accepts:

- `udp://224.2.2.2:5004`
- `udp://@224.2.2.2:5004` for multicast listen syntax
- `udp@://224.2.2.2:5004` as a convenience form that Pulse normalizes automatically

After editing the config, `configure.bat` now runs `clarix-agent.exe --validate-config` before it
offers a service restart, so invalid enabled UDP inputs are caught early.

Example:

```yaml
node_id: ny-main-pc
node_name: NY-MAIN
site_id: ny-main
hub_url: https://pulse.clarixtech.com
agent_token: REPLACE_ME

players:
  - player_id: ny-main-insta-1
    playout_type: insta
    paths:
      shared_log_dir: C:\Program Files\Indytek\Insta log
      instance_root: C:\Program Files\Indytek\Insta Playout\Settings
      fnf_log: C:\Program Files\Indytek\Insta Playout\logs\FNF
      playlistscan_log: C:\Program Files\Indytek\Insta Playout\logs\playlistscan
    udp_inputs: []

  - player_id: ny-main-admax-1
    playout_type: admax
    paths:
      admax_root_candidates:
        - C:\Program Files (x86)\Unimedia\Admax One*\admax
        - C:\Program Files\Unimedia\Admax One*\admax
    udp_inputs:
      - udp_input_id: ny-main-admax-1-udp-1
        enabled: true
        stream_url: udp://192.168.1.50:5000
        thumbnail_interval_s: 10
```

### 5. Verify

```bat
sc query ClarixPulseAgent
type "%ProgramData%\ClarixPulse\Agent\clarix-agent.log"
```

Expected startup log:

```text
2026-03-26 10:00:00 [INFO] Pulse Agent starting - node_id=ny-main-pc, hub=https://pulse.clarixtech.com
2026-03-26 10:00:00 [INFO] Monitoring 3 player(s): ['ny-main-insta-1', 'ny-main-insta-2', 'ny-main-admax-1']
```

---

## Local LAN Mode

`hub_url` does not have to be public.

Supported patterns include:

- `https://pulse.clarixtech.com` for the remote hub
- `http://192.168.1.10:3001` for a LAN-local hub

This means the node can keep monitoring locally without internet, as long as it can still reach the
configured hub on the LAN. Internet is only required for:

- remote monitoring when the hub is off-site
- Telegram alerts
- email alerts

---

## Per-Node Configuration Reference

### NY Main node (`ny-main-pc`)

| Player ID | Type | UDP |
|---|---|---|
| `ny-main-insta-1` | insta | optional |
| `ny-main-insta-2` | insta | optional |
| `ny-main-admax-1` | admax | optional |

Key paths:

- Insta shared log: `C:\Program Files\Indytek\Insta log`
- Insta player 1: `C:\Program Files\Indytek\Insta Playout\Settings`
- Insta player 2: `C:\Program Files\Indytek\Insta Playout 2\Settings`
- Admax install: use `admax_root_candidates` so the agent can resolve the live Admax folder automatically

### NY Backup node (`ny-backup-pc`)

| Player ID | Type | UDP |
|---|---|---|
| `ny-backup-admax-1` | admax | enabled |
| `ny-backup-admax-2` | admax | enabled |

This node may carry 2-5 UDP inputs across one or more players. Set a distinct `udp_input_id` and
`stream_url` for each enabled input.

### NJ Optimum node (`nj-optimum-pc`)

| Player ID | Type | UDP |
|---|---|---|
| `nj-optimum-insta-1` | insta | optional |

### FL Digicel node (`digicel-pc`)

| Player ID | Type | UDP |
|---|---|---|
| `digicel-admax-1` | admax | enabled |

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Service will not start | Check `clarix-agent.log` for errors |
| Heartbeat rejected (401) | Wrong `agent_token` in `config.yaml` |
| Heartbeat rejected (403) | `node_id` does not match hub `AGENT_TOKENS` |
| Player not found (404) | `player_id` not in hub registry |
| All players gray on dashboard | Hub not reachable - check `hub_url` and LAN/internet path |
| UDP probe not working | Verify `stream_url` is correct and `ffmpeg.exe` / `ffprobe.exe` are bundled |
| Config changes not showing up | Run `configure.bat` and restart the service |

---

## Updating And Removing

Update:

1. Build a fresh node bundle
2. Run the new `install.bat` as Administrator
3. The installer keeps the existing `config.yaml` unless the bundle already contains a node-specific one

Uninstall:

1. Run `%ProgramData%\ClarixPulse\Agent\uninstall.bat` as Administrator
2. Confirm whether the installed files should also be deleted
