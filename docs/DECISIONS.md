# Pulse - Decision Record Summary

**Document Date**: `2026-03-27 20:43:51 -04:00`

## ADR-001 - Node.js / Express / Socket.IO hub remains the core backend

**Decision**: keep the hub in Node.js + TypeScript with Express and Socket.IO.  
**Why**: it still fits heartbeat ingestion, state evaluation, and realtime dashboard fan-out well.  
**Current note**: unchanged by the `v1.6` refactor.

## ADR-002 - Python Windows agent remains the node runtime

**Decision**: keep the Windows agent in Python and package it into `clarix-agent.exe`.  
**Why**: it still fits Windows process, file, and service behavior very well.  
**Current note**: unchanged.

## ADR-003 - One service per node remains the service model

**Decision**: one Windows service monitors all configured players on a node.  
**Why**: simpler operations and upgrade flow.  
**Current note**: unchanged.

## ADR-004 - Health remains hub-computed only

**Decision**: agents send observations, not final health state.  
**Why**: health logic and alert logic stay centralized and consistent.  
**Current note**: unchanged.

## ADR-005 - Local node config remains authoritative for machine-local settings

**Decision**: paths, player layout, selectors, and UDP URLs stay owned by the node.  
**Why**: those settings are environment-specific and safest when edited on the machine that uses them.  
**Current note**: reinforced in `v1.6`, not relaxed.

## ADR-006 - Hub owns central operational state

**Decision**: maintenance, monitoring enable / disable, alert routing, tokens, and inventory stay hub-owned.  
**Why**: they are shared operational concerns, not machine-local runtime details.  
**Current note**: active in `v1.6`.

## ADR-007 - Dashboard remains read/write only for hub-owned controls

**Decision**: dashboard edits hub-owned controls and mirrors node-owned config read-only.  
**Why**: this preserves a clean ownership boundary and avoids unsafe remote edits for machine-local fields.  
**Current note**: the dashboard now mirrors more node detail, including selector data.

## ADR-008 - Move the hub off SQLite and onto PostgreSQL

**Decision**: stop using SQLite for the hub runtime and use PostgreSQL instead.  
**Why**: the product has outgrown a fragile single-file DB model, and the earlier live corruption made SQLite an operational liability.  
**Current note**: implemented in code in `v1.6`.

## ADR-009 - Keep a tiny legacy bootstrap catalog, but remove static runtime registry usage

**Decision**: keep `instances.ts` only as first-run seed data for known legacy nodes.  
**Why**: this smooths migration while removing hardcoded runtime ownership checks.  
**Current note**: runtime now validates against DB-backed inventory instead.

## ADR-010 - Add generic hub enrollment

**Decision**: add a hub enrollment endpoint that returns an `agent_token` to a newly configured node.  
**Why**: generic installer rollout requires self-registration instead of per-node bundle creation as the main onboarding path.  
**Current note**: implemented at `POST /api/config/enroll`.

## ADR-011 - Keep the alert semantics stable during the platform refactor

**Decision**: do not change the current way alerts are generated during the Postgres / installer / registry refactor.  
**Why**: the user explicitly requested that alert behavior stay untouched unless separately approved.  
**Current note**: honored in this pass.

## ADR-012 - Move hot thumbnails out of the main state store

**Decision**: store thumbnail bytes in a file cache instead of inline in the main hub state row.  
**Why**: it reduces write pressure and avoids carrying large base64 blobs through the primary persistence path.  
**Current note**: implemented in `v1.6`.

## ADR-013 - Prepared per-node bundles remain optional convenience artifacts

**Decision**: keep prepared bundles for current rollout convenience, but make the generic installer the default direction.  
**Why**: migration is easier with both paths available during transition.  
**Current note**: `pulse-generic-v1.6` is now part of the manifest and release tooling.

## ADR-014 - End major refactors with timestamped operational memory

**Decision**: keep writing timestamped KB and handover records after major release / refactor passes.  
**Why**: the project needs durable operational memory, not just code diffs.  
**Current note**: see [RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
