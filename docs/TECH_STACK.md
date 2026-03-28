# Pulse - Tech Stack

**Document Date**: `2026-03-27 20:43:51 -04:00`

## Hub

| Layer | Current Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript |
| HTTP framework | Express |
| Realtime transport | Socket.IO |
| DB client | `pg` |
| DB engine | PostgreSQL |
| Alerts | Nodemailer + Telegram Bot API |
| Process manager | PM2 |
| Thumbnail cache | local filesystem path via `PULSE_THUMBNAIL_DIR` |

## Dashboard

| Layer | Current Choice |
|---|---|
| Framework | React |
| Language | TypeScript |
| Build tool | Vite |
| Realtime client | `socket.io-client` |
| Delivery model | browser app / PWA |

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
| Local UI | built into the agent at `127.0.0.1:3210` |

## Release Tooling

| Layer | Current Choice |
|---|---|
| Bundle builder | PowerShell |
| Bundle parity verification | PowerShell |
| Prepared bundles | optional convenience path |
| Generic bundle | primary onboarding path |

## Current Runtime Direction

- PostgreSQL is now the only hub database target in code
- node-local YAML remains the machine-local source of truth
- hub DB owns inventory, tokens, mirrored config, state, and controls
- alert behavior was intentionally left unchanged during this stack transition
