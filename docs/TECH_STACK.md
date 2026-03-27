# Pulse - Tech Stack

**Version**: 1.0.0  
**Date**: 2026-03-27

---

## Hub

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | 20 LTS |
| Language | TypeScript | 5.x |
| HTTP framework | Express | 4.x |
| Realtime transport | Socket.IO | 4.x |
| Database client | `@libsql/client` | 0.14.x |
| Email | Nodemailer | 6.x |
| Process manager | PM2 | 5.x |

## Dashboard

| Layer | Choice | Version |
|---|---|---|
| Build tool | Vite | 5.x |
| Framework | React | 18.x |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 3.x |
| Realtime client | `socket.io-client` | 4.x |
| Mobile install | PWA support | browser-native |

## Local Agent

| Layer | Choice | Version |
|---|---|---|
| Language | Python | 3.11 |
| HTTP client | requests | 2.x |
| Process inspection | psutil | 5.x |
| Windows window inspection | pywin32 | latest |
| YAML config | PyYAML | 6.x |
| Image handling | Pillow | 10.x |
| Packaging | PyInstaller | 6.x |
| Windows service wrapper | NSSM | staged in bundle |

## Infrastructure

| Layer | Typical Choice |
|---|---|
| Hub host | Linux VPS, VM, or on-prem server |
| OS | Ubuntu 24.04 LTS or similar |
| Reverse proxy | Caddy 2.x |
| Database | SQLite |
| Optional DNS / CDN | provider of choice |
| UDP media probe | ffmpeg / ffprobe on node |

## Repository Shape

| Item | Value |
|---|---|
| Structure | npm workspaces monorepo |
| Hub package | `packages/hub` |
| Dashboard package | `packages/dashboard` |
| Agent package | `packages/agent` |
| Deployment configs | `configs/` |
| Automation scripts | `scripts/` |
