# Pulse - Architecture Document

**Version**: 1.0.0  
**Date**: 2026-03-27  
**Status**: Baseline - approved for implementation

---

## 1. System Overview

Pulse is a three-tier monitoring system built around nodes and players.

```text
PLAYOUT NODES
  - one or more Windows nodes per site
  - one or more players per node
  - optional UDP inputs per player

LOCAL AGENT
  - one Windows service per node
  - polls local runtime state
  - reports raw observations

HUB
  - receives heartbeats
  - computes health state
  - stores current state and events
  - emits dashboard updates

DASHBOARD / PWA
  - renders site, node, and player state
  - shows alarm conditions
  - exposes optional UDP config editing
```

The key identity rule is:

- `node_id` identifies the physical host
- `player_id` identifies the individual playout source on that host

---

## 2. Component Responsibilities

### 2.1 Local Agent

- runs as a Windows service
- reads local files, logs, process state, and optional UDP inputs
- never accepts inbound connections
- posts raw observations to the hub
- can sync hub-managed UDP settings back into local `config.yaml`

### 2.2 Hub

- validates Bearer tokens per node
- maps each `node_id` to allowed `player_id` values
- computes `broadcast_health`, `runtime_health`, and `connectivity_health`
- stores current state and event history in SQLite
- emits real-time updates to dashboard clients
- serves config-edit APIs for protected UDP management

### 2.3 Dashboard

- serves a live operational view
- consumes real-time state updates over Socket.IO
- falls back to API polling when needed
- supports mobile and desktop PWA install
- can edit UDP input configuration when the write key is provided

### 2.4 State Store

SQLite is the source of truth for:

- current instance state
- incident transitions
- alert dedup
- persisted thumbnails

---

## 3. Data Flow

### 3.1 Heartbeat Flow

```text
Agent polls local checks for one player
  -> POST /api/heartbeat
  -> Hub validates token and player ownership
  -> Hub computes health state
  -> Hub updates SQLite state
  -> Hub emits Socket.IO update
  -> Dashboard re-renders affected card
```

### 3.2 Thumbnail Flow

```text
Agent captures frame from selected UDP input
  -> POST /api/thumbnail
  -> Hub stores thumbnail
  -> Hub emits thumbnail update
  -> Dashboard refreshes preview
```

### 3.3 Config Sync Flow

```text
Operator edits UDP settings in dashboard
  -> Dashboard calls protected config API
  -> Hub updates canonical node config
  -> Agent receives desired config in heartbeat response
  -> Agent writes updated UDP inputs to local config.yaml
  -> Next poll applies the new UDP settings
```

### 3.4 Timeout Flow

```text
Hub timer checks heartbeat age
  -> stale after about 45s
  -> offline after about 90s
  -> dashboard keeps last known state while marking connectivity separately
```

---

## 4. Identity and Security

### 4.1 Identity Model

- each node has one token
- each heartbeat declares both `nodeId` and `playerId`
- hub enforces allowed player IDs per node
- source IP is not used for identity

### 4.2 Transport

- agents call the hub over HTTP or HTTPS, depending on deployment
- HTTPS is recommended for internet-facing deployments
- reverse proxy and CDN choices are deployment-specific

### 4.3 Secrets and Config

Typical secret sources:

- `.env` / `.env.local` on the hub host
- `config.yaml` on each node

Typical config fields:

```yaml
node_id: site-a-node-1
agent_token: REPLACE_ME
hub_url: https://monitor.example.com
players:
  - player_id: site-a-insta-1
    udp_inputs:
      - udp_input_id: site-a-insta-1-udp-1
        enabled: true
        stream_url: udp://239.1.1.1:5000
```

---

## 5. Monitoring Model

### 5.1 Supported Signal Families

- process presence
- window presence
- log tokens
- local runtime file movement
- content error logs
- connectivity checks
- UDP stream confidence

### 5.2 Health Computation

The hub combines raw observations into three separate domains:

- broadcast health
- runtime health
- connectivity health

This prevents connectivity failures from being misreported as off-air events.

### 5.3 UDP Model

- UDP is optional per player
- each player can hold multiple UDP inputs
- the agent probes enabled inputs and chooses the best active source
- the hub uses the returned UDP observations to strengthen off-air confidence

---

## 6. Deployment Patterns

Pulse can be deployed in several ways:

- one hub serving one site
- one hub serving many sites
- one managed platform serving many businesses with separate node configs

Typical infrastructure:

- Linux host for hub and dashboard
- Node.js runtime with PM2
- reverse proxy such as Caddy
- optional DNS/CDN in front

---

## 7. Operational Rule

Product docs should remain generic. Customer names, live domains, tokens, and site-specific topology belong in deployment config and private operations notes, not in shared architecture material.
