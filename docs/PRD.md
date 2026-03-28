# Pulse - Product Requirements Summary

**Document Date**: 2026-03-27  
**Status**: Current release summary with next-phase direction

## Problem

Broadcast operators need a reliable way to monitor playout nodes across multiple sites without confusing runtime faults, connectivity faults, and off-air conditions.

Pulse addresses this with:

- a Windows node agent
- a central hub state engine
- a live dashboard / PWA
- alerting for critical and recovery events

---

## Current Release Goals

The current release is optimized for:

- stable monitoring of commissioned nodes
- correct play / pause / stop runtime behavior
- one-click Windows installation
- local node configuration through a persistent local UI
- remote visibility through a dashboard mirror
- consistent release bundles across all prepared nodes

---

## Current Product Scope

### Shipped / Active

- real-time dashboard grouped by site and player
- separate broadcast, runtime, and connectivity health
- Windows service agent
- Insta and Admax monitoring
- optional UDP monitoring per player
- thumbnail previews for UDP-enabled monitoring
- maintenance mode
- monitoring enable / disable control
- Telegram and email alerting
- alert-channel enable / disable toggles
- local node UI as the source of truth for machine-local config
- mirrored node config in the dashboard

### Current Operational Constraints

- hub onboarding is still static and commissioned in code / env
- new nodes still need registry and token work on the hub
- hub persistence is still SQLite
- dashboard does not currently own machine-local config editing

---

## User Roles

| User | Need |
|---|---|
| Operator | See off-air risk immediately and react quickly |
| Engineer | Diagnose runtime vs connectivity vs signal issues |
| Platform admin | Build and roll out bundles consistently |
| Support lead | Preserve operational memory and release notes |

---

## Current Release Requirements

### Monitoring

- Process, window, file, and log monitoring must remain active for supported playout types.
- Optional UDP monitoring must remain per-player, not global.
- Pause should show yellow immediately and red after sustained duration.
- Stop should show yellow immediately and red after sustained duration.
- Player shutdown should go red immediately.

### Configuration Ownership

- The node must own machine-local settings such as paths and UDP URLs.
- The hub must own operational controls such as maintenance and monitoring enabled state.
- The dashboard must clearly reflect mirrored node settings and current controls.

### Installer Consistency

- Every release bundle must use the same runtime baseline.
- Bundle-specific variation should be limited to config and labeling.

### Knowledge Base

- Major release and debug passes must be documented with exact timestamps, outcomes, artifacts, risks, and next actions.

---

## Future Requirements

The next major product phase should add:

- dynamic node enrollment / registration
- DB-backed inventory for nodes and players
- PostgreSQL hub persistence
- cleaner desired-vs-current config flow
- optional remote config editing with version / ack safety

---

## Success Criteria For The March 27, 2026 Release

- Play / pause / stop behavior accepted in live use
- All prepared node bundles rebuilt to `v1.5`
- Documentation aligned with actual product behavior
- Clear record of current live risks, especially hub DB durability

The detailed release record is captured in [docs/RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
