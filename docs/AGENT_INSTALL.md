# Clarix Pulse — Agent Installation Guide

**Version**: 1.0.0
**Date**: 2026-03-26

---

## Overview

One agent package deploys identically on all 4 playout PCs.
Only `config.yaml` differs per machine. No Python, no dependencies to install.

---

## Pre-requisites

- Windows 10 or later (x64)
- Administrator account
- Internet access from the PC (outbound HTTPS to `pulse.clarixtech.com`)
- Hub URL and your PC's agent token (from hub admin)

---

## Deployment Steps

### 1. Copy the package

Copy the `clarix-agent-v1.0/` folder to the playout PC. Suggested location:

```
C:\clarix-agent\
```

Contents:
```
C:\clarix-agent\
├── clarix-agent.exe    ← standalone — no Python install needed
├── ffmpeg.exe          ← bundled (used only if UDP probe enabled)
├── ffprobe.exe         ← bundled (used only if UDP probe enabled)
├── nssm.exe            ← Windows service manager
├── config.yaml         ← YOU EDIT THIS
├── config.example.yaml ← reference template
├── install.bat         ← run as Administrator
└── uninstall.bat
```

### 2. Edit config.yaml

Open `config.yaml` in Notepad and fill in:

```yaml
agent_id: ny-main-pc          # ← change to this PC's agent_id
pc_name: NY-MAIN              # ← display name
site_id: ny-main              # ← site grouping
hub_url: https://pulse.clarixtech.com
agent_token: REPLACE_ME       # ← get from hub admin

instances:
  - id: ny-main-insta-1
    playout_type: insta
    paths:
      shared_log_dir: C:\Program Files\Indytek\Insta log
      instance_root: C:\Program Files\Indytek\Insta Playout\Settings
    udp_probe:
      enabled: false
```

See `config.example.yaml` for all fields and examples for each PC type.

### 3. Run install.bat as Administrator

Right-click `install.bat` → **Run as administrator**.

The script will:
1. Validate `config.yaml` exists
2. Register `clarix-agent.exe` as Windows service `ClarixPulseAgent`
3. Set it to **auto-start on boot**
4. Start it immediately
5. Configure log rotation (10MB max)

### 4. Verify

```bat
sc query ClarixPulseAgent
```

Expected: `STATE: 4 RUNNING`

Check logs:
```bat
type C:\clarix-agent\clarix-agent.log
```

Expected output:
```
2026-03-26 10:00:00 [INFO] Clarix Pulse Agent starting — agent_id=ny-main-pc, hub=https://pulse.clarixtech.com
2026-03-26 10:00:00 [INFO] Monitoring 3 instance(s): ['ny-main-insta-1', 'ny-main-insta-2', 'ny-main-admax-1']
```

---

## Per-PC Configuration Reference

### NY Main PC (`ny-main-pc`)

| Instance | Type | UDP probe |
|---|---|---|
| `ny-main-insta-1` | insta | disabled |
| `ny-main-insta-2` | insta | disabled |
| `ny-main-admax-1` | admax | disabled |

Key paths:
- Insta shared log: `C:\Program Files\Indytek\Insta log`
- Insta instance 1: `C:\Program Files\Indytek\Insta Playout\Settings`
- Insta instance 2: `C:\Program Files\Indytek\Insta Playout 2\Settings`
- Admax root: `C:\Program Files (x86)\Unimedia\Admax One 2.0.2\admax`

### NY Backup PC (`ny-backup-pc`)

| Instance | Type | UDP probe |
|---|---|---|
| `ny-backup-admax-1` | admax | **enabled** |
| `ny-backup-admax-2` | admax | **enabled** |

Set `stream_url` to the encoder's local LAN IP, e.g. `udp://192.168.1.50:5000`

### NJ Optimum PC (`nj-optimum-pc`)

| Instance | Type | UDP probe |
|---|---|---|
| `nj-optimum-admax-1` | admax | disabled (SDI only) |

### FL Digicel PC (`digicel-pc`)

| Instance | Type | UDP probe |
|---|---|---|
| `digicel-admax-1` | admax | **enabled** |

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Service won't start | Check `clarix-agent.log` for errors |
| Heartbeat rejected (401) | Wrong `agent_token` in `config.yaml` |
| Heartbeat rejected (403) | `agent_id` doesn't match hub `AGENT_TOKENS` |
| Instance not found (404) | `instance_id` not in hub `instances.ts` |
| All instances gray on dashboard | Hub not reachable — check `hub_url` and internet |
| UDP probe not working | Verify `stream_url` LAN IP is correct, ffmpeg.exe is present |

---

## To Update the Agent

1. Stop the service: `nssm stop ClarixPulseAgent`
2. Replace `clarix-agent.exe` (keep `config.yaml`)
3. Start the service: `nssm start ClarixPulseAgent`

## To Uninstall

Run `uninstall.bat` as Administrator.
