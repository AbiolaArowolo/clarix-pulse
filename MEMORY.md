# PROJECT MEMORY
> Project: Clarix Pulse (clarix-pulse)
> Last Updated: 2026-08-31T20:40:00Z
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
  dodge Cloudflare bot-scoring — undocumented in docs/).

---

## 📍 Current State
- **Active Sprint / Phase**: Post-audit remediation + ad-hoc feature work
- **Last Completed Milestone**: Full 3-agent deep audit of hub/dashboard code, agent/deploy
  infra, and documentation (2026-08-31). Report published as an Artifact. Opt-in login-bypass
  feature shipped as PR #2 (draft, open, mergeable, no CI configured in repo).
- **Next Priority**: waiting on user to describe the content of an Instagram reel
  (instagram.com/reel/DcW5UU5SUaB) they want implemented — could not be fetched/watched directly.
- **Blockers**:
  - Real credentials exposed in git history — see Open Issues below. Not yet remediated;
    user has not asked for this fix yet despite being flagged.

---

## 🏗️ Architecture Decisions (ADRs)
| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 1 | Login bypass implemented as opt-in env-flag (`PULSE_DISABLE_LOGIN` + `PULSE_DISABLE_LOGIN_EMAIL`), defaulting OFF everywhere including prod | Product is fully multi-tenant — no coherent "logged out but see data" state without picking whose data to show; flag avoids silently exposing the live customer's data | 2026-08-31 |
| 2 | Standing rule: prefer event subscriptions over polling for status checks | User directive — avoid wasted/noisy check-ins when a real event source exists | 2026-08-31 |
| 3 | Standing rule: implement requested changes as direct replacements, not fallback/dual-path/feature-flagged versions, unless a flag is explicitly requested | User directive | 2026-08-31 |

**Note**: ADR #1 was built *before* rules #2/#3 were stated. It is the kind of flag-based
implementation rule #3 says to avoid going forward — user has not asked for it to be redone: flag
this for the user next time it comes up rather than assuming.

---

## ✅ Completed Work
- [2026-08-31] — Full engineering/infra/docs audit via 3 parallel research agents; published as
  Artifact "Pulse Engineering Audit" (https://claude.ai/code/artifact/1f6bcd87-ed6f-47e7-9fc3-4b9bb27cf335).
- [2026-08-31] — Opt-in login bypass (`PULSE_DISABLE_LOGIN` / `PULSE_DISABLE_LOGIN_EMAIL`) added
  to `packages/hub/src/serverAuth.ts` + `store/auth.ts`; PR #2 opened as draft, subscribed to PR
  activity.

---

## 🔧 Key Configs & Credentials (references only — no secrets)
- **DB**: `PULSE_DATABASE_URL` — see `.env.example`
- **VPS**: `192.3.76.144`, root SSH — credentials belong in `.env.local` only (gitignored)
- **⚠️ Known leaked secrets (need rotation + git-history scrub)**:
  - Production VPS root password hardcoded in `deploy/deploy.py:25` (still live as of last audit)
  - A personal password committed in plaintext in `PROJECT-SESSION-LOG.md:89`
- **Login bypass vars**: `PULSE_DISABLE_LOGIN`, `PULSE_DISABLE_LOGIN_EMAIL` — see `.env.example`,
  both unset/off by default
- **Ports**: hub `HUB_PORT=3001`; agent local setup UI `127.0.0.1:3210`

---

## 👥 People & Roles
| Name | Role | Contact |
|------|------|---------|
| Abiola | Owner / platform admin | abayo83@gmail.com |
| Caspen Media (support@caspenmedia.com) | Live customer, manually enabled tenant | — |

---

## 🐛 Open Issues / Tech Debt
- [ ] Production VPS root password committed in `deploy/deploy.py:25` — HIGH — rotate + scrub git history
- [ ] Personal password committed in `PROJECT-SESSION-LOG.md:89` — HIGH — rotate + scrub git history
- [ ] `rotateAccessKeyForTenant` (`store/auth.ts:1015`) hashes with the wrong function — permanently locks out any tenant who uses "resend access key" — HIGH
- [ ] No global Express error handler / `unhandledRejection` net in the hub — one DB hiccup can crash the process for every tenant — HIGH
- [ ] Docs vs. session log contradict each other on whether new accounts need admin activation + access key to log in, or auto-enable — MED, likely tied to the access-key bug above
- [ ] No CI configured anywhere in the repo (no `.github/workflows`) despite real hub + agent test suites existing — MED
- Full findings list: see the published audit artifact linked above.

---

## 📝 Session Handoff Notes
> Last session ended: (in progress — this is session 1)
> What was in progress: waiting for the user to describe an Instagram reel
> (instagram.com/reel/DcW5UU5SUaB) so its content can be implemented; PR #2 (login bypass) open
> and subscribed for activity, no action needed unless a real event arrives.
> Resume from: ask/wait for the video description; once received, scope and implement per the
> two standing rules above (direct replacement, no flags unless asked).
> Watch out for: this project holds a real paying customer's data — treat any auth/access change
> as production-risk, not a toy change, even when told to implement directly.

---

## 🗂️ Decision Log
| Date | Topic | Decision Made | Alternatives Rejected |
|------|-------|---------------|----------------------|
| 2026-08-31 | Login requirement | Built as an opt-in, off-by-default bypass flag rather than removing login outright | Removing login entirely by default — rejected at the time due to production/multi-tenant data exposure risk; may be revisited under the new no-fallback rule |
| 2026-08-31 | Status-check style | Event subscriptions preferred over scheduled polling, always | Scheduled `send_later` check-ins as primary mechanism — now secondary/fallback only |
