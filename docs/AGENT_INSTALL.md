# Pulse - Agent Installation Guide

**Document Date**: 2026-03-27  
**Current Bundle Baseline**: `v1.5`

## Purpose

This guide covers how to install and update the Windows Pulse agent on playout nodes.

Pulse is packaged as a one-click Windows bundle containing:

- `clarix-agent.exe`
- `install.bat`
- `configure.bat`
- `uninstall.bat`
- `config.yaml`
- `config.example.yaml`
- `nssm.exe`
- `ffmpeg.exe`
- `ffprobe.exe`

The normal operator action is to run `install.bat` as Administrator. Operators should not manually launch `clarix-agent.exe` for normal installation.

---

## Current Release Notes

As of March 27, 2026:

- all node bundles have been rebuilt to `v1.5`
- the bundle runtime baseline is aligned across all release packages
- the local Pulse UI is the authoritative place to edit machine-local config
- the hub still expects the node and player identities to already exist in its commissioned registry

That last point matters: the installer is generic enough to configure many node layouts, but a new `node_id` / `player_id` combination still needs hub-side registration before heartbeats will be accepted.

---

## Supported Install Paths

### Production Rollout

Use the prepared node bundle for the target node under [packages/agent/release](/D:/monitoring/packages/agent/release).

### Generic / Lab Rollout

The runtime itself also supports a generic installer flow built from [packages/agent/config.example.yaml](/D:/monitoring/packages/agent/config.example.yaml), but production still uses prepared bundles because the hub registry is currently static.

---

## Install Steps

### 1. Copy The Bundle To The Node

Copy either the folder or the `.zip` to the target Windows host.

Suggested temporary destination:

```text
C:\pulse-node-bundle\
```

### 2. Run `install.bat` As Administrator

Right-click `install.bat` and choose **Run as administrator**.

The installer will:

1. self-elevate if needed
2. stage files into `%ProgramData%\ClarixPulse\Agent`
3. preserve a valid existing `config.yaml` when appropriate
4. validate the config
5. install or update the `ClarixPulseAgent` Windows service
6. set it to automatic startup
7. start it immediately

### 3. Confirm The Local UI

The installed runtime exposes a persistent local UI at:

```text
http://127.0.0.1:3210/
```

Use that UI, or `configure.bat`, for future machine-local updates.

---

## Configuration Model

Installed config path:

```text
%ProgramData%\ClarixPulse\Agent\config.yaml
```

Current supported high-value fields:

- `node_id`
- `node_name`
- `site_id`
- `hub_url`
- `agent_token`
- `poll_interval_seconds`
- `players`
- `playout_type`
- `paths`
- `udp_inputs`
- advanced `process_selectors`
- advanced `log_selectors`

### Example

```yaml
node_id: site-a-node-1
node_name: SITE A NODE 1
site_id: site-a
hub_url: https://pulse.example.com
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
    udp_inputs: []
```

### Important Current Rule

The dashboard mirrors node-side config, but in the current release it does not own path or UDP editing. Use the local node UI for those changes.

---

## Update Flow

To update a node:

1. copy the fresh bundle to the node
2. run the new `install.bat` as Administrator
3. keep the existing `%ProgramData%\ClarixPulse\Agent\config.yaml` unless intentionally replacing it

This is the supported update path for the `v1.5` rollout.

---

## Verification

Check the service:

```bat
sc query ClarixPulseAgent
```

Check the agent log:

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
| `401 Unauthorized` | wrong `agent_token` |
| `403 Player not allowed for this node` | `node_id` / `player_id` is not commissioned on the hub |
| Local UI not opening from `configure.bat` | open `http://127.0.0.1:3210/` directly |
| UDP probe not working | verify stream URL and bundled `ffmpeg.exe` / `ffprobe.exe` |
| Config changed locally but web UI did not reflect it yet | wait for fresh heartbeats and config mirror refresh |

---

## Current Release Bundles

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

Current prepared bundles:

- `nj-optimum-v1.5`
- `ny-main-v1.5`
- `ny-backup-v1.5`
- `digicel-v1.5`

For exact hashes and timestamped release notes, see [docs/RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
