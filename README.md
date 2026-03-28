# Pulse

Multi-site playout monitoring with a Windows node agent, a central hub, and a live dashboard.

## Current Codebase Status

As of `2026-03-27 20:43:51 -04:00`:

- play / pause / stop runtime logic is unchanged from the accepted live behavior
- the hub has been moved in code from SQLite to PostgreSQL
- static runtime registry usage has been replaced with DB-backed `sites`, `nodes`, `players`, and `agent_tokens`
- the hub now supports generic node enrollment through `POST /api/config/enroll`
- the Windows installer now prepares local config first and asks for admin only for the final service install step
- the local node UI at `http://127.0.0.1:3210/` now exposes process selectors and log selectors
- thumbnails are no longer stored inline in the main hub state database; they are written to a thumbnail file cache
- release bundles have been rebuilt to `v1.6`, including a new generic installer bundle

Important operational note:

- this workstation does not currently have `docker` or `psql`, so the codebase and bundles were fully rebuilt and verified, but a live Postgres server was not stood up locally in this turn

For the timestamped engineering and release record, see [RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).

---

## Overview

Pulse now follows this model:

```text
[Windows node / local UI]
  -> [Pulse agent service]
  -> [Hub API + PostgreSQL control plane + thumbnail file cache]
  -> [Dashboard / PWA]
```

### Configuration ownership

Local node UI is the source of truth for:

- log paths
- playout type
- player count
- process selectors
- log selectors
- UDP URLs

Hub is the source of truth for:

- monitoring enabled / disabled
- maintenance mode
- alert routing
- tokens
- node / player inventory
- mirrored read-only node config

### Alerting rule

The current way alerts are generated was intentionally left alone in this architecture pass. The refactor changed persistence, registration, installer flow, and config ownership, but not the accepted play / pause / stop alert semantics.

---

## What Changed In This Release

### Hub

- PostgreSQL now replaces SQLite in [db.ts](/D:/monitoring/packages/hub/src/store/db.ts)
- dynamic registry tables are managed through [registry.ts](/D:/monitoring/packages/hub/src/store/registry.ts)
- node heartbeat auth now resolves against DB-backed `agent_tokens`
- node/player ownership now resolves from DB-backed `players`
- mirrored node config stays read-only in [nodeConfigMirror.ts](/D:/monitoring/packages/hub/src/store/nodeConfigMirror.ts)
- thumbnail blobs moved out of the main state store into [thumbnails.ts](/D:/monitoring/packages/hub/src/store/thumbnails.ts)

### Agent

- installer now minimizes admin time in [agent.py](/D:/monitoring/packages/agent/agent.py)
- generic enrollment can mint an `agent_token` from an `enrollment_key`
- local setup UI now exposes advanced selectors
- fixed local UI access remains `http://127.0.0.1:3210/`

### Release tooling

- bundle manifest now includes `pulse-generic-v1.6`
- bundle rebuild and parity scripts understand bundles without a dedicated node config file

---

## Release Artifacts

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

Current bundles:

- `pulse-generic-v1.6`
- `nj-optimum-v1.6`
- `ny-main-v1.6`
- `ny-backup-v1.6`
- `digicel-v1.6`

Bundle verification:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\rebuild-node-bundles.ps1 -PruneReleaseRoot
powershell -ExecutionPolicy Bypass -File scripts\verify-bundle-parity.ps1
```

---

## Environment Model

The hub now expects PostgreSQL:

```env
PULSE_DATABASE_URL=postgres://pulse_user:password@127.0.0.1:5432/clarix_pulse
PULSE_ENROLLMENT_KEY=REPLACE_ME
PULSE_THUMBNAIL_DIR=/var/lib/clarix-pulse/thumbnails
```

See the full template in [/.env.example](/D:/monitoring/.env.example).

---

## Documentation Index

- Architecture: [ARCHITECTURE.md](/D:/monitoring/docs/ARCHITECTURE.md)
- Deployment: [DEPLOYMENT.md](/D:/monitoring/docs/DEPLOYMENT.md)
- Agent install: [AGENT_INSTALL.md](/D:/monitoring/docs/AGENT_INSTALL.md)
- Monitoring rules: [MONITORING_SPEC.md](/D:/monitoring/docs/MONITORING_SPEC.md)
- Decisions: [DECISIONS.md](/D:/monitoring/docs/DECISIONS.md)
- Product summary: [PRD.md](/D:/monitoring/docs/PRD.md)
- Tech stack: [TECH_STACK.md](/D:/monitoring/docs/TECH_STACK.md)
- Release KB: [RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md)

---

## Current Next Step

The next operational step is not more code in this repo. It is provisioning a real Postgres server for the hub environment, pointing `PULSE_DATABASE_URL` at it, and then doing the hub cutover / data migration on the target server.
