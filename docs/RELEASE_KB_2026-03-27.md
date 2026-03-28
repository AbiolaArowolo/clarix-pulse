# Pulse Release Knowledge Base - 2026-03-27

**Prepared**: `2026-03-27 19:54:48 -04:00`  
**Scope**: March 27, 2026 release hardening, installer alignment, documentation closure, and operational record

## Executive Summary

This release pass closed the immediate rollout work for the current Pulse baseline without changing the accepted play / pause / stop runtime logic any further.

Release outcomes:

- prepared node bundles rebuilt to `v1.5`
- bundle parity verified against the manifest and canonical configs
- top-level product and deployment documents aligned to actual product behavior
- handover refreshed
- timestamped operations record created

Important production note:

- the live VPS hub is online, but the external SQLite DB file is still showing `SQLITE_CORRUPT`

---

## Final Release Artifacts

Release folder:

- [packages/agent/release](/D:/monitoring/packages/agent/release)

### Common Agent Runtime Hash

All `v1.5` bundles contain the same agent executable:

```text
clarix-agent.exe SHA256
485E23B24EC290C4156234A80C33F176AA4D9B5F3E0EAD1D7D64803E44B520FB
```

### Bundle Zip Hashes

| Bundle | Zip Path | SHA256 |
|---|---|---|
| `nj-optimum-v1.5` | [nj-optimum-v1.5.zip](/D:/monitoring/packages/agent/release/nj-optimum-v1.5.zip) | `BD7E1098B991F3542CAC9D88CEFA9039205A6740C1F595D5202511E3CEA56819` |
| `ny-main-v1.5` | [ny-main-v1.5.zip](/D:/monitoring/packages/agent/release/ny-main-v1.5.zip) | `BD974C14B6C9FDF0BDA97DEB6AD17B4B831C208BD9BF66E6630B90C79ABFEA4C` |
| `ny-backup-v1.5` | [ny-backup-v1.5.zip](/D:/monitoring/packages/agent/release/ny-backup-v1.5.zip) | `F51BE3F7F7CE97FCD619EB98C78CC9D68B9300342D67B8F1B2EAEBCFA89AD4AC` |
| `digicel-v1.5` | [digicel-v1.5.zip](/D:/monitoring/packages/agent/release/digicel-v1.5.zip) | `6E50DA8801867EA09C5E33309C1468C03D9E31D8DB569ED8CFC1D19824679765` |

### Release Manifest

Current manifest:

- [configs/node-bundles.json](/D:/monitoring/configs/node-bundles.json)

Current default version:

- `v1.5`

### Bundle Verification

Verification command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-bundle-parity.ps1
```

Result:

- parity passed after the `v1.5` rebuild

---

## Current Product Truths

These are the architecture truths that matter for operations and rollout.

### 1. Local Node Config Is Authoritative

Machine-local config belongs on the node:

- local paths
- player layout
- playout type
- UDP inputs
- selectors

Current source of truth:

- `%ProgramData%\ClarixPulse\Agent\config.yaml`
- local Pulse UI at `http://127.0.0.1:3210/`

### 2. Dashboard Is A Mirror For Node Config

The dashboard can display mirrored stream settings and current node config, but it is not the authoritative editor for machine-local settings in the current release.

### 3. Hub Registry Is Still Static

The hub still depends on:

- static commissioned node / player registry in [packages/hub/src/config/instances.ts](/D:/monitoring/packages/hub/src/config/instances.ts)
- `AGENT_TOKENS` for node authentication

This means a brand-new node still requires hub-side registration data before it can heartbeat successfully.

### 4. Runtime Logic Is Accepted For The Current Release

The accepted current monitoring behavior is:

- pause: yellow immediately, red after about 60 seconds
- stop: yellow immediately, red after about 60 seconds
- player shut down: red immediately

Release note:

- do not reopen or change the play / pause / stop logic as part of this release closure unless a new live regression is proven

---

## Live VPS Validation Snapshot

### Validation Window

Primary live validation captured during the evening release pass:

- `2026-03-27 19:36:06 -04:00`

### Confirmed Good

- public `/api/health` returned `{"ok":true}`
- local `/api/health` returned `{"ok":true}`
- PM2 showed `clarix-hub` online
- hub reported `State DB path: /var/lib/clarix-pulse/clarix.db`

### Confirmed Bad / Incomplete

- PM2 error logs still showed `SQLITE_CORRUPT: database disk image is malformed`
- Telegram logs still showed `Bad Request: chat not found` for at least one configured target

Operational conclusion:

- the VPS is online and usable
- the DB-path cutover is correct
- the DB durability issue is not solved yet

---

## Challenges Encountered

| Timestamp | Challenge | Outcome |
|---|---|---|
| `2026-03-27 12:20:49 -04:00` | Prior handover still described pause as unresolved | superseded by the final release record |
| `2026-03-27 13:39:20 -04:00` | First `nj-optimum-v1.5` bundle prepared during Windows-side installer quieting work | bundle became the basis for the final aligned runtime baseline |
| `2026-03-27 19:36:06 -04:00` | Live hub health was up, but DB corruption remained in PM2 logs | DB path fix confirmed; DB durability issue remains open |
| `2026-03-27 19:36:06 -04:00` | Telegram alerting still reported `chat not found` | alert recipient cleanup still needed |
| `2026-03-27 19:52:01 -04:00` to `2026-03-27 19:53:03 -04:00` | All prepared bundles needed to be rebuilt to the same final version before wider rollout | complete; all prepared node bundles rebuilt to `v1.5` |

---

## Detailed Timeline

| Timestamp | Event |
|---|---|
| `2026-03-27 12:20:49 -04:00` | Prior `HANDOVER.txt` snapshot written before final release closure |
| `2026-03-27 13:39:20 -04:00` | `nj-optimum-v1.5.zip` created |
| `2026-03-27 19:36:06 -04:00` | live VPS `/api/health` confirmed `ok`; PM2 confirmed `clarix-hub` online |
| `2026-03-27 19:36:06 -04:00` | live PM2 logs confirmed `PULSE_DB_PATH=/var/lib/clarix-pulse/clarix.db` is active and `SQLITE_CORRUPT` still exists |
| `2026-03-27 19:51:41 -04:00` | `nj-optimum-v1.5` folder metadata refreshed |
| `2026-03-27 19:52:01 -04:00` | `nj-optimum-v1.5.zip` rebuilt |
| `2026-03-27 19:52:05 -04:00` | `ny-main-v1.5` folder metadata refreshed |
| `2026-03-27 19:52:23 -04:00` | `ny-main-v1.5.zip` rebuilt |
| `2026-03-27 19:52:26 -04:00` | `ny-backup-v1.5` folder metadata refreshed |
| `2026-03-27 19:52:44 -04:00` | `ny-backup-v1.5.zip` rebuilt |
| `2026-03-27 19:52:46 -04:00` | `digicel-v1.5` folder metadata refreshed |
| `2026-03-27 19:53:03 -04:00` | `digicel-v1.5.zip` rebuilt |
| `2026-03-27 19:53:04 -04:00` | `LATEST-BUNDLES.txt` regenerated |
| `2026-03-27 19:54:48 -04:00` | final hash capture and release knowledge-base preparation completed |

---

## Outstanding Risks After Release Closure

### 1. External SQLite DB Corruption

Status:

- still present

Impact:

- hub persistence cannot be considered clean or durable

Current short-term remedy:

- backup and use [scripts/vps_repair_state_db.py](/D:/monitoring/scripts/vps_repair_state_db.py) if a reset is approved

Long-term recommendation:

- move the hub control plane to PostgreSQL

### 2. Static Hub Registry

Status:

- still active

Impact:

- prevents true dynamic onboarding of brand-new nodes

Long-term recommendation:

- replace code registry + env token map with DB-backed nodes, players, and registration flow

### 3. Thumbnail Persistence Pressure

Status:

- thumbnails are still stored inline in hub state

Impact:

- unnecessary DB write and payload pressure

Long-term recommendation:

- move thumbnails out of the primary state DB path

### 4. Telegram Recipient Hygiene

Status:

- at least one configured target still fails with `chat not found`

Impact:

- alert delivery is partially degraded

Long-term recommendation:

- clean saved Telegram target configuration and retest

---

## Recommended Next Phase

Do not spend the next pass reopening accepted runtime behavior unless live monitoring regresses again.

The next engineering phase should focus on:

1. hub DB repair or replacement
2. PostgreSQL migration planning
3. DB-backed node / player inventory
4. dynamic node enrollment
5. cleaner desired-vs-current config flow

---

## Reference Files

- Release guide: [packages/agent/release/LATEST-BUNDLES.txt](/D:/monitoring/packages/agent/release/LATEST-BUNDLES.txt)
- Manifest: [configs/node-bundles.json](/D:/monitoring/configs/node-bundles.json)
- Handover: [HANDOVER.txt](C:/Users/owner/Desktop/HANDOVER.txt)
- Current runtime spec: [docs/MONITORING_SPEC.md](/D:/monitoring/docs/MONITORING_SPEC.md)
- Deployment guide: [docs/DEPLOYMENT.md](/D:/monitoring/docs/DEPLOYMENT.md)
