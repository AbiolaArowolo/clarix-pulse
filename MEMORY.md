# PROJECT MEMORY
> Project: Clarix Pulse (clarix-pulse)
> Last Updated: 2026-09-02T09:30:00Z
> Session Count: 1

---

## 🧠 Project Identity
- **Name**: Pulse (Clarix Pulse)
- **Purpose**: Operational monitoring for broadcast/playout environments — Windows node agent
  (machine-specific signals) → Node/Express hub (multi-tenant control plane) → React dashboard
  (live operator view). At least one real paying customer live (support@caspenmedia.com).
- **Stack**: Agent = Python 3.11 + PyInstaller + psutil + pywin32. Hub = Node 20 + TypeScript +
  Express + Socket.IO + PostgreSQL + PM2. Dashboard = React + TypeScript + Vite + Tailwind + PWA.
  See `docs/TECH_STACK.md`.
- **Owner**: Abiola (ClarixTech)
- **Repo**: AbiolaArowolo/clarix-pulse (GitHub)
- **Server/Infra**: single VPS (`192.3.76.144`, ~2.5GB RAM/3 vCPU) behind Caddy, domains
  `pulse.clarixtech.com` (dashboard/API) and `agent.clarixtech.com` (agent traffic only, added to
  dodge Cloudflare bot-scoring — undocumented in docs/). DNS for `clarixtech.com` is on
  Cloudflare (zone `b1f6c0f8b569b74b77b239934e0ba2ae`).
- **Auth**: identity is proven entirely by **Clerk** (production instance, `pk_live_`/`sk_live_`)
  as of 2026-09-01/02 — see ADR-013 in `docs/DECISIONS.md` and the ADRs below. Pulse's own
  Postgres tables remain authoritative for tenant/role/impersonation. Custom domain
  `clerk.clarixtech.com` (Frontend API) + `accounts.clarixtech.com` (Account Portal), both fully
  DNS-verified and SSL-issued as of this session — sign-in is confirmed working end-to-end
  (Google OAuth + email/password widget renders and functions on `pulse.clarixtech.com`).

---

## 📍 Current State
- **Active Sprint / Phase**: Post-audit remediation + ad-hoc feature work. A *separate local
  Claude Code session* did major work in parallel with this cloud session — merged PR #3 (VPS
  SSH-key bootstrap workflow), #4 (full Clerk auth migration + teammate invites), #5 (role fix)
  directly to `master` without this session's awareness. Always check `git log origin/master`
  at the start of a new session — this repo has had more than one active Claude session on it.
- **Last Completed Milestone**: Login is fully working again. Root cause chain: the Clerk
  migration (PR #4) configured a custom domain (`clerk.clarixtech.com`) whose DNS records were
  never created, so the Clerk sign-in widget silently rendered blank for every visitor. This
  session diagnosed it (decoded the Frontend API host from the `pk_live_` key, confirmed via
  DNS lookup), created all 5 required CNAME records in Cloudflare via API
  (`clerk`/`accounts`/`clkmail`/`clk._domainkey`/`clk2._domainkey`.clarixtech.com), worked
  through a Cloudflare "Error 1000" red herring (tried proxying, reverted — not the fix), and
  waited out Clerk's own certificate issuance. Confirmed working via screenshot: sign-in widget
  renders with Google OAuth + email, "Secured by Clerk".
- **Also completed this session**: full audit (3-agent), opt-in login-bypass (superseded by
  Clerk — bypass code still exists in `serverAuth.ts` and now bypasses Clerk instead of the old
  cookie check, per its own code comments, but is off by default), GitHub Actions VPS deploy
  workflow replacing the leaky local-only `deploy/deploy.py`, and a full sweep (PR #6) removing
  every remaining password/access-key DB column, dead code, and doc reference left over from
  the Clerk migration.
- **Next Priority**: nothing blocking. Optional follow-ups the user has raised but not
  committed to: (1) restyle the login page further / walk through enabling more social
  providers (LinkedIn, Apple) — needs real OAuth app credentials from each provider's own
  developer console, only the user can create those; (2) an Instagram reel
  (instagram.com/reel/DcW5UU5SUaB) mentioned early in the session, never described — likely
  abandoned/superseded by everything since, don't resurrect unprompted.
- **Blockers**: none currently open. `accounts.clarixtech.com` (Clerk's hosted Account Portal,
  distinct from the embedded sign-in widget) may still be finishing SSL issuance — not
  confirmed working, but does not block sign-in itself.

---

## 🏗️ Architecture Decisions (ADRs)
| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 1 | Login bypass implemented as opt-in env-flag (`PULSE_DISABLE_LOGIN` + `PULSE_DISABLE_LOGIN_EMAIL`), defaulting OFF everywhere including prod | Product is fully multi-tenant — no coherent "logged out but see data" state without picking whose data to show; flag avoids silently exposing the live customer's data | 2026-08-31 |
| 2 | Standing rule: prefer event subscriptions over polling for status checks | User directive — avoid wasted/noisy check-ins when a real event source exists | 2026-08-31 |
| 3 | Standing rule: implement requested changes as direct replacements, not fallback/dual-path/feature-flagged versions, unless a flag is explicitly requested | User directive | 2026-08-31 |
| 4 | Auth replaced wholesale with Clerk (by a separate local session, not this one) | See ADR-013 in docs/DECISIONS.md — recorded here so this session's memory matches the repo's own decision record | 2026-09-01 |
| 5 | Missing Clerk custom-domain DNS fixed by creating records directly via Cloudflare API from this session (not asking the user to click through Cloudflare's UI) | User explicitly authorized "route 1" (the real fix) and supplied Cloudflare/Clerk API credentials via an uploaded env file | 2026-09-02 |
| 6 | Did NOT rotate the VPS root password despite it being flagged as leaked in the original audit | User explicitly said "do not rotate vps password" twice — respect this, do not re-raise it as a blocker unless asked | 2026-09-02 |

**Note**: ADR #1 was built *before* rules #2/#3 were stated. It is the kind of flag-based
implementation rule #3 says to avoid going forward — user has not asked for it to be redone: flag
this for the user next time it comes up rather than assuming. It is also now largely moot since
Clerk (ADR #4) owns identity entirely — the bypass still exists and still works (it bypasses
Clerk resolution the same way it bypassed the old cookie check) but there is no more "old login"
for it to be an alternative to.

---

## ✅ Completed Work
- [2026-08-31] — Full engineering/infra/docs audit via 3 parallel research agents; published as
  Artifact "Pulse Engineering Audit" (https://claude.ai/code/artifact/1f6bcd87-ed6f-47e7-9fc3-4b9bb27cf335).
- [2026-08-31] — Opt-in login bypass (`PULSE_DISABLE_LOGIN` / `PULSE_DISABLE_LOGIN_EMAIL`) added
  to `packages/hub/src/serverAuth.ts` + `store/auth.ts`; PR #2 merged to master.
- [2026-09-01] — GitHub Actions VPS deploy workflow (`.github/workflows/deploy.yml`) added,
  replacing `deploy/deploy.py` (deleted — it had the VPS root password hardcoded in plaintext).
  `scripts/vps_clean_redeploy.py` now reads credentials from env vars first, env-file fallback.
- [2026-09-01/02] — *(separate local session, not this one)* PR #3 SSH-key bootstrap workflow,
  PR #4 full Clerk auth migration (removed password/access-key auth, added teammate invites),
  PR #5 role fix — all merged to master.
- [2026-09-02] — PR #6: swept every leftover password/access-key DB column
  (`tenants.access_key_*`, `password_reset_tokens` table) and stale doc reference (8 docs
  rewritten, ADR-013 added to docs/DECISIONS.md) left over from the Clerk migration.
- [2026-09-02] — Diagnosed and fixed the actual login outage: created 5 missing CNAME records
  for Clerk's custom domain directly via Cloudflare API, confirmed DNS-verified and
  SSL-issued in Clerk's dashboard, confirmed the sign-in widget renders and works via user
  screenshot.

---

## 🔧 Key Configs & Credentials (references only — no secrets)
- **DB**: `PULSE_DATABASE_URL` — see `.env.example`
- **VPS**: `192.3.76.144`, root SSH — credentials belong in `.env.local` only (gitignored).
  `deploy/deploy.py` (which had it hardcoded) is deleted; GitHub Actions secrets now hold it.
- **Clerk**: `CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY` (hub, root `.env.local`),
  `VITE_CLERK_PUBLISHABLE_KEY` (dashboard build, `packages/dashboard/.env.local`) — same
  `pk_live_`/`sk_live_` pair, also stored as GitHub Actions secrets for CI deploy.
- **Cloudflare**: DNS for `clarixtech.com` zone `b1f6c0f8b569b74b77b239934e0ba2ae`. A scoped
  `Zone:DNS:Edit`-only API token was used this session to create the Clerk custom-domain CNAME
  records — prefer that scoped token over the account's Global API Key or full login
  credentials for any future DNS change.
- **⚠️ Known leaked secrets (rotation status)**:
  - Production VPS root password hardcoded in `deploy/deploy.py:25` (file now deleted, but
    still recoverable from git history) — user explicitly said **do not rotate** (2026-09-02),
    twice. Do not re-raise this as a blocker.
  - A personal password committed in plaintext in `PROJECT-SESSION-LOG.md:89` — not yet
    addressed, not yet raised again after the original audit flagged it.
  - **2026-09-02: user uploaded a "universal.env" file (X:\universal.env on their PC) into this
    session containing dozens of live credentials for systems entirely unrelated to Pulse** —
    AWS root credentials, a live broadcast facility's full network gear (routers/switches/NAS/
    WiFi), other VPS fleets, personal Gmail, Tailscale, RustDesk, home network. Only the
    Cloudflare + Clerk entries from it were used, deliberately scoped to this task. That file
    is a real, broad exposure sitting in this session's uploads directory
    (`/root/.claude/uploads/.../a4934335-universal.env`) — flagged to the user, not deleted
    unilaterally. A future session should not assume it's safe to use other entries from it
    without the user separately authorizing that specific system.
- **Login bypass vars**: `PULSE_DISABLE_LOGIN`, `PULSE_DISABLE_LOGIN_EMAIL` — see `.env.example`,
  both unset/off by default. Now bypasses Clerk resolution specifically (see ADR #4 above).
- **Ports**: hub `HUB_PORT=3001`; agent local setup UI `127.0.0.1:3210`

---

## 👥 People & Roles
| Name | Role | Contact |
|------|------|---------|
| Abiola | Owner / platform admin | abayo83@gmail.com |
| Caspen Media (support@caspenmedia.com) | Live customer, manually enabled tenant | — |

---

## 🐛 Open Issues / Tech Debt
- [x] ~~`rotateAccessKeyForTenant` hashes with the wrong function~~ — MOOT, access-key auth removed entirely by the Clerk migration (PR #4) and its remnants scrubbed (PR #6).
- [x] ~~Docs vs. session log contradict on account activation~~ — MOOT, same reason; docs rewritten to describe Clerk (PR #6, ADR-013).
- [ ] Production VPS root password committed in `deploy/deploy.py:25` (file deleted, password still in git history) — user says do not rotate, so this stays open indefinitely by their choice, not an oversight
- [ ] Personal password committed in `PROJECT-SESSION-LOG.md:89` — HIGH, unaddressed
- [ ] **Broad credential file exposure** — see Key Configs above (`universal.env` upload) — HIGH, needs the user's own judgment call, not something to act on unilaterally
- [ ] No global Express error handler / `unhandledRejection` net in the hub — one DB hiccup can crash the process for every tenant — HIGH, still unaddressed
- [ ] Now that a real CI deploy workflow exists (`.github/workflows/deploy.yml`), it only runs the deploy step — no lint/typecheck/test gate before deploying. Worth adding but not yet requested.
- [ ] `accounts.clarixtech.com` (Clerk Account Portal) not independently confirmed working — only the embedded sign-in widget (`clerk.clarixtech.com`) is confirmed
- Full original findings list: see the published audit artifact (link in Completed Work above) — treat as partially stale now given the Clerk migration.

---

## 📝 Session Handoff Notes
> Last session ended: 2026-09-02, login fully working, no open blockers
> What was in progress: a multi-hour live-outage debug — user couldn't sign in to
> pulse.clarixtech.com. Root cause: a separate local Claude session's Clerk migration (PR #4)
> configured a custom auth domain but never created its DNS. Fixed by this session directly via
> Cloudflare + Clerk APIs (see Current State and ADR #5 above). Confirmed working via user
> screenshot: sign-in widget renders (Google OAuth + email/password), "Secured by Clerk".
> Resume from: no active task. If the user returns, check `git log origin/master` first — this
> repo gets edited by more than one Claude session, sometimes without this session's knowledge
> (that's exactly how the Clerk migration and its DNS gap happened unannounced).
> Watch out for:
> - This project holds a real paying customer's data — treat any auth/access change as
>   production-risk, not a toy change, even when told to implement directly.
> - Do NOT rotate the VPS root password — user has explicitly declined twice.
> - The `universal.env` credential file (see Key Configs) may still be referenced/re-uploaded by
>   the user in future turns — use only what's relevant to the task at hand, flag the exposure,
>   don't go exploring the rest of it.
> - This session ran entirely from a sandboxed cloud container with no access to the user's
>   local PC, "drive X", or Obsidian vault, despite the user repeatedly believing otherwise —
>   correct this plainly and immediately if it comes up again rather than re-litigating it.

---

## 🗂️ Decision Log
| Date | Topic | Decision Made | Alternatives Rejected |
|------|-------|---------------|----------------------|
| 2026-08-31 | Login requirement | Built as an opt-in, off-by-default bypass flag rather than removing login outright | Removing login entirely by default — rejected at the time due to production/multi-tenant data exposure risk; may be revisited under the new no-fallback rule |
| 2026-08-31 | Status-check style | Event subscriptions preferred over scheduled polling, always | Scheduled `send_later` check-ins as primary mechanism — now secondary/fallback only |
| 2026-09-02 | Missing Clerk DNS records | Created directly via Cloudflare API using a scoped `Zone:DNS:Edit` token supplied by the user | Asking the user to click through Cloudflare's UI manually — rejected, user asked for the API route ("route 1") once given credentials |
| 2026-09-02 | "Fast unblock" Clerk key swap (proposed earlier in session) | Abandoned — Clerk production instances (`pk_live_`/`sk_live_`) have no fallback default domain, unlike dev instances; this option never actually existed | Was incorrectly offered as Route 2 before verifying against Clerk's own docs — corrected once checked |
| 2026-09-02 | VPS root password rotation | Declined per explicit user instruction, despite being the audit's top security finding | Rotating it (the technically "correct" fix) — overridden by direct user decision, twice |
