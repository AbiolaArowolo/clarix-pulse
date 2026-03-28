# Pulse - Architecture Decision Record Summary

**Document Date**: 2026-03-27

This file records current product-level technical decisions and current operational posture.

## ADR-001 - Node.js + Express + Socket.IO hub

**Decision**: The hub remains a Node.js / TypeScript service built on Express and Socket.IO.  
**Why**: It fits heartbeat ingestion, state evaluation, and real-time fan-out well.  
**Current note**: No change as part of the March 27, 2026 release pass.

## ADR-002 - Python Windows agent packaged as a standalone executable

**Decision**: The node agent remains Python-based and is packaged into `clarix-agent.exe`.  
**Why**: It is a strong fit for Windows process inspection, YAML config handling, and packaging into a single operator-friendly artifact.  
**Current note**: One-click install via `install.bat` remains the supported operator path.

## ADR-003 - One agent service per node

**Decision**: One Windows service monitors all configured players on a node.  
**Why**: This keeps service management simple while still supporting multi-player nodes.  
**Current note**: No change.

## ADR-004 - Health is computed only in the hub

**Decision**: Agents send observations, not final health states.  
**Why**: A single state engine prevents drift and keeps alert logic centralized.  
**Current note**: No change.

## ADR-005 - Three separate health domains

**Decision**: Keep `broadcast_health`, `runtime_health`, and `connectivity_health` separate.  
**Why**: Connectivity loss must not be confused with off-air or runtime failure.  
**Current note**: No change.

## ADR-006 - Local node config is the source of truth for machine-local monitoring inputs

**Decision**: Machine-local settings are owned by the node, not the hub.  
**Why**: Local paths, selectors, player layout, and UDP stream endpoints are environment-specific and belong with the machine that uses them.  
**Current note**: This is the active production model in the March 27, 2026 release.

## ADR-007 - Dashboard mirrors node config but does not own path / UDP editing in the current release

**Decision**: The dashboard is read-only for mirrored node config in the current production release.  
**Why**: The local node UI is more trustworthy for machine-local config, and the hub-side desired-config flow is not fully active yet.  
**Current note**: `POST /api/config/player/:playerId` intentionally does not act as a live config editor in production.

## ADR-008 - Operational controls stay hub-owned

**Decision**: Monitoring enabled / disabled, maintenance mode, and alert settings are hub-owned controls.  
**Why**: These are cross-operator operational decisions rather than machine-local runtime settings.  
**Current note**: Active in production.

## ADR-009 - External DB path for production hub persistence

**Decision**: Production hub persistence must use `PULSE_DB_PATH` or `PULSE_DATA_DIR`, not the bundled app-tree DB path.  
**Why**: Deploys must not overwrite or re-import the app-local DB.  
**Current note**: Adopted on the VPS as of March 27, 2026.

## ADR-010 - SQLite remains current-state storage, but it is no longer considered the final long-term control-plane database

**Decision**: Keep SQLite for the current release, but treat PostgreSQL as the recommended next persistence target for the hub control plane.  
**Why**: The live external SQLite file is still showing corruption in production, and the hub is evolving from a small state cache into a real control plane.  
**Current note**: March 27, 2026 review recommends PostgreSQL for the next architecture phase.

## ADR-011 - Shared bundle baseline for release installers

**Decision**: All node installers must be rebuilt from the same runtime baseline.  
**Why**: This avoids drift and gives predictable rollout behavior.  
**Current note**: The March 27, 2026 release bundle baseline is `v1.5`.

## ADR-012 - Prepared per-node bundles remain the current production rollout method

**Decision**: Continue shipping prepared per-node bundles for the current rollout phase.  
**Why**: The hub registry is still static, so full generic onboarding is not complete yet.  
**Current note**: Generic installer flow is a target direction, but not yet the only production onboarding path.

## ADR-013 - Timestamped release / operations knowledge base

**Decision**: Close major debug and rollout passes with a timestamped release knowledge-base record.  
**Why**: The project needs durable operational memory, not just code changes.  
**Current note**: The March 27, 2026 release record lives in [docs/RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
