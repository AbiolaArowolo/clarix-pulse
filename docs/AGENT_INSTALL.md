# Pulse - Agent Installation Guide

**Document Date**: `2026-03-27 20:43:51 -04:00`  
**Current Bundle Baseline**: `v1.6`

## Purpose

This guide covers Windows node installation after the generic-installer refactor.

Pulse bundles now support two onboarding paths:

1. generic installer with hub enrollment
2. prepared convenience bundle with prefilled config

The generic installer is now the default product path.

---

## Bundle Contents

Every release bundle contains:

- `clarix-agent.exe`
- `install.bat`
- `configure.bat`
- `uninstall.bat`
- `config.yaml`
- `config.example.yaml`
- `nssm.exe`
- `ffmpeg.exe`
- `ffprobe.exe`

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

Current bundles:

- `pulse-generic-v1.6`
- `nj-optimum-v1.6`
- `ny-main-v1.6`
- `ny-backup-v1.6`
- `digicel-v1.6`

---

## What Changed In `v1.6`

- install now gathers or validates config before the final admin prompt
- local UI still stays fixed at `http://127.0.0.1:3210/`
- local UI now exposes process selectors and log selectors
- node can enroll itself through the hub if you provide an enrollment key
- prepared bundles remain available, but generic rollout is now first-class

Unchanged by design:

- play / pause / stop runtime behavior
- current alert trigger behavior

---

## Supported Inputs

### Option A - Agent token already known

Fill:

- `hub_url`
- `agent_token`

### Option B - Generic enrollment

Fill:

- `hub_url`
- `enrollment_key`

If `agent_token` is blank and `enrollment_key` is present, the local UI enrolls the node and saves the returned token into `config.yaml`.

---

## Install Flow

### 1. Copy the bundle to the node

Folder or zip is fine.

Suggested temp location:

```text
C:\pulse-node-bundle\
```

### 2. Double-click `install.bat`

You no longer need to start by manually elevating the whole setup.

Current behavior:

1. Pulse opens or prepares local setup
2. node-specific config is collected or validated
3. optional hub enrollment happens if needed
4. Windows asks for one Administrator approval for the final service install
5. Pulse installs or updates the `ClarixPulseAgent` service
6. Pulse starts the service
7. `install.bat` opens the persistent local UI after success

### 3. Use the persistent local UI for future edits

Persistent local UI:

```text
http://127.0.0.1:3210/
```

Use that UI, or `configure.bat`, for future local changes.

---

## Current Config Ownership

Machine-local config belongs on the node. That includes:

- paths
- player list
- playout type
- process selectors
- log selectors
- UDP inputs

The hub mirrors this config for visibility, but it is not the primary live editor for these fields.

---

## High-Value Config Fields

```yaml
node_id: site-a-node-1
node_name: Site A Node 1
site_id: site-a
hub_url: https://pulse.example.com
agent_token: ""
# enrollment_key: REPLACE_WITH_HUB_ENROLLMENT_KEY
poll_interval_seconds: 5

players:
  - player_id: site-a-insta-1
    playout_type: insta
    paths:
      shared_log_dir: C:\Program Files\Indytek\Insta log
      instance_root: C:\Program Files\Indytek\Insta Playout\Settings
    process_selectors:
      window_title_contains:
        - Insta 1
    log_selectors:
      include_contains:
        - Insta 1
      paused_regex: (?i)paused
    udp_inputs: []
```

Installed runtime config path:

```text
%ProgramData%\ClarixPulse\Agent\config.yaml
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

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Service does not start | `%ProgramData%\ClarixPulse\Agent\clarix-agent.log` |
| Enrollment fails | verify `hub_url` and `enrollment_key` |
| `401 Unauthorized` | wrong or stale `agent_token` |
| `403 Player not allowed for this node` | node and player inventory is wrong on the hub |
| Local UI does not open from `configure.bat` | open `http://127.0.0.1:3210/` directly |
| UDP probe not working | verify stream URL and bundled `ffmpeg.exe` / `ffprobe.exe` |
| Dashboard does not reflect new local settings yet | wait for the next heartbeat / mirror refresh |

---

## Operational Note

Prepared per-node bundles still exist in `v1.6`, but they are now optional convenience artifacts. The architecture target is that any machine can take the generic bundle, be configured locally, enroll itself, and start reporting without a special installer build for that one node.
