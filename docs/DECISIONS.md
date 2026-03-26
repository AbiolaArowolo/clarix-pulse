# Pulse — Architecture Decision Records

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

---

## ADR-012 — Identity by node_id + player_id, with optional UDP per player
**Date**: 2026-03-26
**Decision**: Use `node_id` as the canonical identifier for each physical playout PC and `player_id`
for each playout source running on that node. UDP monitoring is optional per player, and one node
may carry multiple UDP inputs across one or more players.
**Alternatives**: Keep `agent_id` + `instanceId`, make UDP a node-wide switch, or limit each node to
one UDP input.
**Rationale**: The new product direction needs player-level routing, alerting, and dashboard grouping.
A single node can host several distinct players, and those players can have different software types,
log sources, and UDP states. Player-level identity keeps monitoring precise without losing the node
relationship.
**Consequences**: Docs, config examples, and deployment guidance should treat `node_id` and
`player_id` as the core identifiers. This supersedes the older agent/instance-only framing in
ADR-007 and ADR-008 for the purposes of the current product direction.

---

## Review Log

**2026-03-26 09:13 America/New_York**: Documentation review confirmed `docs/DECISIONS.md` is the correct
single source for timestamped accountability notes because it already serves as the project's decision
ledger. Future review findings and implementation choices should be appended here when they affect the
project record.

**2026-03-26 09:22 America/New_York**: Code review found three verified implementation gaps that change
the project's finishability assessment: deployment docs and `.env.example` direct operators to `.env.local`
while the hub runtime loads `.env`; the documented warning alert policy is not implemented in
`packages/hub/src/services/alerting.ts`; and persisted thumbnail state is not rehydrated into the dashboard
on load because `/api/status` omits image data and the `full_state` merge path does not apply thumbnail
payloads.

**2026-03-26 09:21 America/New_York**: Repository verification found the codebase is buildable but not
yet deployment-complete. `npm run build` passed for the hub and dashboard, and `python -m compileall
packages/agent` passed for the agent. Blocking gaps confirmed during review: the hub never calls
`initDb()` before `initState()`, runtime configuration is inconsistent between `.env` and `.env.local`,
alert dedup/recovery behavior does not match the documented guarantees, the Windows agent package in
repo is incomplete for deployment (`nssm.exe`, `ffmpeg.exe`, and `ffprobe.exe` are not bundled by the
current PyInstaller spec), and multi-instance monitoring is not fully instance-scoped in the current
process/log monitors. Finishing the code/doc hardening is feasible from this workspace; full production
cutover still requires Cloudflare access, real alerting credentials, and access to the four playout PCs.

**2026-03-26 09:27 America/New_York**: Implemented three repo-side hardening fixes after verification:
the hub now initializes the SQLite schema before state seeding on first boot; the runtime now supports
both `.env` and `.env.local` consistently, with `.env.local` overriding `.env`; and persisted thumbnail
data is rehydrated back into the dashboard on reload through `/api/status` and the dashboard merge path.
Documentation was updated to match the runtime contract and to clarify that Windows agent bundles still
require staged external binaries (`nssm.exe`, and `ffmpeg.exe`/`ffprobe.exe` for UDP-enabled sites).

**2026-03-26 09:33:06 America/New_York**: Verification confirmed the hardening pass works as intended:
`npm run build` passed for the hub and dashboard, `python -m compileall packages/agent` passed, and a
clean-start smoke test from an isolated hub copy completed with `init_ok` and `state_count=7`.

**2026-03-26 09:48:57 America/New_York**: Documentation was updated to reflect the new product
direction: `node_id` and `player_id` are the primary identifiers, UDP monitoring is optional per
player, and a single node may carry multiple UDP inputs across its players. This note records the
doc-level decision so the README and supporting docs remain aligned with the intended monitoring
model.

**2026-03-26 09:59:57 America/New_York**: Requirement and runtime contract were tightened for the
agent rollout: each node is keyed by `node_id`, each playout source is keyed by `player_id`, UDP
monitoring is switchable per player, and a node may carry 2-5 UDP inputs across one or more
players. The agent runtime was updated to preserve per-player selector blocks for same-type
multi-instance PCs and to emit `udp_enabled`, `udp_input_count`, `udp_healthy_input_count`, and
`udp_selected_input_id` so the hub and dashboard can treat enabled UDP inputs as a player-level
monitoring matrix with clear accountability.

**2026-03-26 10:06:50 America/New_York**: Verification completed after the node/player identity and
UDP matrix wiring pass. `npm run build` succeeded for the hub and dashboard, and
`python -m compileall packages/agent` succeeded for the updated agent runtime, including the new
selector-preserving config loader and UDP matrix heartbeat fields.

**2026-03-26 10:25:27 America/New_York**: Node deployment moved to a one-click bundle model. The
agent package now includes a bundle builder, an install flow that copies itself into
`%ProgramData%\ClarixPulse\Agent`, a post-install `configure.bat` helper, and explicit support for
LAN-local hub URLs as well as remote hub URLs. This keeps each node configurable after install,
lets UDP remain optional per player, and makes internet necessary only when the hub is remote or
when Telegram/email alerts must leave the local network.

**2026-03-26 11:06:45 America/New_York**: Product branding and operator-facing contact details were
normalized across the repo. The product name is now `Pulse`, operator support email defaults now
point to `support@clarixtech.com`, and older clarixtech / Caspan wording was removed from the
current docs and UI where it would confuse deployment or ownership.

**2026-03-26 11:06:45 America/New_York**: Mobile monitoring direction was extended beyond a desktop
browser tab. The dashboard now targets an installable PWA flow with a persistent QR install bar for
phone onboarding, and the mobile alarm path now includes browser vibration support in addition to
the existing Web Audio alarm. This keeps phone-based operators viable even when they are not seated
at a workstation.

**2026-03-26 11:06:45 America/New_York**: Admax path handling was changed from version-specific root
strings to layout discovery by candidate roots and marker folders. This allows the same node config
to survive expected install differences such as `Admax One 2.0`, `Admax One2.0`, or later vendor
variants, while still resolving the real playout, FNF, and playlistscan directories on the local
machine.

**2026-03-26 11:06:45 America/New_York**: Node bundle packaging was hardened so each bundle can
carry `nssm.exe`, `ffmpeg.exe`, and `ffprobe.exe` together with the agent and scripts. The intent
is that operators can install once, then turn UDP inputs on or off later from `configure.bat`
without needing a second dependency install on the node.

**2026-03-26 11:34:58 America/New_York**: NJ Optimum was elevated and installed locally as the
persistent Windows service `ClarixPulseAgent` from `%ProgramData%\ClarixPulse\Agent` on the
Optimum PC. Post-install verification confirmed the service is `RUNNING`, startup is `AUTO_START`,
the live hub is receiving heartbeats from `nj-optimum-pc`, and the temporary direct-run test agent
from the release folder was removed so only the service-owned runtime remains active.

**2026-03-26 11:56:50 America/New_York**: Runtime alerting was adjusted to better match live
operations on the Optimum Insta node. NJ Optimum is now treated as `nj-optimum-insta-1` instead of
Admax, Insta `runningstatus.txt` is treated as the durable runtime source when available, and the
log tailer now starts from the current end-of-file so historical `Paused` lines do not replay as
fresh alarms after an agent restart. For local-runtime-only incidents without UDP confirmation,
Pulse now shows `paused` / `stopped` immediately but waits about 45 seconds of continuous runtime
failure before escalating to red OFF AIR, and it clears the red alarm automatically on the next
healthy heartbeat after playback resumes.

**2026-03-26 12:02:59 America/New_York**: Insta runtime health is now allowed to overrule the
missing-window warning on service-installed nodes. On the Optimum PC, the Windows service can see
the real process but not a trustworthy interactive window handle, so Pulse now keeps the card
healthy when `runningstatus.txt` says Insta is healthy instead of holding the site in a permanent
yellow degraded state.

**2026-03-26 12:13:36 America/New_York**: UDP setup was hardened for node operators. Pulse now
accepts the common multicast convenience form `udp@://224.2.2.2:5004` and normalizes it to the
ffmpeg-friendly listen form `udp://@224.2.2.2:5004`, while still accepting plain `udp://...`
inputs. The node `configure.bat` helper now prints valid UDP examples and runs
`clarix-agent.exe --validate-config` before offering a service restart so enabled UDP inputs with
missing URLs or missing ffmpeg/ffprobe binaries are caught immediately.

**2026-03-26 12:19:08 America/New_York**: Dashboard live updates were made resilient to transport
problems so operators do not need to refresh the page to see heartbeat-driven state changes. The
browser client now prefers Socket.IO polling before websocket upgrade, falls back to `/api/status`
refreshes every 5 seconds, refreshes the on-card "Last heartbeat" age automatically, and treats
network-offline/stale cards as yellow warning states instead of gray so `stopped` remains red,
`paused` remains yellow, and connectivity loss is clearly shown as a warning rather than a dead
card.

**2026-03-26 12:23:18 America/New_York**: The mobile/PWA connection banner was tightened so it does
not show `Disconnected` just because one Socket.IO transport path misbehaves while the app can still
reach the hub. Successful `/api/status` refreshes now count as an active connection for the top-bar
indicator, and the PWA now auto-applies updated service workers so phones are less likely to remain
stuck on stale dashboard code after deployment.

**2026-03-26 12:28:42 America/New_York**: The runtime color/alarm rules were realigned with live
operations on the Insta reference node. A fresh Insta `Paused` log token now wins immediately even
when `runningstatus.txt` looks stale, `paused` stays a yellow degraded state instead of escalating
to red on a timer, and `stopped` now raises red/off-air immediately so a real playout stop is not
hidden behind a grace window. The Optimum reference config was also tightened to a 5-second poll
interval so heartbeat-driven updates feel closer to real time while the Insta package is being
finished.
