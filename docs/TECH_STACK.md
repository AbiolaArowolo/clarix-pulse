# Pulse - Tech Stack

**Document Date**: 2026-03-27

## Hub

| Layer | Current Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript |
| HTTP framework | Express |
| Realtime transport | Socket.IO |
| Current DB client | `@libsql/client` |
| Current DB engine | SQLite |
| Email | Nodemailer |
| Process manager | PM2 |

Current note:

- SQLite is still the active hub store
- PostgreSQL is the recommended next-step store for the hub control plane

## Dashboard

| Layer | Current Choice |
|---|---|
| Build tool | Vite |
| Framework | React |
| Language | TypeScript |
| Realtime client | `socket.io-client` |
| Install model | PWA / browser-native install |

## Windows Agent

| Layer | Current Choice |
|---|---|
| Language | Python 3.11 |
| Packaging | PyInstaller |
| HTTP client | requests |
| Process inspection | psutil |
| Windows integration | pywin32 |
| YAML | PyYAML |
| Image handling | Pillow |
| Service wrapper | NSSM |
| Media probing | ffmpeg / ffprobe bundled in installer |

## Operational Infrastructure

| Layer | Current Choice |
|---|---|
| Hub host | Linux VPS / VM / on-prem server |
| Reverse proxy | Caddy |
| TLS / public edge | operator choice |
| Persistent hub DB path | `PULSE_DB_PATH` |
| Node-local config UI | built into the agent at `127.0.0.1:3210` |

## Current Architecture Direction

- local YAML on the node remains the source of truth for machine-local config
- hub persistence is currently SQLite but under review for PostgreSQL migration
- prepared per-node bundles are the current rollout format
- generic installer plus dynamic enrollment is the next major onboarding target
