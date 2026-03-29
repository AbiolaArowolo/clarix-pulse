# Clarix Pulse - Product Requirements Summary

**Document Date**: `2026-03-29 -04:00`

## Problem

Operations teams need to monitor multiple nodes, workflows, or monitored sources without mixing:

- one customer's estate with another customer's estate
- local setup problems with actual live incidents
- onboarding friction with normal operations

Clarix Pulse solves this with:

- a Windows monitoring agent
- a tenant-aware hub
- a login-gated dashboard
- admin-controlled account activation
- 365-day access keys
- tenant-scoped alerting

---

## Current Product Goals

- public landing page instead of exposing the monitoring board to everyone
- registration and login with email and password
- access-key gated sign-in with admin enable or disable control
- one private hub per customer account
- empty-by-default dashboard for new accounts
- registration email becomes the default alert email
- local node discovery and remote provisioning as the main onboarding path
- one default Clarix Pulse installer bundle for all nodes

---

## Active Scope

### Shipped in code

- tenant-aware users, sessions, and alert settings
- landing page, registration page, login page
- authenticated monitoring dashboard under `/app`
- platform admin page under `/app/admin`
- tenant-scoped `/api/status`
- tenant-scoped Socket.IO updates
- tenant-scoped remote provisioning
- tenant-scoped alert contacts
- authenticated installer downloads under `/api/downloads`
- local discovery report import
- provisioned `config.yaml` import/pull in the local UI
- one default `clarix-pulse` bundle path

### Intentionally unchanged

- existing off-air health logic
- current pause / stop / shutdown alert semantics

---

## Ownership Requirements

### Node-owned

- player paths
- player count
- playout profile
- process selectors
- log selectors
- UDP inputs

### Hub-owned

- tenant identity
- sessions
- inventory
- agent tokens
- monitoring enabled / disabled
- maintenance mode
- alert routing
- mirrored config storage

---

## Installation Requirements

- install should stay close to one-click on Windows
- elevation should only be required for the final service-install phase
- setup should work from the same generic bundle everywhere
- the dashboard should provision tenant-specific config instead of relying on prepared site bundles

---

## Key Product Rules

- users should not land directly on the old shared monitoring interface
- a new account should not see any nodes until their own node is onboarded
- new accounts must stay disabled until enabled by a platform admin
- installer downloads must not be public to unsigned users
- the registration email must be the default alert email until changed
- local discovery should work best while the player is running
- tenant isolation must apply to both API responses and realtime updates

---

## Documentation Requirement

Major product changes must leave behind:

- updated install guide
- updated deployment guide
- updated architecture summary
- updated onboarding guide
- updated release notes
