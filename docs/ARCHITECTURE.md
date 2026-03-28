# Pulse - Architecture

**Document Date**: `2026-03-27 20:43:51 -04:00`  
**Status**: Codebase architecture after the PostgreSQL and generic-installer refactor

## System Model

Pulse is now organized around two control planes:

1. local node control plane
2. central hub control plane

```text
Windows playout node
  -> Pulse local UI + config.yaml
  -> Pulse agent service
  -> Hub API
  -> PostgreSQL
  -> Dashboard / PWA
```

---

## Ownership Model

### Local node is authoritative for machine-specific settings

The node owns:

- `node_id`
- `node_name`
- `site_id`
- `hub_url`
- local player list
- playout type
- local paths
- process selectors
- log selectors
- UDP inputs

The authoritative local interface is:

- `http://127.0.0.1:3210/`

The node persists that configuration in:

- `%ProgramData%\ClarixPulse\Agent\config.yaml`

### Hub is authoritative for central operational state

The hub owns:

- `sites`
- `nodes`
- `players`
- `agent_tokens`
- `instance_controls`
- `alert_settings`
- `events`
- mirrored node config

The hub is also still the only place that computes:

- `broadcast_health`
- `runtime_health`
- `connectivity_health`

---

## Hub Persistence Model

Hub persistence is now PostgreSQL in [db.ts](/D:/monitoring/packages/hub/src/store/db.ts).

### Main tables

- `sites`
- `nodes`
- `players`
- `agent_tokens`
- `instance_state`
- `events`
- `alert_settings`
- `instance_controls`
- `node_config_mirror`

### Non-DB thumbnail storage

Hot thumbnail blobs were removed from the main state row and moved to a file cache in [thumbnails.ts](/D:/monitoring/packages/hub/src/store/thumbnails.ts).

Current behavior:

- DB stores `thumbnail_at`
- file cache stores the JPEG bytes
- initial dashboard load fetches thumbnails on demand
- live thumbnail socket updates still carry the fresh `dataUrl`

---

## Registration Model

### Legacy bootstrap

[instances.ts](/D:/monitoring/packages/hub/src/config/instances.ts) is no longer the runtime source of truth. It is now only a bootstrap catalog used to seed known sites / nodes / players into Postgres on first start.

### Dynamic enrollment

New nodes can register through:

- `POST /api/config/enroll`

That endpoint:

- validates `PULSE_ENROLLMENT_KEY`
- creates or updates the node
- rotates the active `agent_token`
- creates or updates player rows
- returns the node’s new agent token

### Heartbeat ownership enforcement

`POST /api/heartbeat` now:

- authenticates against DB-backed `agent_tokens`
- checks player ownership from DB-backed `players`
- can sync new player identities from the mirrored local config for that node

---

## Config Mirror Model

The agent still includes `nodeConfigMirror` with heartbeats.

The hub stores that mirror in:

- [nodeConfigMirror.ts](/D:/monitoring/packages/hub/src/store/nodeConfigMirror.ts)

The mirror is intentionally read-only in the dashboard. It exists for visibility and audit, not remote machine editing.

Mirrored data now includes:

- paths
- process selectors
- log selectors
- UDP inputs

---

## Agent Installation Model

The installer now splits setup into two phases:

1. non-admin config preparation
2. admin-only service installation

Flow:

```text
install.bat
  -> local UI / config validation
  -> optional enrollment with hub
  -> single Windows UAC prompt
  -> NSSM service install
  -> service start
```

This keeps the one-click operator path while reducing time spent inside an elevated session.

---

## Dashboard Model

The dashboard now acts as:

- live operations board
- editor for hub-owned controls
- read-only mirror for node-owned config

What it edits:

- monitoring enabled / disabled
- maintenance mode
- alert contacts and channel toggles

What it displays from the node mirror:

- stream inputs
- resolved paths
- process selectors
- log selectors

---

## Alerting Model

This refactor intentionally did **not** change the current alert semantics.

Unchanged by design:

- pause / stop / shutdown escalation rules
- recovery handling
- email / Telegram alert channel behavior

Changed safely:

- Telegram target picker now saves discovered `chatId` values by default, which reduces the old username-resolution failure path without changing alert timing or trigger rules

---

## Current Constraints

As of this refactor:

- the codebase is Postgres-first, but this workstation did not have `docker` or `psql`, so a local live DB was not provisioned here
- the VPS was not cut over in this turn
- no SQLite runtime fallback remains in the hub codepath
- prepared node bundles still exist as convenience bundles, but the generic installer is now the default architecture path

---

## Key Files

- Hub DB bootstrapping: [db.ts](/D:/monitoring/packages/hub/src/store/db.ts)
- Registry model: [registry.ts](/D:/monitoring/packages/hub/src/store/registry.ts)
- Heartbeat route: [heartbeat.ts](/D:/monitoring/packages/hub/src/routes/heartbeat.ts)
- Config / enrollment route: [config.ts](/D:/monitoring/packages/hub/src/routes/config.ts)
- Thumbnail file cache: [thumbnails.ts](/D:/monitoring/packages/hub/src/store/thumbnails.ts)
- Agent runtime + installer: [agent.py](/D:/monitoring/packages/agent/agent.py)

For the timestamped release record and challenges encountered during this pass, see [RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
