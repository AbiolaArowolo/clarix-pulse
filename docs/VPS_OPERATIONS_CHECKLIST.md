# Clarix Pulse - VPS Operations Checklist

**Document Date**: `2026-03-29 -04:00`

## Purpose

This checklist is the recommended operating baseline for the current Clarix Pulse deployment shape:

- one VPS
- one hub process
- one PostgreSQL instance
- one dashboard build
- no Redis
- no queue
- target size around 15 tenants with roughly 5 nodes each

That means the goal is not horizontal scale yet. The goal is to keep the current system stable, observable, and easy to recover.

---

## Current Assumption

This checklist assumes:

- VPS size is about `2.5 GB RAM` and `3 vCPU`
- hub runs under PM2
- PostgreSQL runs on the same VPS
- reverse proxy serves the dashboard and forwards `/api/*` and `/socket.io/*`
- agent polling should stay conservative to avoid unnecessary VPS load

Recommended agent poll interval:

- default: `10` seconds
- acceptable range for most nodes: `10-15` seconds
- avoid dropping below `5` seconds unless there is a proven operational need

---

## Healthy Targets

Use these as practical guardrails:

- CPU should usually stay below `70-80%` sustained load
- RAM should usually stay below `80-85%`
- disk usage should stay below `80%`
- `/api/health` should return `200`
- PostgreSQL should respond quickly and consistently
- PM2 should show the hub as online with stable restarts
- alerting failures should not keep growing unnoticed
- new nodes should not flap between online and offline during normal short network blips

---

## Daily Checks

Run these once a day or after any deploy:

```bash
curl -s http://localhost:3001/api/health
curl -s http://localhost:3001/api/version
pm2 status --no-color
pm2 logs clarix-hub --lines 100 --nostream
free -m
df -h
```

What to confirm:

- `/api/health` reports `ok: true`
- database check is healthy
- thumbnail store check is healthy
- alerting does not show repeated consecutive failures
- memory usage is not climbing abnormally
- disk still has room for logs, thumbnails, and backups

---

## Weekly Checks

Do these at least once a week:

- confirm the latest PostgreSQL backup exists and is not zero bytes
- keep at least 7 daily backups and at least 2 weekly backups
- check PM2 restart count for unexpected growth
- review hub logs for repeated `401`, `403`, `502`, DB errors, or alert delivery failures
- review disk growth from thumbnails and logs
- confirm the public app, login flow, and one tenant dashboard still work end to end

---

## Backup Baseline

At minimum, back up PostgreSQL daily.

Example:

```bash
mkdir -p /var/backups/clarix-pulse
pg_dump "$PULSE_DATABASE_URL" > /var/backups/clarix-pulse/clarix_pulse-$(date +%F).sql
```

Keep backups outside the live app directory if possible.

If you can only do one backup improvement right now, do this:

- automate nightly Postgres dumps
- copy them off the VPS when possible

---

## Log And Disk Hygiene

Watch these paths closely:

- hub logs from PM2
- PostgreSQL logs
- thumbnail storage directory
- deployment archives and old release folders

If disk pressure grows:

- remove obsolete deployment archives
- rotate and compress old logs
- review thumbnail retention
- verify backups are not accumulating indefinitely on the same disk

---

## When To Act Immediately

Take action the same day if any of these happen:

- `/api/health` returns `503`
- the hub process is restarting repeatedly
- memory stays above `85%`
- disk free space falls below `20%`
- many nodes suddenly switch to stale or offline together
- alert delivery failures keep increasing
- dashboard updates lag by several seconds

---

## First Response Playbook

If `/api/health` is unhealthy:

- check PM2 status
- check hub logs
- check PostgreSQL availability
- check free memory and disk

If many nodes show offline at once:

- confirm the hub is healthy first
- then check reverse proxy, DNS, TLS, or upstream network reachability
- then inspect one affected agent log for heartbeat errors

If alerts stop arriving:

- inspect `/api/health`
- check SMTP credentials and provider status
- check Telegram token/chat configuration
- look for recent alert delivery failures in hub logs

If the VPS feels overloaded:

- reduce agent polling aggressiveness before redesigning the architecture
- keep thumbnails conservative
- restart the hub during a controlled window only if needed
- plan a VPS size upgrade before adding more moving parts

---

## Scale Decision Rule

For the current target, do this first:

1. keep the architecture simple
2. harden monitoring and backups
3. tune polling and thumbnail frequency
4. upgrade the VPS if capacity becomes tight

Only revisit architecture changes after those steps stop being enough.

For this deployment size, a bigger VPS is the next move before Redis, queues, or multiple hub servers.

---

## Related Docs

- deployment: [DEPLOYMENT.md](/D:/monitoring/docs/DEPLOYMENT.md)
- architecture: [ARCHITECTURE.md](/D:/monitoring/docs/ARCHITECTURE.md)
- tech stack: [TECH_STACK.md](/D:/monitoring/docs/TECH_STACK.md)
- artifact layout: [VPS_ARTIFACT_LAYOUT.md](/D:/monitoring/docs/VPS_ARTIFACT_LAYOUT.md)
