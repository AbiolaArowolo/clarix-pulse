# Pulse Release Knowledge Base - 2026-03-27

**Prepared**: `2026-03-27 20:43:51 -04:00`  
**Scope**: PostgreSQL refactor, dynamic enrollment, generic installer, release bundle refresh, and documentation closure

## Executive Summary

This pass moved the codebase off SQLite and onto PostgreSQL, replaced static runtime registry usage with DB-backed inventory, promoted the generic Windows installer path, and refreshed the release tooling and docs around that new model.

The accepted play / pause / stop monitoring behavior was deliberately not changed in this pass.

Key outcomes:

- hub runtime now targets PostgreSQL only
- node / player / token inventory is DB-backed
- generic node self-enrollment exists through `POST /api/config/enroll`
- local UI now exposes process selectors and log selectors
- installer now defers admin until the final service install phase
- thumbnail blobs moved out of the main state DB path
- bundles rebuilt to `v1.6`
- generic bundle added to the release manifest

Important execution note:

- the codebase, bundles, and docs were fully rebuilt and verified
- this workstation did not have `docker` or `psql`, so a live local Postgres instance was not provisioned during the same turn

---

## Final Release Artifacts

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

### Common Agent Runtime Hash

All `v1.6` bundles contain the same agent executable:

```text
clarix-agent.exe SHA256
485E23B24EC290C4156234A80C33F176AA4D9B5F3E0EAD1D7D64803E44B520FB
```

### Bundle Zip Hashes

| Bundle | Zip Path | SHA256 |
|---|---|---|
| `pulse-generic-v1.6` | [pulse-generic-v1.6.zip](/D:/monitoring/packages/agent/release/pulse-generic-v1.6.zip) | `F36671DD1DB131E511EAA5C1950E3B2FDA0A1A69A88F87B695FFABF16F8B5AB7` |
| `nj-optimum-v1.6` | [nj-optimum-v1.6.zip](/D:/monitoring/packages/agent/release/nj-optimum-v1.6.zip) | `4B0F5426F65FC17298BB05551F92498DE55D9EFA80F270F51F72B25C3C64A7F8` |
| `ny-main-v1.6` | [ny-main-v1.6.zip](/D:/monitoring/packages/agent/release/ny-main-v1.6.zip) | `1D6250217611F7794EA510F6AF59B459373077DF8F1AAA77165E797FC63CC7A0` |
| `ny-backup-v1.6` | [ny-backup-v1.6.zip](/D:/monitoring/packages/agent/release/ny-backup-v1.6.zip) | `8323DD21BBB18BD907956895E90EB376B0A557FF7E7654BFCEA241500AF21172` |
| `digicel-v1.6` | [digicel-v1.6.zip](/D:/monitoring/packages/agent/release/digicel-v1.6.zip) | `D5C5A417EF9EA472B71BB9F07D0112D7CB671BE1F3F50F663D61B26F845F9D7B` |

### Release Manifest

Manifest:

- [configs/node-bundles.json](/D:/monitoring/configs/node-bundles.json)

Current default version:

- `v1.6`

---

## Verified Build And Validation Results

### Code validation

Verified in this pass:

- `python -m py_compile packages/agent/agent.py`
- `npm install`
- `npm run build --workspace=packages/hub`
- `npm run build --workspace=packages/dashboard`
- `npm run build`

### Bundle validation

Verified in this pass:

- `powershell -ExecutionPolicy Bypass -File scripts\rebuild-node-bundles.ps1 -PruneReleaseRoot`
- `powershell -ExecutionPolicy Bypass -File scripts\verify-bundle-parity.ps1`

Result:

- parity passed for the `v1.6` bundle set, including the new generic installer bundle

---

## Current Product Truths

### 1. Local node config is authoritative

Machine-specific settings remain node-owned:

- paths
- playout type
- player count
- process selectors
- log selectors
- UDP inputs

Current editing surface:

- local UI at `http://127.0.0.1:3210/`

### 2. Hub owns central operational state

The hub now owns these centrally in PostgreSQL:

- `sites`
- `nodes`
- `players`
- `agent_tokens`
- `instance_state`
- `events`
- `instance_controls`
- `alert_settings`
- `node_config_mirror`

### 3. Dashboard is a mirror for node config

The dashboard now mirrors:

- paths
- selectors
- stream inputs

But it does not directly edit those machine-local values.

### 4. Alert semantics were intentionally not changed

The refactor did not alter:

- pause logic
- stop logic
- shutdown logic
- alert timing
- alert channel trigger conditions

---

## Challenges Encountered

| Timestamp | Challenge | Outcome |
|---|---|---|
| `2026-03-27 20:41:59 -04:00` | The new generic bundle needed release-tool support because it does not have a node-specific `configPath` like the old prepared bundles | bundle rebuild tooling was updated to support generic bundles |
| `2026-03-27 20:43:51 -04:00` | The parity checker still assumed every bundle mapped to a mirrored tokenized config file | parity tooling was updated and then passed against the final `v1.6` set |
| `2026-03-27 20:43:51 -04:00` | Postgres code was ready, but this workstation had neither `docker` nor `psql` installed | builds and packaging were completed, but live DB provisioning remains a deployment task |
| `2026-03-27 20:43:51 -04:00` | Earlier docs still described SQLite, static registry ownership, and `v1.5` bundles as current state | top-level docs, KB, and handover were rewritten to match the refactored codebase |

---

## Detailed Timeline

| Timestamp | Event |
|---|---|
| `2026-03-27 20:41:59 -04:00` | `LATEST-BUNDLES.txt` regenerated for the `v1.6` release set |
| `2026-03-27 20:41:59 -04:00` | `pulse-generic-v1.6`, `nj-optimum-v1.6`, `ny-main-v1.6`, `ny-backup-v1.6`, and `digicel-v1.6` rebuilt |
| `2026-03-27 20:43:51 -04:00` | verified release facts, hashes, and current workstation capability snapshot captured |
| `2026-03-27 20:43:51 -04:00` | documentation refresh and handover rewrite completed around the verified `v1.6` baseline |

---

## Code Areas Changed

### Hub

- PostgreSQL bootstrapping: [db.ts](/D:/monitoring/packages/hub/src/store/db.ts)
- dynamic inventory: [registry.ts](/D:/monitoring/packages/hub/src/store/registry.ts)
- mirrored config: [nodeConfigMirror.ts](/D:/monitoring/packages/hub/src/store/nodeConfigMirror.ts)
- state persistence: [state.ts](/D:/monitoring/packages/hub/src/store/state.ts)
- enrollment and config routes: [config.ts](/D:/monitoring/packages/hub/src/routes/config.ts)
- heartbeat ownership validation: [heartbeat.ts](/D:/monitoring/packages/hub/src/routes/heartbeat.ts)
- thumbnail file cache route: [thumbnail.ts](/D:/monitoring/packages/hub/src/routes/thumbnail.ts)

### Agent

- installer flow and local UI: [agent.py](/D:/monitoring/packages/agent/agent.py)
- generic config template: [config.example.yaml](/D:/monitoring/packages/agent/config.example.yaml)
- bundle manifest text: [build-node-bundle.ps1](/D:/monitoring/packages/agent/build-node-bundle.ps1)

### Release tooling

- bundle manifest: [node-bundles.json](/D:/monitoring/configs/node-bundles.json)
- rebuild script: [rebuild-node-bundles.ps1](/D:/monitoring/scripts/rebuild-node-bundles.ps1)
- parity checker: [verify-bundle-parity.ps1](/D:/monitoring/scripts/verify-bundle-parity.ps1)

---

## Outstanding Work After This Pass

### 1. Provision a live PostgreSQL server

Status:

- not completed in this workstation session

Why it still matters:

- the hub code now expects Postgres
- deployment still needs the real runtime service and connection string

### 2. Plan SQLite-era state migration or recreation

Status:

- not executed in this pass

Why it still matters:

- anything still valuable in old SQLite state must be migrated or rebuilt during environment cutover

### 3. Roll the new hub build to the real target environment

Status:

- not executed in this turn

Why it still matters:

- the repo now reflects the new architecture, but production still requires the deployment step

---

## Reference Files

- README: [README.md](/D:/monitoring/README.md)
- Architecture: [ARCHITECTURE.md](/D:/monitoring/docs/ARCHITECTURE.md)
- Deployment: [DEPLOYMENT.md](/D:/monitoring/docs/DEPLOYMENT.md)
- Agent install: [AGENT_INSTALL.md](/D:/monitoring/docs/AGENT_INSTALL.md)
- Handover: [HANDOVER.txt](/C:/Users/owner/Desktop/HANDOVER.txt)
