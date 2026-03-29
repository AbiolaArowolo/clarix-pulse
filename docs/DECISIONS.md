# Clarix Pulse - Decision Record Summary

**Document Date**: `2026-03-29 -04:00`

## ADR-001 - Node.js / Express / Socket.IO remains the hub backend

**Decision**: keep the hub in Node.js + TypeScript with Express and Socket.IO.  
**Why**: it still fits heartbeat ingestion, state evaluation, browser APIs, and realtime tenant updates.

## ADR-002 - Python Windows agent remains the node runtime

**Decision**: keep the Windows agent in Python and package it into `clarix-agent.exe`.  
**Why**: it still fits Windows process, file, and service behavior well.

## ADR-003 - Local node config remains authoritative for machine-local settings

**Decision**: paths, players, selectors, and UDP inputs remain node-owned.  
**Why**: those settings are environment-specific and safest when edited on the machine that uses them.

## ADR-004 - The hub owns central operational state

**Decision**: inventory, tokens, alert routing, monitoring toggles, and maintenance remain hub-owned.  
**Why**: they are shared operational concerns, not machine-local runtime details.

## ADR-005 - Introduce tenant-aware auth for the browser experience

**Decision**: add tenants, users, sessions, and tenant-scoped browser APIs.  
**Why**: a login page without real tenant isolation would only hide the interface, not protect the data.

## ADR-006 - Registration email seeds the tenant's default alert email

**Decision**: use the registration email as the default alert recipient for a new tenant.  
**Why**: it creates a usable first-run alert target without extra setup, while still allowing later edits.

## ADR-007 - Browser writes are now session-authenticated, not gated by a shared write key

**Decision**: tenant dashboard actions are tied to the signed-in session.  
**Why**: a shared browser write key is the wrong primary access model for a login-based product.

## ADR-008 - Keep discovery + provisioned config as the preferred onboarding path

**Decision**: discovery report plus provisioned `config.yaml` is the main node setup flow.  
**Why**: it is more reliable than depending on enrollment key flow alone and better matches tenant provisioning.

## ADR-009 - One default Clarix Pulse bundle is the supported installer path

**Decision**: retire site-specific prepared bundles from the supported rollout path and keep `clarix-pulse` as the default release artifact.  
**Why**: the product should work everywhere from one bundle plus tenant-specific config.

## ADR-010 - Keep alert semantics stable during the auth/tenant shift

**Decision**: do not change off-air trigger behavior as part of the auth and dashboard overhaul.  
**Why**: platform and product-shape changes were already large enough without changing alert semantics too.

## ADR-011 - New customer accounts start disabled and use renewable access keys

**Decision**: registration creates a disabled tenant, generates a 365-day access key, and requires platform-admin enablement before sign-in.  
**Why**: it keeps customer activation under platform control without returning to a shared browser write-key model.

## ADR-012 - Installer downloads are authenticated and deploy metadata is explicit

**Decision**: serve browser downloads from authenticated hub routes, mint secure expiring links for node-side pulls, and expose deployed revision metadata through the API instead of trusting a live git checkout.  
**Why**: public static bundle URLs do not meet the signed-in-only requirement, node-side pulls still need plain HTTPS URLs, and archive deploys should not pretend the VPS is a clean repo checkout.
