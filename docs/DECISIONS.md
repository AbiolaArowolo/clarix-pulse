# Clarix Pulse — Architecture Decision Records

This log records every significant technical decision made during design and implementation.
Format: Date | Decision | Alternatives considered | Rationale | Consequences

---

## ADR-001 — React + Vite for dashboard, not Next.js
**Date**: 2026-03-26
**Decision**: Use Vite + React SPA, served as static files from Caddy.
**Alternatives**: Next.js (SSR/SSG), SvelteKit, plain HTML+JS
**Rationale**: The dashboard is an internal real-time tool driven entirely by WebSocket events.
Server-side rendering adds no value here — there is no SEO requirement, no public page, and no
data that needs to be pre-fetched per request. Vite produces a fast static build with no Node.js
server required on the VPS for the frontend. One less process to manage.
**Consequences**: No SSR, no API routes in the frontend. Dashboard is purely a WebSocket consumer.

---

## ADR-002 — Node.js + Express for hub, not Python FastAPI
**Date**: 2026-03-26
**Decision**: Node.js with Express and Socket.io for the central hub.
**Alternatives**: Python FastAPI + python-socketio, Go + Gorilla WebSocket
**Rationale**: Socket.io has the strongest ecosystem in Node.js. The hub's primary job is:
receive JSON heartbeats, compute state, push WebSocket events, and send alerts. This is exactly
what Node.js excels at (I/O bound, event-driven). Python FastAPI is excellent for ML/data APIs
but adds unnecessary weight here. Go would be fast but adds build complexity.
**Consequences**: TypeScript on both hub and dashboard for consistent types.

---

## ADR-003 — Python for local agent, not Node.js or PowerShell
**Date**: 2026-03-26
**Decision**: Python 3.11 for the local monitoring agent.
**Alternatives**: Node.js agent, PowerShell scripts, Go binary
**Rationale**: Python has the best-supported libraries for the specific tasks needed on Windows:
`psutil` for process enumeration, `pywin32` for window handle inspection, `Pillow` for image
compression, and `PyInstaller` for creating a standalone .exe with no runtime dependency.
The existing diagnostic scripts are in PowerShell, but PowerShell cannot be cleanly bundled
as a standalone service executable. Node.js could work but PyInstaller's .exe packaging is
more mature and battle-tested on Windows.
**Consequences**: PyInstaller bundles all Python deps into a single .exe. No Python install
needed on playout PCs. Binary is ~30-50MB.

---

## ADR-004 — SQLite from day one, not in-memory only
**Date**: 2026-03-26
**Decision**: Use `better-sqlite3` as the state store from the first hub commit.
**Alternatives**: Pure in-memory map, Redis, PostgreSQL
**Rationale**: Pure in-memory state would wipe alert dedup context, recovery history, and
last-known instance state on every hub restart. This means: hub restarts (deploys, crashes)
could trigger duplicate OFF AIR alerts. SQLite adds no operational overhead (single file,
no server process) and solves this correctly. PostgreSQL is overkill for 7 instances.
Redis requires an additional process. SQLite is the right MVP choice.
**Consequences**: SQLite file at `packages/hub/data/clarix.db`. Must be backed up before VPS deploys.

---

## ADR-005 — Caddy as reverse proxy, not nginx
**Date**: 2026-03-26
**Decision**: Caddy 2.x as the reverse proxy and TLS provider on the VPS.
**Alternatives**: nginx + certbot, Traefik, HAProxy
**Rationale**: Caddy automatically provisions and renews TLS certificates via Let's Encrypt with
zero configuration — just point a domain to the VPS, write a 5-line Caddyfile, and HTTPS is live.
nginx requires certbot installation, cron jobs for renewal, and separate SSL configuration.
For a small monitoring deployment, Caddy eliminates an entire class of operational risk (expired certs).
**Consequences**: Caddyfile is the sole proxy config. No certbot, no renewal scripts.

---

## ADR-006 — UDP probing is agent-side only
**Date**: 2026-03-26
**Decision**: All UDP stream probing (ffprobe/ffmpeg) runs on the playout PC agent, never on the hub VPS.
**Alternatives**: Hub runs ffprobe directly against encoder IP, dedicated probe service on hub
**Rationale**: Encoder streams (NY Backup, Digicel) are on private LAN segments behind NAT.
The hub (VPS) cannot reach private LAN IPs. Attempting hub-side probing would silently fail
and report false output_loss. Agent-side probing uses the agent's local network where encoders
are directly reachable. The agent sends the probe result and thumbnail as part of the heartbeat.
**Consequences**: Hub never runs ffmpeg/ffprobe. UDP stream URLs live in agent config.yaml only,
never in hub env. This also means: if the agent goes offline, UDP confidence is unknown (not false).

---

## ADR-007 — Identity by agent_id + token, not by IP address
**Date**: 2026-03-26
**Decision**: Agents are identified by `agent_id` field + Bearer token. Source IP is ignored for identity.
**Alternatives**: IP allowlist, VPN, per-instance token
**Rationale**: NY Main and NY Backup may share a public IP (both behind same NAT). Some sites
have dynamic IPs. IP-based identity would break under NAT and would require port forwarding,
which introduces security risk and operational complexity. Token-based identity (one per PC)
is simple, routable through NAT, requires only outbound HTTPS from agent, and is rotatable
without redeploying the binary.
**Consequences**: Hub maintains `agentId → [allowedInstanceIds]` map. Source IP logged for
diagnostics only. No port forwarding required on any site.

---

## ADR-008 — One agent per PC, multi-instance config array
**Date**: 2026-03-26
**Decision**: One agent process per physical PC. config.yaml uses an `instances: []` array.
**Alternatives**: One agent per playout instance (7 separate processes), one global agent
**Rationale**: NY Main runs 3 playout instances (insta-1, insta-2, admax-1). Running 3 separate
agent processes would triple the service management overhead. One agent per PC is operationally
simpler: one NSSM service, one config file, one token. The agent loops over instances each poll.
**Consequences**: One heartbeat POST per instance per poll. If the agent crashes, all instances
on that PC go gray simultaneously (correct — they share the same reporting path).

---

## ADR-009 — Three separate health domains in state model
**Date**: 2026-03-26
**Decision**: Emit broadcast_health, runtime_health, and connectivity_health as three independent
fields. Never mix them into a single status value.
**Alternatives**: Single status enum, two-domain model (broadcast + connectivity)
**Rationale**: The core operational requirement is: internet loss must not trigger an OFF AIR alert.
A single status field conflates playout failure with network failure. Three domains allow the
dashboard and alert engine to make correct decisions: connectivity=offline + broadcast=unknown
means "we can't see it" (NETWORK ISSUE), not "it's off-air" (OFF AIR). Runtime_health carries
the sub-state of the playout process (paused, stalled, etc.) without polluting broadcast_health.
**Consequences**: Dashboard derives colour from combination of all three. Alert severity is
determined by broadcast_health primarily, with connectivity_health for NETWORK ISSUE alerts.

---

## ADR-010 — RackNerd 2.5GB over 1GB for VPS
**Date**: 2026-03-26
**Decision**: Use the 2.5GB ($18.66/yr) plan, not the 1GB ($10.60/yr) plan.
**Alternatives**: 1GB plan, Hetzner CX11, DigitalOcean Basic $4/mo
**Rationale**: The hub runs Node.js (~250MB), Caddy (~20MB), and SQLite. No ffmpeg on hub.
1GB would be sufficient for the hub alone, but leaves no headroom for OS, PM2, and future growth.
At $18.66/yr ($1.55/mo), the 2.5GB plan is a trivial cost difference with meaningful headroom.
RackNerd was chosen over Hetzner/DO because the user already had the pricing page open and
the NY/Atlanta datacenter locations align with the monitoring target geography.
**Consequences**: 2 vCPU, 2.5GB RAM, 45GB SSD, 3000GB transfer/month. Sufficient for indefinite
scaling of this system.

---

## ADR-011 — Cloudflare proxied with Full (strict) SSL
**Date**: 2026-03-26
**Decision**: Route pulse.clarixtech.com through Cloudflare proxy (orange cloud), SSL mode Full (strict).
**Alternatives**: DNS only (gray cloud, no Cloudflare proxy), Let's Encrypt only via Caddy
**Rationale**: Proxied mode gives DDoS protection, hides VPS IP, and provides Cloudflare's
WebSocket support. Full (strict) means Cloudflare validates Caddy's origin certificate —
end-to-end encryption. WebSockets (Socket.io) work natively through Cloudflare on proxied subdomains.
**Consequences**: Caddy must have a valid origin certificate (handled automatically by Caddy's
Let's Encrypt ACME). Cloudflare's 100s HTTP timeout does not affect WebSocket connections.
