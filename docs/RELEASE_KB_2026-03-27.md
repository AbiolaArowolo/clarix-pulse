# Pulse Release Knowledge Base - 2026-03-27

**Prepared**: `2026-03-28 07:22:24 -04:00`  
**Scope**: PostgreSQL refactor, dynamic enrollment, generic installer, playout-profile expansion, sensitive-setting safety lock, local `v1.9` reinstall, release bundle refresh, and documentation closure

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
- bundles rebuilt to `v1.9`
- generic bundle added to the release manifest
- registered local UI now locks sensitive identity and registration fields by default
- Optimum PC was later cleanly reinstalled onto the `v1.9` generic bundle with node identity preserved

Important execution notes:

- the codebase, bundles, and docs were fully rebuilt and verified
- the production VPS has already been cut over to PostgreSQL for the hub
- this workstation still does not have `docker` or `psql`, so a live local Postgres instance was not provisioned here

---

## Final Release Artifacts

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

### Common Agent Runtime Hash

All `v1.9` bundles contain the same agent executable:

```text
clarix-agent.exe SHA256
BE5AD1622D4A6B4F0F60634B1D09F3B44ADD7EE10948B44B81DF26CD5CA66E0F
```

### Bundle Zip Hashes

| Bundle | Zip Path | SHA256 |
|---|---|---|
| `pulse-generic-v1.9` | [pulse-generic-v1.9.zip](/D:/monitoring/packages/agent/release/pulse-generic-v1.9.zip) | `5E38F939CD281261993A6548BD961559F65D9EE6C9E329A38409562C12435340` |
| `nj-optimum-v1.9` | [nj-optimum-v1.9.zip](/D:/monitoring/packages/agent/release/nj-optimum-v1.9.zip) | `8EB0EEEF9B6129B2699B5C3049EE98FDD15524DE3BACCA98E6376CD7BA520A94` |
| `ny-main-v1.9` | [ny-main-v1.9.zip](/D:/monitoring/packages/agent/release/ny-main-v1.9.zip) | `7A711A3D2C5D7645DA60B2270E7817529E4DA1097991891F24F29C0283161462` |
| `ny-backup-v1.9` | [ny-backup-v1.9.zip](/D:/monitoring/packages/agent/release/ny-backup-v1.9.zip) | `C5085468870F99DBB4B6AB6132CF1151721BFB47FB1B6D3A2A729F49A120612F` |
| `digicel-v1.9` | [digicel-v1.9.zip](/D:/monitoring/packages/agent/release/digicel-v1.9.zip) | `6DCF160F8FC664ABFEB855D5E9A99F296F0A16A3B37B8F082E261E39BC4F5378` |

### Release Manifest

Manifest:

- [configs/node-bundles.json](/D:/monitoring/configs/node-bundles.json)

Current default version:

- `v1.9`

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

- parity passed for the `v1.9` bundle set, including the generic installer bundle

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

Sensitive identity protection now exists on top of that local ownership model:

- `node_name` remains safe to rename as a display label
- `node_id`, `player_id`, `hub_url`, `agent_token`, and `enrollment_key` are locked by default after registration
- the backend save path also preserves those values unless the operator explicitly unlocks sensitive settings

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
| `2026-03-27 20:43:51 -04:00` | The parity checker still assumed every bundle mapped to a mirrored tokenized config file | parity tooling was updated and then passed against the final generic-capable bundle set |
| `2026-03-28 06:23:27 -04:00` | The generic installer needed a broader playout model because real broadcaster estates span many vendors beyond the two native profiles | playout profile registry and safe generic vendor mode were added, then bundled into `v1.8` and carried forward into `v1.9` |
| `2026-03-28 07:19:26 -04:00` | Registered operators could still accidentally alter identity fields in the local UI | a sensitive-setting lock was added to the UI and enforced again in the config save path, then shipped in `v1.9` |
| `2026-03-28 07:19:26 -04:00` | This PC needed a clean reinstall to the new agent baseline without losing its registered identity | the service was removed and reinstalled from the `v1.9` generic bundle with the saved config restored |

---

## Detailed Timeline

| Timestamp | Event |
|---|---|
| `2026-03-27 20:41:59 -04:00` | `LATEST-BUNDLES.txt` regenerated for the first generic-installer release set |
| `2026-03-28 05:55:24 -04:00` | `pulse-generic-v1.8`, `nj-optimum-v1.8`, `ny-main-v1.8`, `ny-backup-v1.8`, and `digicel-v1.8` rebuilt with the broader playout profile model |
| `2026-03-28 07:18:19 -04:00` | `pulse-generic-v1.9`, `nj-optimum-v1.9`, `ny-main-v1.9`, `ny-backup-v1.9`, and `digicel-v1.9` rebuilt after the sensitive-setting safety lock was added |
| `2026-03-28 07:19:26 -04:00` | Optimum PC clean reinstall completed from the `v1.9` generic bundle |
| `2026-03-28 07:22:24 -04:00` | release KB, install guide, architecture notes, and handover were synchronized around the verified `v1.9` baseline |

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

### 1. Add deeper native parsers for the next playout vendors

Status:

- not yet implemented

Why it still matters:

- `Insta` and `Admax` remain the only deep native profiles
- the newer vendor choices currently rely on generic process, log, and UDP selectors

### 2. Roll the generic installer onto more production Windows nodes

Status:

- partially completed

Why it still matters:

- this PC is already on `v1.9`
- other nodes still need the same generic-baseline rollout when scheduled

### 3. Keep alert contact data current in the hub

Status:

- ongoing operations task

Why it still matters:

- alert timing and semantics were intentionally left alone
- recipient correctness still determines whether Telegram and other channels reach the right operators

---

## Reference Files

- README: [README.md](/D:/monitoring/README.md)
- Architecture: [ARCHITECTURE.md](/D:/monitoring/docs/ARCHITECTURE.md)
- Deployment: [DEPLOYMENT.md](/D:/monitoring/docs/DEPLOYMENT.md)
- Agent install: [AGENT_INSTALL.md](/D:/monitoring/docs/AGENT_INSTALL.md)
- Handover: [HANDOVER.txt](/C:/Users/owner/Desktop/HANDOVER.txt)
