# Pulse

Multi-site broadcast monitoring for playout operations across regions, sites, and customers.

## Current Release Status

As of `2026-03-27 19:54:48 -04:00`:

- Play / pause / stop monitoring behavior is accepted as working in the current live NJ Optimum rollout.
- All release installers have been rebuilt to `v1.5`.
- The live VPS is using the external state DB path `/var/lib/clarix-pulse/clarix.db`.
- The hub and dashboard are online, but the external SQLite file is still showing `SQLITE_CORRUPT` in live logs.
- The dashboard is operating as a mirror of node-local configuration, not as the primary editor for machine-local paths or UDP inputs.

For the full timestamped release and operations record, see [docs/RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).

---

## Overview

Pulse is a self-hosted monitoring platform for Windows playout nodes. A local Windows agent polls runtime, log, file, connectivity, and optional UDP signals, then posts raw observations to the hub. The hub is the only component that computes health state and alert decisions.

```text
[Playout Nodes] -> [Pulse Agent Service] -> [Hub API + State Engine] -> [Dashboard / PWA]
    Windows            Windows service         Node.js + TS + SQLite         Browser / Mobile
```

Pulse currently supports:

- multiple sites
- multiple nodes per site
- multiple players per node
- optional UDP monitoring per player
- live dashboard updates
- alerting through Telegram and email
- local node UI for machine-specific configuration

---

## Current Operating Model

### Local Node Is The Source Of Truth

Machine-local configuration lives on the node in `config.yaml` and is edited through the local Pulse UI or `configure.bat`.

This includes:

- `node_id`
- `node_name`
- `site_id`
- `hub_url`
- `agent_token`
- player list
- playout type
- local log and runtime paths
- per-player UDP inputs
- advanced selectors already supported by the runtime

### Hub Computes Health And Owns Operational Controls

The hub currently owns:

- health computation
- alerting
- incident/event persistence
- monitoring enabled / disabled
- maintenance mode
- mirrored node config for dashboard visibility

### Dashboard Mirrors Node Config

The dashboard can show node-side stream settings and configuration mirrors, but in the current release it does not own machine-local config editing. Operators should use the local node UI for path and UDP changes.

### Current Constraint

The hub still uses a static commissioned registry in [instances.ts](/D:/monitoring/packages/hub/src/config/instances.ts) and token-to-node mapping through `AGENT_TOKENS`. That means brand-new nodes still need hub-side registration data before they can heartbeat successfully.

---

## Health Model

Pulse keeps three independent health domains:

| Domain | Values |
|---|---|
| `broadcast_health` | `healthy`, `degraded`, `off_air_likely`, `off_air_confirmed`, `unknown` |
| `runtime_health` | `healthy`, `paused`, `restarting`, `stalled`, `stopped`, `content_error`, `unknown` |
| `connectivity_health` | `online`, `stale`, `offline` |

### Current Runtime Escalation Rules

- `paused` becomes yellow immediately and escalates to red after about 60 seconds if it does not recover
- `stopped` while the player app is still present becomes yellow immediately and escalates to red after about 60 seconds
- `player shut down` / missing process goes red immediately
- `stalled` escalates to red after about 45 seconds
- `paused` does not clear from CPU activity alone in the current release; recovery requires stronger evidence such as playback movement, a fresh positive log token, or playlist advance

The detailed current monitoring rules are documented in [docs/MONITORING_SPEC.md](/D:/monitoring/docs/MONITORING_SPEC.md).

---

## Release Artifacts

The current approved bundle baseline is `v1.5`.

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

Current node bundles:

- `nj-optimum-v1.5`
- `ny-main-v1.5`
- `ny-backup-v1.5`
- `digicel-v1.5`

Bundle parity is validated with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\rebuild-node-bundles.ps1 -PruneReleaseRoot
powershell -ExecutionPolicy Bypass -File scripts\verify-bundle-parity.ps1
```

---

## Important Current Risks

- The external VPS SQLite file is still unhealthy and should not be considered a solved long-term persistence story.
- Telegram alert delivery currently has at least one invalid recipient configuration in production.
- The hub still relies on a static commissioned registry, so generic installer flow is ahead of generic onboarding flow.
- Thumbnails are still stored inline in the current hub state store, which adds unnecessary write and payload pressure.

---

## Documentation Index

- Product and release summary: [docs/PRD.md](/D:/monitoring/docs/PRD.md)
- Architecture: [docs/ARCHITECTURE.md](/D:/monitoring/docs/ARCHITECTURE.md)
- Monitoring rules: [docs/MONITORING_SPEC.md](/D:/monitoring/docs/MONITORING_SPEC.md)
- Agent install guide: [docs/AGENT_INSTALL.md](/D:/monitoring/docs/AGENT_INSTALL.md)
- Hub and VPS deployment guide: [docs/DEPLOYMENT.md](/D:/monitoring/docs/DEPLOYMENT.md)
- Technical decisions: [docs/DECISIONS.md](/D:/monitoring/docs/DECISIONS.md)
- Technical stack: [docs/TECH_STACK.md](/D:/monitoring/docs/TECH_STACK.md)
- Release knowledge base for March 27, 2026: [docs/RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md)

---

## Project Structure

```text
clarix-pulse/
|-- packages/
|   |-- hub/
|   |-- dashboard/
|   `-- agent/
|-- configs/
|-- docs/
|-- scripts/
`-- .env.example
```

---

## Short-Term Direction

Do not change the play / pause / stop runtime logic as part of the next rollout unless a new live regression is proven.

The immediate release priorities are:

1. distribute the rebuilt `v1.5` bundles
2. keep the docs and release notes aligned with what is actually live
3. repair or replace the corrupted VPS SQLite file after backup
4. plan the next architecture phase around a DB-backed control plane and PostgreSQL
