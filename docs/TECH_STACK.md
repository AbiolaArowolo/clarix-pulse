# Clarix Pulse — Tech Stack

**Version**: 1.0.0
**Date**: 2026-03-26

---

## Hub

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | 20 LTS |
| Language | TypeScript | 5.x |
| HTTP framework | Express | 4.x |
| WebSocket | Socket.io | 4.x |
| Database | SQLite via better-sqlite3 | 9.x |
| Email | Nodemailer | 6.x |
| HTTP client (Telegram) | node-fetch / built-in fetch | Node 20 native |
| Process manager | PM2 | 5.x |

## Dashboard

| Layer | Choice | Version |
|---|---|---|
| Build tool | Vite | 5.x |
| Framework | React | 18.x |
| Language | TypeScript | 5.x |
| Styling | TailwindCSS | 3.x |
| WebSocket client | socket.io-client | 4.x |
| Audio alarm | Web Audio API | native browser |

## Local Agent

| Layer | Choice | Version |
|---|---|---|
| Language | Python | 3.11 |
| HTTP client | requests | 2.x |
| Process inspection | psutil | 5.x |
| Windows window check | pywin32 | latest |
| YAML config | PyYAML | 6.x |
| Image compression | Pillow | 10.x |
| Packaging | PyInstaller | 6.x |
| Windows service | NSSM (bundled) | 2.24 |

## Infrastructure

| Layer | Choice |
|---|---|
| VPS | RackNerd 2.5GB KVM — 192.3.76.144 |
| OS | Ubuntu 22.04 LTS |
| Reverse proxy | Caddy 2.x |
| DNS / CDN | Cloudflare (proxied) |
| TLS | Let's Encrypt via Caddy (origin) + Cloudflare SSL |
| UDP media probe | ffmpeg / ffprobe (bundled in agent package) |

## Repository

| Item | Value |
|---|---|
| Repo | https://github.com/AbiolaArowolo/clarix-pulse.git |
| Structure | npm workspaces monorepo |
| Packages | packages/dashboard, packages/hub, packages/agent |
