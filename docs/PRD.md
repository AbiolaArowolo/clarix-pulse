# Pulse - Product Requirements Summary

**Document Date**: `2026-03-27 20:43:51 -04:00`  
**Status**: Current product summary after the PostgreSQL and generic-installer refactor

## Problem

Operators need to monitor playout nodes across sites without confusing:

- runtime faults
- network faults
- stream faults
- machine-specific config issues

Pulse solves this with:

- a Windows agent
- a central hub
- a live dashboard
- alerting through Telegram and email

---

## Current Product Goals

The product now targets:

- one generic Windows installer by default
- local node UI as the source of truth for machine-specific config
- hub-owned operational control plane
- Postgres-backed central persistence
- dynamic enrollment for new nodes
- mirrored read-only node config in the dashboard

---

## Active Scope

### Shipped in code

- Postgres-backed hub persistence
- DB-backed node / player / token inventory
- generic node enrollment
- Windows service agent
- persistent local UI
- process selectors and log selectors in the local UI
- mirrored node config in the dashboard
- maintenance mode
- monitoring enable / disable
- Telegram and email alerting
- file-based thumbnail cache instead of DB-inline blobs

### Intentionally unchanged

- current play / pause / stop monitoring logic
- current alert timing / trigger behavior

### Current operational follow-ups

- rolling the generic installer to more PCs
- validating self-enrollment from the local UI on new nodes
- replacing any legacy Telegram username recipient with a numeric chat ID

---

## Ownership Requirements

### Node-owned

- log paths
- playout type
- player count
- process selectors
- log selectors
- UDP URLs

### Hub-owned

- monitoring enabled / disabled
- maintenance mode
- alert routing
- tokens
- inventory
- mirrored config storage

### Dashboard role

- edit hub-owned controls
- display live health and alarms
- display mirrored node config read-only

---

## Installation Requirements

- install should be as close to one-click as Windows allows
- admin should only be needed for the final service installation phase
- generic setup should be able to enroll itself without a custom node bundle
- per-node bundles should remain optional convenience artifacts, not the main architecture

---

## Monitoring Requirements

- process, window, file, and log monitoring stay active for supported playout types
- optional UDP monitoring stays per-player
- pause remains yellow immediately and escalates based on the accepted current rules
- stop remains yellow immediately and escalates based on the accepted current rules
- player shutdown remains red immediately

---

## Knowledge Base Requirement

Major refactor and release passes must leave behind:

- updated top-level docs
- updated handover
- exact release bundle information
- timestamped challenge notes
- clear statement of what changed and what intentionally did not change

The current dated record is [RELEASE_KB_2026-03-27.md](/D:/monitoring/docs/RELEASE_KB_2026-03-27.md).
