# Clarix Pulse - Hub Manual

**Document Date**: `2026-03-29 -04:00`

## Purpose

This manual covers the browser side of Clarix Pulse:

- public login and registration pages
- signed-in dashboard pages
- remote provisioning
- alert contact settings
- daily live monitoring
- platform-admin actions

---

## 1. Public Access Pages

### Register

Fields:

- `Company name`
- `Your name`
- `Email`
- `Password`

Buttons:

- `Create account`
- `Already registered? Sign in`

### Login

Fields:

- `Email`
- `Password`
- `Access key`

Buttons:

- `Sign in`
- `Forgot password`
- `Create a new account`

### Forgot password

Field:

- `Email`

Buttons:

- `Send reset link`
- `Back to sign in`

### Reset password

Fields:

- `Token`
- `New password`
- `Confirm password`

Buttons:

- `Update password`
- `Back to sign in`

---

## 2. App Header And Navigation

Main navigation buttons:

- `Dashboard`
- `Onboarding`
- `Account`
- `Admin` for platform admins only
- `Sign out`

Support-mode banner button:

- `Return to admin`

---

## 3. Onboarding Page

### Installer section

Buttons:

- `Download installer`
- `Create secure link`
- `Copy secure link`

Use this section to get the Windows bundle onto the monitored machine.

### Install checklist section

Button:

- `Open remote provisioning`

Use this when you are ready to move into `Remote Setup`.

### Information cards

- `Default alert recipient`
- `Enrollment key fallback`

---

## 4. Dashboard Page

### Top controls

- `Show inactive (N)` or `Hide inactive sites`
- `Open onboarding`
- `Start onboarding`

### Alarm banner

Buttons:

- `Enable sound`
- `Turn off alarm sound` or `Alarm sound off`

### Alert Contacts

Top button:

- `Alert settings` or `Hide settings`

Channel controls:

- `Enabled` or `Disabled` for email
- `Enabled` or `Disabled` for Telegram
- `Refresh` for Telegram discovery
- `Add` to add a Telegram target
- `Enabled` or `Disabled` for phone
- `Apply alert contacts`

---

## 5. Remote Setup

This is the main hub tool for adding and provisioning nodes.

### Top action buttons

- `Upload discovery report`
- `Add player`
- `Clear form`

### Node Identity fields

- `Node ID`
- `Node Name`
- `Site ID`
- `Hub URL`
- `Poll Interval`

### Player card buttons

- `Monitoring enabled` or `Monitoring disabled`
- `Advanced` or `Hide advanced`
- `Remove`

### Player fields

- `Player ID`
- `Display Label`
- `Playout Profile`
- path fields that change by profile

Advanced fields:

- `Playlist / Secondary Log`
- `Process Selectors JSON`
- `Log Selectors JSON`
- `UDP Inputs JSON`

### Main action button

- `Provision node and download config`

### After provisioning

The `Last Provision` card may show:

- the secure config link section
- the install handoff section

Buttons there:

- `Copy secure config link`
- `Create install handoff page`
- `Copy handoff link`

---

## 6. Install Handoff Page

This is the public expiring page created from `Remote Setup`.

Buttons:

- `Download installer`
- `Download node config`
- `Copy config link`
- `Copy this handoff page`
- `Back to Clarix Pulse`

Use this page when a field operator should finish setup without signing into the dashboard.

---

## 7. Account Page

### Installer access

Buttons:

- `Download Clarix Pulse for Windows`
- `Create secure install link`
- `Copy secure link`

### Install workspace app

Buttons:

- `Install app`
- `Share link`
- `Copy link`
- `Show QR` or `Hide QR`

### Information cards

- `Access status`
- `Alert default`
- `Enrollment key fallback`

---

## 8. Live Monitoring Cards

### Instance card monitoring controls

Buttons:

- `Maintenance on` or `Maintenance off`
- `Monitoring on` or `Monitoring off`

### Local mirror panel

Button:

- `Local mirror` or `Hide mirror`

The mirror is read-only and helps the operator confirm what the node currently has saved.

---

## 9. Platform Admin Page

Buttons per tenant:

- `Open workspace`
- `Send reset link`
- `Enable account` or `Disable account`
- `Delete account`

Fallback buttons:

- `Copy fallback key`
- `Copy reset link`

Use the admin page to:

- enable new customer accounts
- renew access keys
- issue reset links
- open a customer workspace for support
- permanently remove an unwanted account

---

## Related Docs

- full manual: [USER_MANUAL.md](/D:/monitoring/docs/USER_MANUAL.md)
- quick start: [QUICK_START.md](/D:/monitoring/docs/QUICK_START.md)
- node manual: [NODE_MANUAL.md](/D:/monitoring/docs/NODE_MANUAL.md)
