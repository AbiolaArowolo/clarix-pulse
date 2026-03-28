# Pulse Release Knowledge Base - 2026-03-27

**Prepared**: `2026-03-28 06:25:19 -04:00`  
**Scope**: PostgreSQL refactor, dynamic enrollment, generic installer, playout-profile expansion, release bundle refresh, and documentation closure

## Executive Summary

This pass moved the codebase off SQLite and onto PostgreSQL, replaced static runtime registry usage with DB-backed inventory, promoted the generic Windows installer path, and refreshed the release tooling and docs around that new model.

The accepted play / pause / stop monitoring behavior was deliberately not changed in this pass.

Key outcomes:

- hub runtime now targets PostgreSQL only
- node / player / token inventory is DB-backed
- generic node self-enrollment exists through `POST /api/config/enroll`
- local UI now exposes process selectors and log selectors
- local UI now exposes playout vendor profiles beyond Insta and Admax
- generic vendor profiles now exist for Cinegy Air, PlayBox Neo, Grass Valley iTX, Imagine Versio, BroadStream OASYS, Pebble Marina, Evertz StreamPro / Overture, and Generic Windows Playout
- installer now defers admin until the final service install phase
- thumbnail blobs moved out of the main state DB path
- bundles rebuilt to `v1.8`
- generic bundle added to the release manifest
- Optimum PC was later cleanly reinstalled onto the `v1.8` generic bundle with node identity preserved

Important execution note:

- the codebase, bundles, and docs were fully rebuilt and verified
- this workstation did not have `docker` or `psql`, so a live local Postgres instance was not provisioned during the same turn

---

## Final Release Artifacts

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

### Common Agent Runtime Hash

All `v1.8` bundles contain the same agent executable:

```text
clarix-agent.exe SHA256
D44984D6E7786F5CA071A5D8D6BBF21CDBE378DD70767BAE52A01AAE122B1BD9
```

### Bundle Zip Hashes

| Bundle | Zip Path | SHA256 |
|---|---|---|
| `pulse-generic-v1.8` | [pulse-generic-v1.8.zip](/D:/monitoring/packages/agent/release/pulse-generic-v1.8.zip) | `D70C0BF4ADE54939410C052570DCAFD11EB26E92EC6BD76C0627C1118694FEFD` |
| `nj-optimum-v1.8` | [nj-optimum-v1.8.zip](/D:/monitoring/packages/agent/release/nj-optimum-v1.8.zip) | `FB37B72E8382FC4DB3560509A376026B381A16E96A4A0A766E148B41A48079E1` |
| `ny-main-v1.8` | [ny-main-v1.8.zip](/D:/monitoring/packages/agent/release/ny-main-v1.8.zip) | `A39195DB51C5CC6BC9B9EA836C81CEC1EFFF880B68685D8BE0D069BA7F712363` |
| `ny-backup-v1.8` | [ny-backup-v1.8.zip](/D:/monitoring/packages/agent/release/ny-backup-v1.8.zip) | `ED5E03013970885D8AC9934EC176220ECDB897762ABDB0B82189A7F81F6A10A8` |
| `digicel-v1.8` | [digicel-v1.8.zip](/D:/monitoring/packages/agent/release/digicel-v1.8.zip) | `2F032219F860F9D86C6508316DC3E336B8C1A5ECF9AA5A160110CB19C277828C` |

### Release Manifest

Manifest:

- [configs/node-bundles.json](/D:/monitoring/configs/node-bundles.json)

Current default version:

- `v1.8`

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

- parity passed for the `v1.8` bundle set, including the generic installer bundle

---

## Current Product Truths

### 1. Local node config is authoritative

Machine-specific settings remain node-owned:

- paths
- playout type
- playout vendor profile
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
- playout profile registry: [playout_profiles.py](/D:/monitoring/packages/agent/playout_profiles.py)
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
| `2026-03-28 06:23:27 -04:00` | The generic installer needed a broader playout model because real broadcaster estates span many vendors beyond the two native profiles | playout profile registry and safe generic vendor mode were added, then bundled into `v1.8` |
| `2026-03-28 06:23:27 -04:00` | The Optimum PC needed a clean local reinstall onto the new generic runtime without losing its existing node token and live config | service was removed and reinstalled from the `v1.8` generic bundle with the saved config restored |
| `2026-03-28 05:55:24 -04:00` | `pulse-generic-v1.8`, `nj-optimum-v1.8`, `ny-main-v1.8`, `ny-backup-v1.8`, and `digicel-v1.8` rebuilt |
| `2026-03-28 06:23:27 -04:00` | Optimum PC clean reinstall completed from the `v1.8` generic bundle |
| `2026-03-28 06:23:44 -04:00` | live API confirmed Optimum back online with `udpMonitoringEnabled=true` and `udpInputCount=1` |
