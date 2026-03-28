# Pulse - Architecture Document

**Document Date**: 2026-03-27  
**Status**: Current release architecture

## System Model

Pulse is a three-part monitoring system:

```text
Windows playout node
  -> Pulse agent service
  -> Hub API + state engine
  -> Dashboard / PWA
```

### Identity Model

- `node_id` identifies the physical host
- `player_id` identifies the monitored playout source on that host
- one node can host multiple players
- one player can define zero to five UDP inputs

---

## Components

### Local Agent

Responsibilities:

- run as a Windows service
- inspect local process, window, log, file, connectivity, and optional UDP signals
- host the persistent local configuration UI
- post raw observations to the hub
- mirror current node config upward to the hub

Important current rule:

- the node is the source of truth for machine-local config

That includes:

- local paths
- playout type
- player count
- per-player UDP inputs
- selectors and runtime-specific overrides

### Hub

Responsibilities:

- validate agent bearer tokens
- validate node / player ownership against the commissioned registry
- compute health state
- persist current state and event history
- persist alert settings and instance controls
- persist mirrored node config
- emit live dashboard updates

Current implementation note:

- the commissioned registry is still static and lives in [packages/hub/src/config/instances.ts](/D:/monitoring/packages/hub/src/config/instances.ts)

### Dashboard

Responsibilities:

- render the live operational view
- display alarms, health, thumbnails, and monitoring controls
- display mirrored node-side stream settings
- edit hub-owned operational controls such as maintenance mode and alert settings

Current implementation note:

- the dashboard is not the primary editor for machine-local paths or UDP inputs in the current release

---

## Persistence Model

Current hub persistence is SQLite through [packages/hub/src/store/db.ts](/D:/monitoring/packages/hub/src/store/db.ts).

Persisted data includes:

- instance state
- incident / event history
- alert settings
- instance controls
- mirrored node config
- thumbnails

Current production note:

- the live DB path is externalized through `PULSE_DB_PATH`
- the live VPS still shows SQLite corruption in logs as of March 27, 2026

---

## Current Data Flows

### Heartbeat Flow

```text
Agent polls one player
  -> POST /api/heartbeat
  -> Hub validates token and player ownership
  -> Hub computes health
  -> Hub updates persisted state
  -> Hub emits Socket.IO state update
  -> Dashboard updates the card
```

### Thumbnail Flow

```text
Agent captures thumbnail from selected UDP input
  -> POST /api/thumbnail
  -> Hub stores thumbnail
  -> Hub emits thumbnail update
  -> Dashboard refreshes preview
```

### Config Mirror Flow

```text
Local node config changes
  -> Agent includes nodeConfigMirror in heartbeat payload
  -> Hub stores mirrored config
  -> Dashboard reads mirrored stream settings
```

### Operational Control Flow

```text
Operator changes monitoringEnabled / maintenanceMode / alert settings
  -> Dashboard calls hub API
  -> Hub persists operational control
  -> Dashboard and alert engine use the updated control state
```

---

## Current Non-Goals In Production

The current release does not yet provide:

- dynamic self-registration for brand-new nodes
- DB-backed dynamic node/player inventory
- dashboard-owned editing of machine-local path or UDP config
- fully active desired-config pushdown from the hub back to nodes

The codebase contains some preparatory pieces for future desired-config flows, but they are not the active production control plane today.

---

## Current Architecture Truths

1. The agent owns machine-local monitoring config.
2. The hub owns health computation and operational controls.
3. The dashboard mirrors node config and edits hub-owned controls.
4. The commissioned registry is still static.
5. SQLite is the current store, but it is now an operational risk rather than a finished long-term answer.

For the dated release and incident record, see [docs/RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
