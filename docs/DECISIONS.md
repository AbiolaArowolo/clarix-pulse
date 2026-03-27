# Pulse - Architecture Decision Records

This document records product-level technical decisions only. Customer-specific rollout notes, live incident logs, and private deployment details should live outside the shared product docs.

---

## ADR-001 - Vite + React dashboard

**Decision**: Use a Vite-built React SPA for the dashboard.  
**Why**: The interface is a real-time operational console, so a lightweight SPA is a better fit than an SSR framework.  
**Consequence**: The dashboard is static-build friendly and easy to host behind a reverse proxy.

## ADR-002 - Node.js + Express hub

**Decision**: Use Node.js with Express and Socket.IO for the hub.  
**Why**: The hub is primarily an I/O and state-computation service with live updates.  
**Consequence**: The hub is optimized for heartbeat ingestion, state transitions, and realtime fan-out.

## ADR-003 - Python Windows agent

**Decision**: Use Python for the Windows agent and package it as a standalone executable.  
**Why**: Python has the strongest fit for process inspection, Windows integration, YAML handling, and packaging into a single `.exe`.  
**Consequence**: Operators do not need a separate Python install on monitored nodes.

## ADR-004 - SQLite state store

**Decision**: Use SQLite as the hub state store.  
**Why**: It keeps deployment simple while preserving current state, event history, and alert dedup across restarts.  
**Consequence**: Backup is straightforward and no separate database server is required.

## ADR-005 - Three-domain health model

**Decision**: Track broadcast, runtime, and connectivity as separate domains.  
**Why**: Connectivity failures must not be confused with confirmed off-air conditions.  
**Consequence**: Dashboard color and alert logic are derived from multiple domains instead of one flat status field.

## ADR-006 - Identity by node and player

**Decision**: Use `node_id` for hosts and `player_id` for monitored playout sources.  
**Why**: A single node can run multiple players with different software and different UDP behavior.  
**Consequence**: The same platform works for simple and complex sites.

## ADR-007 - One agent per node

**Decision**: Run one agent service per physical Windows node.  
**Why**: This simplifies service management while still allowing multiple players to be monitored.  
**Consequence**: The agent loops across all configured players on the node each cycle.

## ADR-008 - UDP probing on the node, not on the hub

**Decision**: Run `ffprobe` and `ffmpeg` checks only on the monitored node.  
**Why**: UDP streams are often available only on local network segments behind NAT or private routing.  
**Consequence**: The hub receives UDP observations from the node rather than probing streams directly.

## ADR-009 - Shared bundle baseline

**Decision**: Rebuild all node bundles from one shared runtime baseline.  
**Why**: This avoids drift and makes multi-site rollouts more reliable.  
**Consequence**: Only deployment-specific `config.yaml` values should differ between node bundles.

## ADR-010 - One-click installation

**Decision**: Bundle the agent, service wrapper, and UDP binaries into a one-click node install package.  
**Why**: Operators should not need separate dependency installation on each Windows host.  
**Consequence**: `install.bat` can install a fully working node in one step.

## ADR-011 - Protected dashboard-side UDP editing

**Decision**: Allow UDP settings to be edited from the dashboard behind a write key.  
**Why**: Operators need a safe way to update stream URLs without manually editing node files.  
**Consequence**: The hub stores desired UDP settings and the agent syncs them into local `config.yaml`.

## ADR-012 - Generic product-facing documentation

**Decision**: Keep shared docs generic and reusable across customers.  
**Why**: Pulse is a platform, not a single-client custom document set.  
**Consequence**: Customer names, live domains, and site-specific rollout details belong in deployment-specific config and private operations notes.
