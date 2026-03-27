# Pulse - Product Requirements Document

**Project**: Pulse  
**Version**: 1.0.0  
**Date**: 2026-03-27  
**Author**: Pulse Team  
**Status**: Approved - implementation in progress

---

## 1. Problem Statement

Broadcast operations teams often run multiple playout nodes across one or more sites without a single reliable monitoring plane. That creates blind spots around off-air events, software stalls, node outages, and delayed incident response.

Pulse solves this by providing a shared monitoring platform for playout environments, whether they belong to one broadcaster, one managed services provider, or multiple businesses operating in different regions.

---

## 2. Goals

Build **Pulse** as a production-grade monitoring platform that provides:

- real-time visibility of all monitored playout players from a single dashboard
- automatic alerting when a player goes or is likely to go off-air
- clean separation of playout failure from network failure
- a lightweight Windows agent deployable without a separate Python install
- core identity based on `node_id` and `player_id`
- optional UDP stream confidence probes per player
- a deployment model that scales across customers, sites, and regions

---

## 3. Users

| User | Context | Primary Need |
|---|---|---|
| Broadcast operator | On call, checking phone or desktop | Know immediately when a player is off-air |
| Technical director | Office, NOC, or remote | Understand root cause and scope quickly |
| Support engineer | Managed service or internal ops | Receive reliable alerting and recovery signals |
| Platform administrator | Deployment and maintenance | Roll out node bundles consistently across environments |

---

## 4. Deployment Model

Pulse supports:

- single-player, single-node installations
- multi-node sites with mixed playout software
- multi-site regional deployments
- one platform serving many businesses with separate configs and tokens

### Example Reference Topology

| Node ID | Site ID | Players | Software Mix | UDP |
|---|---|---|---|---|
| `site-a-node-1` | `site-a` | `site-a-insta-1`, `site-a-insta-2` | Insta | optional |
| `site-a-node-2` | `site-a` | `site-a-admax-1` | Admax | optional |
| `site-b-node-1` | `site-b` | `site-b-admax-1`, `site-b-admax-2` | Admax | enabled on selected players |
| `site-c-node-1` | `site-c` | `site-c-insta-1` | Insta | optional |

Each node may carry multiple players, and each player may have zero to five UDP inputs.

---

## 5. Features

### 5.1 Core

| # | Feature | Priority |
|---|---|---|
| F1 | Real-time dashboard grouped by site and node | P0 |
| F2 | Per-player health cards | P0 |
| F3 | Separate `broadcast_health`, `runtime_health`, and `connectivity_health` | P0 |
| F4 | Audio and vibration alarm for critical states | P0 |
| F5 | Telegram alerting for critical and recovery events | P0 |
| F6 | Email alerting for critical and recovery events | P0 |
| F7 | Windows agent auto-start as a service | P0 |
| F8 | Agent packaged as a standalone `.exe` | P0 |
| F9 | Deep log monitoring for supported playout software | P0 |
| F10 | Process presence and window presence checks | P0 |
| F11 | Stall detection from local runtime files | P0 |
| F12 | Content error detection from error logs | P1 |
| F13 | Optional UDP stream confidence probing | P1 |
| F14 | Thumbnail snapshots for UDP-enabled players | P1 |
| F15 | Heartbeat stale/offline indicator | P0 |
| F16 | Installable mobile-responsive PWA dashboard | P1 |
| F17 | SQLite-backed alert dedup across hub restarts | P0 |
| F18 | Hub-managed UDP configuration sync back to the node | P1 |

### 5.2 Future

- maintenance mode per player
- user authentication and role-based access
- historical event views and reporting
- controlled recovery automation after prolonged failure
- multi-tenant dashboard segmentation

---

## 6. Non-Goals

- full browser video playback of monitored channels
- automatic restart or remediation by default
- support for non-Windows playout nodes in v1
- public-facing consumer status pages

---

## 7. Health State Model

Pulse tracks three independent health domains:

```text
broadcast_health:    healthy | degraded | off_air_likely | off_air_confirmed | unknown
runtime_health:      healthy | paused | restarting | stalled | stopped | content_error | unknown
connectivity_health: online | stale | offline
```

The hub is the only state engine. Agents send observations, not final state labels.

### Dashboard Color Mapping

| Color | Condition |
|---|---|
| Green | broadcast healthy and runtime healthy |
| Yellow | broadcast degraded or runtime warning state |
| Red | off-air likely or off-air confirmed |
| Orange | connectivity stale |
| Gray | connectivity offline or node not commissioned |

---

## 8. Monitoring Protocol

On each poll interval, the agent can:

1. check process and window presence
2. tail new log lines for runtime tokens
3. inspect local runtime files for stall or pause signals
4. check content error logs
5. probe local network and internet reachability
6. run UDP confidence checks when UDP inputs are enabled
7. POST one heartbeat per player to the hub

---

## 9. Constraints

- internet loss must not be treated as off-air by itself
- all normal communication is outbound from agent to hub
- the same product must work for one node or many nodes
- deployment-specific labels, domains, and tokens must live in config, not product docs
- node bundles must be rebuildable from a shared baseline

---

## 10. Success Metrics

| Metric | Target |
|---|---|
| Time from off-air event to critical alert | < 30 seconds |
| False critical alerts | < 1 per week per deployment |
| Agent uptime | > 99.9% |
| Hub availability | > 99.9% |
| Alert dedup correctness | 100% |

---

## 11. Deployment

| Component | Typical Placement | Runtime |
|---|---|---|
| Hub + Dashboard | Linux VPS, VM, or on-prem server | Node.js + PM2 + reverse proxy |
| Database | Same host as hub | SQLite |
| Agent | Each Windows playout node | Windows service |
| DNS / CDN | Operator choice | optional |

---

## 12. Revision History

| Date | Version | Change |
|---|---|---|
| 2026-03-27 | 1.0.0 | Generic product PRD aligned to multi-site, multi-business use |
