# Clarix Pulse — Project Session Log
> Append-only. Never edit or delete existing entries.
> One entry per agent session. Multiple tasks in one session = one entry.

---

## Session 001
**Agent:** Claude Sonnet 4.6
**Date:** 2026-03-31
**Time:** ~03:00 – 05:30 UTC
**Worked on:** Root cause investigation of heartbeat timeout + VPS hardening + discovery script fix
**Status at end of session:** Hub healthy, Caddy updated, Express try/catch added, discovery script fixed. Cloudflare DNS record for `agent.clarixtech.com` still needs manual creation.

### Tasks Completed
- **VPS cleanup** — Removed 54 old `pulse-clean-backup-*` dirs, all `pulse-clean-deploy-*.tar.gz` files, and `pulse-env-before-force-sync-*.env.local` from `/root/`. Cleared pm2 error log.
- **Caddy access logging** — Added `log { output file /var/log/caddy/access.log format json }` to both `pulse.clarixtech.com` and new `agent.clarixtech.com` blocks
- **Cloudflare bypass (server side)** — Added `agent.clarixtech.com` vhost to Caddyfile that serves `/api/*` and `/socket.io/*` directly from Node — designed for DNS-only (no Cloudflare proxy) so PyInstaller JA3 fingerprints bypass bot scoring
- **Express 4 try/catch** — Wrapped entire `router.post('/')` body in `packages/hub/src/routes/heartbeat.ts` with try/catch; any DB exception now returns `500` instead of hanging forever
- **Discovery script** — Replaced `packages/agent/discover-node.ps1` and `packages/agent/release/clarix-pulse-v1.9/discover-node.ps1` with hardened version that computes `$_scriptDir` safely for all run modes (file, iex pipe, stdin); also replaced `discover-node.ps1` inside `/var/lib/clarix-pulse/downloads/clarix-pulse-v1.9.zip`
- **Built & deployed** — TypeScript compiled clean, `dist/routes/heartbeat.js` uploaded to VPS, pm2 restarted (`clarix-hub` online, 0 errors)

### Tasks Partially Done
- **Cloudflare bypass** — Caddyfile updated, Caddy reloaded. Still need to add `agent.clarixtech.com` A record in Cloudflare DNS set to `192.3.76.144` with **proxy disabled (gray cloud)**. Until that DNS record exists the subdomain won't resolve.

### Tasks Not Touched
- IMPLEMENTATION-PROMPT.md Tasks 1–10 (added to backlog this session; implementation pending agent spawns)

### Decisions Made
- **Gray-cloud DNS subdomain** chosen over firewall IP allowlisting or User-Agent spoofing. Reasoning: permanent, zero maintenance, no bottleneck, dashboard stays protected by orange-cloud proxy, agent traffic routes directly to VPS.
- **`$_scriptDir` variable** introduced in discovery script rather than patching each callsite, so any future PSScriptRoot references in the file will also use the safe fallback.

### Blockers / Issues Found
- **Cloudflare DNS for `agent.clarixtech.com`** — Must be added manually or via API before the agent can use the new subdomain. Add an A record: Name=`agent`, Value=`192.3.76.144`, Proxy=OFF.
- **Agent config not updated yet** — `hub_url` in `C:\ProgramData\ClarixPulse\Agent\config.yaml` on BACKUP-SERVER still points to `https://pulse.clarixtech.com`. Once DNS is live, update it to `https://agent.clarixtech.com` to bypass Cloudflare bot detection.
- **Route alias `/api/agent/heartbeat` not yet added** — The agent binary POSTs to `/api/agent/heartbeat` but the hub only has `/api/heartbeat`. This is TASK 1a in IMPLEMENTATION-PROMPT.md.
- **Snake_case body fields not yet accepted** — TASK 1b: agent sends `player_id`/`node_id`, hub expects `playerId`/`nodeId`.

### Files Changed
| File | Change summary |
|---|---|
| `packages/hub/src/routes/heartbeat.ts` | Wrapped async handler in try/catch; returns 500 on unhandled error |
| `packages/agent/discover-node.ps1` | Replaced with hardened version (`$_scriptDir` guard, PS 5.1 compat, `$MyInvocation` fallback) |
| `packages/agent/release/clarix-pulse-v1.9/discover-node.ps1` | Same replacement |
| `/etc/caddy/Caddyfile` (VPS) | Added access logging + `agent.clarixtech.com` vhost |
| `/var/lib/clarix-pulse/downloads/clarix-pulse-v1.9.zip` (VPS) | Replaced `discover-node.ps1` inside the bundle |

---
