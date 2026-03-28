# Pulse - Agent Installation Guide

**Document Date**: `2026-03-28 06:25:19 -04:00`  
**Current Bundle Baseline**: `v1.8`

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

- `pulse-generic-v1.8`
- `nj-optimum-v1.8`
- `ny-main-v1.8`
- `ny-backup-v1.8`
- `digicel-v1.8`

---

## What Changed In `v1.8`

- install now gathers or validates config before the final admin prompt
- local UI still stays fixed at `http://127.0.0.1:3210/`
- local UI now exposes process selectors and log selectors
- node can enroll itself through the hub if you provide an enrollment key
- prepared bundles remain available, but generic rollout is now first-class
- playout type is now profile-driven instead of being limited to just `Insta` and `Admax`
- new profile choices now include `Cinegy Air`, `PlayBox Neo`, `Grass Valley iTX`, `Imagine Versio`, `BroadStream OASYS`, `Pebble Marina`, `Evertz StreamPro / Overture`, and `Generic Windows Playout`
- non-native vendor profiles now save generic log/process settings safely instead of falling back to `Insta` assumptions

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
- playout vendor profile
- process selectors
- log selectors
- UDP inputs

The hub mirrors this config for visibility, but it is not the primary live editor for these fields.

---

## What You Can Rename

If you only want the label in the UI to look different, change `node_name`.

Safe to change:

- `node_name`: display label only
- local paths
- playout vendor profile
- process selectors
- log selectors
- UDP inputs
- `poll_interval_seconds`

Change with intent:

- `site_id`: moves the node under a different site grouping in the dashboard
- `playout_type`: valid when you are intentionally switching the player to a different vendor profile and updating its paths/selectors to match

Keep stable unless you mean to create a new identity:

- `node_id`: this is the node identity used by the hub
- `player_id`: this is the player identity used for state, alerts, and history

Do not casually edit:

- `hub_url`: only change if the node should report to a different hub
- `agent_token`: only change if you are rotating or replacing the node registration
- `enrollment_key`: bootstrap-only field used when `agent_token` is blank

Practical rule:

- rename `node_name` if you want a nicer label
- leave `node_id` and `player_id` alone unless you intentionally want Pulse to treat them as different objects

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

  - player_id: site-a-cinegy-1
    playout_type: cinegy_air
    paths:
      log_path: C:\Cinegy\Logs
    process_selectors:
      process_names:
        - CinegyAirEngine.exe
    log_selectors:
      paused_regex: (?i)pause
      exited_regex: (?i)stop|shutdown|exit
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
| Non-native playout profile shows little runtime detail | add vendor-specific `process_selectors` and `log_selectors`, plus `paths.log_path` if the system writes local text logs |
| Dashboard does not reflect new local settings yet | wait for the next heartbeat / mirror refresh |

---

## Operational Note

Prepared per-node bundles still exist in `v1.8`, but they are now optional convenience artifacts. The architecture target is that any machine can take the generic bundle, be configured locally, enroll itself, and start reporting without a special installer build for that one node.
